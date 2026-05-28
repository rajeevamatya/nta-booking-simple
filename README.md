# NTA Court Booking

Online court booking system for **Nepal Tennis Association**. Members book via the web app or WhatsApp — both channels share one database. An admin panel verifies payments and manages members.

---

## Live URLs

| Page | URL |
|------|-----|
| Booking app | `https://nta-booking.vercel.app/` |
| Admin panel | `https://nta-booking.vercel.app/admin` |
| WhatsApp webhook | `https://nta-booking.vercel.app/api/webhook/whatsapp` |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vanilla HTML + CSS + JavaScript (no build step) |
| WhatsApp bot | TypeScript Vercel Function, Vercel AI SDK v4, OpenAI GPT-4.1-mini |
| Hosting | Vercel (Fluid Compute) |
| Database | Supabase (Postgres via REST API) |
| Auth | Supabase Auth (email + password, admin only) |
| File storage | Supabase Storage — public bucket `payment-proofs` |
| WhatsApp channel | Twilio |
| Phone normalisation | libphonenumber-js (E.164 everywhere) |
| Icons | Tabler Icons (CDN) |
| Fonts | DM Sans + DM Serif Display (Google Fonts CDN) |

---

## Repository Structure

```
nta/
├── index.html                    # Member-facing booking app
├── admin.html                    # Admin panel (login-gated)
├── favicon.svg
├── vercel.json                   # URL rewrites
├── package.json                  # Bot dependencies
├── tsconfig.json
├── api/
│   └── webhook/
│       └── whatsapp.ts           # Vercel Function — Twilio webhook entry point
├── src/
│   └── bot.ts                    # All bot logic (~600 lines)
└── migrations/
    ├── 001_create_members.sql
    ├── 002_create_bookings.sql
    ├── 003_create_settings.sql
    ├── 004_add_ai_checked.sql
    ├── 005_rename_statuses.sql
    └── 006_add_conversation_history.sql
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
is_ranked     BOOLEAN     NOT NULL DEFAULT false
is_verified   BOOLEAN     NOT NULL DEFAULT false
registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

RLS: `anon` can INSERT and SELECT. `authenticated` (admin) has full access.

> **Important:** Phone numbers are stored in E.164 format (`+977XXXXXXXXXX`). Run the normalisation SQL below if upgrading from a pre-E.164 install.

#### `bookings`

```sql
id          UUID        PRIMARY KEY DEFAULT gen_random_uuid()
ref         TEXT        NOT NULL UNIQUE            -- e.g. NTA-A1B2-C3D
phone       TEXT        NOT NULL                   -- E.164
name        TEXT        NOT NULL
court       INTEGER     NOT NULL CHECK (1–6)
date        DATE        NOT NULL
time_label  TEXT        NOT NULL                   -- e.g. "7:00 AM – 9:00 AM"
slots       INTEGER[]   NOT NULL                   -- e.g. {7,8}
match_type  TEXT        NOT NULL CHECK ('singles'|'doubles')
amount      INTEGER     NOT NULL
status      TEXT        NOT NULL DEFAULT 'Awaiting Payment'
proof_url   TEXT
ai_checked  BOOLEAN     NOT NULL DEFAULT false
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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

### How it works

The bot is a single Vercel Function (`api/webhook/whatsapp.ts`) backed by `src/bot.ts`. When a member sends a WhatsApp message, Twilio posts to the webhook; the bot runs an agentic loop (up to 7 steps) using OpenAI GPT-4.1-mini with tool calling, then replies via TwiML.

**Bot capabilities:**
- Check court availability for a date and time
- Create bookings (confirmed members only)
- List upcoming bookings
- Cancel a booking by ref
- Check booking status
- Process a payment screenshot — downloads the image, uploads it to Supabase Storage, runs vision extraction to read the amount, and marks the booking as `Pending Verification`

**Access control:** Only members with `is_verified = true` can use the bot. Unregistered numbers get a registration prompt; unverified members get a pending-verification message. Member registration happens through the web app or admin panel — the bot does not auto-create members.

**Conversation memory:** Each turn's messages (user, assistant tool calls, tool results) are saved to `conversation_history` so the bot remembers context across messages.

### Twilio Setup

1. Create a Twilio account and enable the **WhatsApp Sandbox** (or a production sender).
2. Set the webhook URL in Twilio → Messaging → Sandbox Settings → **When a message comes in**:
   ```
   https://nta-booking.vercel.app/api/webhook/whatsapp
   ```
   Method: `HTTP POST`

### Environment Variables

Set these in Vercel (Project → Settings → Environment Variables) **and** in `.env.local` for local dev:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=   # service role — bypasses RLS for bot writes
OPENAI_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=      # e.g. whatsapp:+14155238886
```

> The `service_role` key is only used server-side (inside the Vercel Function). Never put it in frontend HTML.

---

## Phone Number Format

All phone numbers are stored in **E.164 format** (`+9779865457921`). The web app builds E.164 directly from a country code selector (default +977 Nepal). The bot normalises Twilio's incoming format via `libphonenumber-js`.

### One-time normalisation SQL (existing installs)

Run this in the Supabase SQL Editor to migrate local-format numbers to E.164:

```sql
-- Step 1: Remove E.164 ghost duplicates where the local version also exists
DELETE FROM members
WHERE phone ~ '^\+977[0-9]{10}$'
  AND EXISTS (
    SELECT 1 FROM members m2
    WHERE m2.phone = substr(members.phone, 5)
  );

