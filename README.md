# NTA Court Booking

Online court booking system for **Nepal Tennis Association**. Members book via the web app; an admin panel verifies payments and manages members. A WhatsApp bot (`api/whatsapp.ts`) is maintained but dormant.

---

## Live URLs

| Page | URL |
|------|-----|
| Booking app | `https://nta-booking.vercel.app/` |
| Admin panel | `https://nta-booking.vercel.app/admin` |
| WhatsApp webhook | `https://nta-booking.vercel.app/api/whatsapp` |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vite + Vanilla HTML / CSS / JS |
| API functions | TypeScript Vercel Functions |
| AI (payment check) | Vercel AI SDK, OpenAI GPT-4.1-mini |
| Hosting | Vercel (Fluid Compute) |
| Database | Supabase (Postgres via REST API) |
| Auth | Supabase Auth (email + password, admin only) |
| File storage | Supabase Storage — public bucket `payment-proofs` |
| WhatsApp channel | Twilio (dormant) |
| Phone normalisation | libphonenumber-js (E.164 everywhere) |
| Icons | Tabler Icons (CDN) |
| Fonts | DM Sans (Google Fonts CDN) |

---

## Repository Structure

```
nta/
├── index.html                    # Member-facing booking app
├── admin.html                    # Admin panel (login-gated)
├── favicon.svg
├── vite.config.js                # Multi-page Vite build
├── vercel.json                   # Build config + URL rewrites
├── tsconfig.json
├── package.json
├── src/
│   ├── main.js                   # Booking app logic
│   └── admin.js                  # Admin panel logic
├── api/
│   ├── check-payment.ts          # AI payment verification (admin panel)
│   └── whatsapp.ts               # WhatsApp bot (dormant)
└── migrations/
    ├── 001_create_members.sql
    ├── 002_create_bookings.sql
    ├── 003_create_settings.sql
    ├── 004_add_ai_checked.sql
    ├── 005_rename_statuses.sql
    ├── 006_add_conversation_history.sql
    ├── 007_add_ai_check_details.sql
    ├── 008_add_player_type.sql
    ├── 009_add_discount.sql
    └── 010_split_discounts_night_pricing.sql
```

---

## Supabase Setup

Run migrations **in order** via the Supabase SQL Editor. All files are idempotent — safe to re-run.

### Tables

#### `members`

```sql
phone         TEXT        PRIMARY KEY              -- E.164 format, e.g. +9779865457921
name          TEXT        NOT NULL
nationality   TEXT        NOT NULL DEFAULT 'np'   -- 'np' | 'intl'
player_type   TEXT        NOT NULL DEFAULT 'recreational'  -- 'recreational' | 'ranked' | 'coach'
is_ranked     BOOLEAN     NOT NULL DEFAULT false  -- legacy, kept for backcompat
is_verified   BOOLEAN     NOT NULL DEFAULT false
registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

RLS: `anon` can INSERT and SELECT. `authenticated` (admin) has full access.

#### `bookings`

```sql
id               UUID        PRIMARY KEY DEFAULT gen_random_uuid()
ref              TEXT        NOT NULL UNIQUE            -- e.g. NTA-A1B2-C3D
phone            TEXT        NOT NULL                   -- E.164
name             TEXT        NOT NULL
court            INTEGER     NOT NULL CHECK (1–6)
date             DATE        NOT NULL
time_label       TEXT        NOT NULL                   -- e.g. "7:00 AM – 9:00 AM"
slots            INTEGER[]   NOT NULL                   -- e.g. {7,8}
match_type       TEXT        NOT NULL CHECK ('singles'|'doubles')
amount           INTEGER     NOT NULL
status           TEXT        NOT NULL DEFAULT 'Awaiting Payment'
proof_url        TEXT
ai_checked       BOOLEAN     NOT NULL DEFAULT false
ai_check_details JSONB
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

Valid statuses: `Awaiting Payment` → `Pending Verification` → `Confirmed` / `Cancelled`.

RLS: `anon` can INSERT, SELECT, and UPDATE. `authenticated` (admin) has full access.

#### `settings`

Single-row config (id = 1).

```sql
id              INT  PRIMARY KEY DEFAULT 1
open_from       INT     NOT NULL DEFAULT 6
open_to         INT     NOT NULL DEFAULT 19
price_singles   INT     NOT NULL DEFAULT 400     -- NPR per hour
price_doubles   INT     NOT NULL DEFAULT 600     -- NPR per hour
discount_ranked INT     NOT NULL DEFAULT 25      -- % off for ranked players
discount_coach  INT     NOT NULL DEFAULT 25      -- % off for coaches
night_premium   INT     NOT NULL DEFAULT 25      -- % markup after night_starts
night_starts    INT     NOT NULL DEFAULT 18      -- hour when night pricing begins
whatsapp        TEXT    DEFAULT '9779841044844'
qr_url          TEXT
closure_from    DATE
closure_to      DATE
closure_message TEXT    DEFAULT 'Courts are temporarily closed.'
```

RLS: `anon` can SELECT. `authenticated` (admin) has full access.

#### `conversation_history`

Stores the WhatsApp bot's per-user conversation context.

```sql
id         BIGSERIAL    PRIMARY KEY
phone      TEXT         NOT NULL               -- E.164
role       TEXT         NOT NULL               -- 'user' | 'assistant' | 'tool'
content    TEXT
metadata   JSONB
created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
```