-- Step 2: Normalize local Nepal numbers → E.164 across all tables
UPDATE members SET phone = '+977' || phone WHERE phone ~ '^9[6-8][0-9]{8}$';
UPDATE bookings SET phone = '+977' || phone WHERE phone ~ '^9[6-8][0-9]{8}$';
UPDATE conversation_history SET phone = '+977' || phone WHERE phone ~ '^9[6-8][0-9]{8}$';
```

---

## User Flow (Web App)

```
Enter country code + phone number
    │
    ├── new number ──→ Register (name, nationality, ranked?) ──→ continue
    │
    ▼ known member
Select date (Today / Tomorrow)
    │
Select time slot(s) — up to 2 consecutive hours
    │
Select court (1–6, greyed out if already booked)
    │
Select match type (Singles / Doubles)
    │
Payment screen
    │  • Amount shown (from settings)
    │  • QR code (if uploaded in admin)
    │  • WhatsApp link to NTA staff
    │  • Upload payment screenshot
    │
Confirmation screen
       • Booking ref (e.g. NTA-A1B2-C3)
       • Live status badge
       • Re-upload proof option
```

## User Flow (WhatsApp)

```
Member sends any message
    │
    ├── not registered ──→ "Register via the NTA website."
    ├── not verified   ──→ "Contact admin to verify your account."
    │
    ▼ verified member
Bot greets by name, explains how to book
    │
"Book court 2 for singles tomorrow at 7am, 1 hour"
    │
Bot checks availability → confirms details → creates booking → sends ref + payment instructions
    │
Member sends payment screenshot
    │
Bot processes proof → uploads to Supabase Storage → marks Pending Verification
    │
Admin confirms in admin panel → member can check status via bot or web app
```

---

## Admin Panel

### Bookings Tab *(default)*

- Auto-refresh every 60 seconds; red badge for rows needing action
- Search by ref, name, or phone; filter by status and date range
- Stats bar reflects current filter
- **Overdue tag** on Awaiting Payment rows older than 10 minutes
- **Proof modal** — full-size image with Confirm / Undo / Cancel actions
- **AI checked badge** — green badge when `ai_checked = true` (set automatically when the bot processes a payment screenshot)
- Export CSV (30 days / 90 days / All time)
- Add Booking manually (walk-in / phone)

### Members Tab

- Lists all members with name, phone, nationality, ranked, and verified status
- Toggle verified / unverified with one click
- Red badge for unverified count
- Add Member manually

### Settings Tab

| Card | Fields |
|------|--------|
| Opening Hours | Open from / Open to (hourly) |
| Closure / Maintenance | From date, To date, message |
| Pricing | Singles NPR/hr, Doubles NPR/hr |
| Contact & Payment | WhatsApp number, QR code upload |

---

## Deployment

1. Push to GitHub → import at [vercel.com/new](https://vercel.com/new) — no build command needed.
2. Add the six environment variables (see WhatsApp Bot section above).
3. `vercel.json` rewrites and the `api/` function are picked up automatically.

### URL Routing (`vercel.json`)

- `/admin` → `admin.html`
- `/api/*` → Vercel Functions (bot webhook)
- Everything else → `index.html`

---

## First-Time Setup Checklist

- [ ] Create a Supabase project
- [ ] Run `migrations/001` through `006` in the SQL Editor (in order)
- [ ] Create the `payment-proofs` storage bucket (public) and apply the four storage policies
- [ ] Create an admin user via Supabase Auth → Users → Invite
- [ ] Update `SUPABASE_URL` and `SUPABASE_KEY` in both `index.html` and `admin.html`
- [ ] Add all six environment variables in Vercel project settings
- [ ] Deploy to Vercel
- [ ] Configure Twilio webhook URL to `https://<domain>/api/webhook/whatsapp`
- [ ] Log in to `/admin` → Settings → set prices, opening hours, WhatsApp number, QR code
- [ ] Add and verify at least one member before testing the WhatsApp bot

## Upgrading an Existing Install

- [ ] Run `migrations/004` — adds `ai_checked` column
- [ ] Run `migrations/005` — renames statuses, adds CHECK constraint
- [ ] Run `migrations/006` — adds `conversation_history` table
- [ ] Run the phone normalisation SQL above (E.164 migration)
- [ ] Add the six bot environment variables in Vercel

---

## Supabase Keys Reference

| Key | Where to find | Safe to expose? |
|-----|---------------|-----------------|
| Project URL | Settings → API → Project URL | Yes |
| `anon` key | Settings → API → anon | **Yes** — used in frontend HTML |
| `service_role` key | Settings → API → service_role | **No** — server-side only (bot) |

---

## Known Limitations

- No double-booking prevention at the DB level — two simultaneous bookings for the same court and slot are possible. Admin resolves conflicts manually.
- No push notifications — members check status by revisiting the confirmation screen or asking the bot.
- Closure banner is informational only — does not block bookings.
- Single admin account recommended — no per-admin audit trail.
- WhatsApp bot conversation history is stored indefinitely — no automatic pruning.