RLS: `service_role` only.

### Storage Bucket

Create a bucket named **`payment-proofs`** (Public) and apply:

```sql
CREATE POLICY "anon_upload_proofs" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'payment-proofs');
CREATE POLICY "anon_read_proofs" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'payment-proofs');
CREATE POLICY "anon_update_proofs" ON storage.objects
  FOR UPDATE TO anon USING (bucket_id = 'payment-proofs');
CREATE POLICY "auth_all_proofs" ON storage.objects
  FOR ALL TO authenticated USING (bucket_id = 'payment-proofs');
```

---

## WhatsApp Bot

The bot (`api/whatsapp.ts`) is a single self-contained Vercel Function. It handles Twilio webhooks, runs an agentic loop (up to 7 steps) with OpenAI GPT-4.1-mini, and replies via TwiML. It is currently dormant — to remove it entirely, delete `api/whatsapp.ts`.

**Bot capabilities:** check availability, create/cancel bookings, list upcoming bookings, process payment screenshots.

**Access control:** verified members only. Registration is via the web app or admin panel.

### Twilio Setup

Set the webhook in Twilio → Messaging → Sandbox Settings → **When a message comes in**:
```
https://nta-booking.vercel.app/api/whatsapp
```
Method: `HTTP POST`

---

## Environment Variables

Set in Vercel (Project → Settings → Environment Variables) and in `.env.local` for local dev:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=   # server-side only — bypasses RLS
OPENAI_API_KEY=
TWILIO_ACCOUNT_SID=          # only needed if bot is active
TWILIO_AUTH_TOKEN=           # only needed if bot is active
```

> The `service_role` key is only used server-side (Vercel Functions). Never put it in frontend HTML.

---

## User Flow (Web App)

```
Enter country code + phone number
    │
    ├── new number ──→ Register (name, nationality, player type) ──→ continue
    │
    ▼ known member
Select date (Today / Tomorrow)
    │
Select time slot(s) — up to 2 consecutive hours
    │
Select court (1–6, greyed out if booked)
    │
Select match type (Singles / Doubles)
    │
Payment screen
    │  • Amount shown (base rate + night premium if applicable; discount if ranked/coach)
    │  • QR code (if uploaded in admin)
    │  • Upload payment screenshot
    │
Confirmation screen
       • Booking ref (e.g. NTA-A1B2-C3)
       • Live status badge
       • Re-upload proof option
```

---

## Admin Panel

Sidebar navigation with three sections.

### Bookings Tab *(default)*

- Auto-refresh every 60 seconds; red badge for rows needing action
- Search by ref, name, or phone; filter by status and date range
- Bulk confirm or cancel via row checkboxes + bulk action bar
- Overdue "Awaiting Payment" rows shown with an orange badge (>10 min old)
- View proof / Upload proof buttons in the Actions column
- Export CSV + optional ZIP of payment proof images (30 days / 90 days / All time)
- Add Booking manually (walk-in / phone)

### Members Tab

- Lists all members with name, phone, nationality, player type, and verified status
- Toggle verified / unverified with one click
- Edit name, nationality, and player type inline
- Red badge for unverified count
- Add Member manually

### Settings Tab

| Card | Fields |
|------|--------|
| Opening Hours | Open from / Open to |
| Closure / Maintenance | From date, To date, message |
| Pricing | Singles NPR/hr, Doubles NPR/hr, night premium %, night starts at |
| Member Discounts | Ranked player %, Coach % |
| Contact & Payment | WhatsApp number, QR code upload |

---

## Deployment

```bash
npm run dev      # local dev with HMR
npm run build    # production build → dist/
npm run preview  # preview production build locally
```

1. Push to GitHub → import at [vercel.com/new](https://vercel.com/new).
2. Vercel auto-detects Vite; build command is `npm run build`, output directory is `dist/`.
3. Add environment variables (see above).

### URL Routing (`vercel.json`)

- `/admin` → `admin.html`
- `/api/*` → Vercel Functions
- Everything else → `index.html`

---

## First-Time Setup Checklist

- [ ] Create a Supabase project
- [ ] Run `migrations/001` through `010` in the SQL Editor (in order)
- [ ] Create the `payment-proofs` storage bucket (public) and apply the four storage policies
- [ ] Create an admin user via Supabase Auth → Users → Invite
- [ ] Update `SUPABASE_URL` and `SUPABASE_KEY` constants in `index.html` and `admin.html`
- [ ] Add environment variables in Vercel project settings
- [ ] Deploy to Vercel
- [ ] Log in to `/admin` → Settings → set prices, opening hours, discounts, WhatsApp number, QR code
- [ ] Add and verify members before opening bookings

---

## Supabase Keys Reference

| Key | Where to find | Safe to expose? |
|-----|---------------|-----------------|
| Project URL | Settings → API → Project URL | Yes |
| `anon` / publishable key | Settings → API → anon | **Yes** — used in frontend HTML |
| `service_role` key | Settings → API → service_role | **No** — server-side only |

---

## Known Limitations

- No double-booking prevention at the DB level — two simultaneous bookings for the same court and slot are theoretically possible. Admin resolves conflicts manually.
- No push notifications — members check status by revisiting the confirmation screen.
- Closure banner is informational only — does not block bookings.
- Single admin account recommended — no per-admin audit trail.
