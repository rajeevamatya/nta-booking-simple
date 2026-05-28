# NTA Court Booking

Online court booking system for **Nepal Tennis Association**. Members identify themselves by phone number, pick a date and time slot, upload payment proof, and an admin verifies — no third-party payment gateway required.

---

## Live URLs

| Page | URL |
|------|-----|
| Booking app | `https://<your-vercel-domain>/` |
| Admin panel | `https://<your-vercel-domain>/admin` |

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Vanilla HTML + CSS + JavaScript (no build step) |
| Hosting | Vercel (static files) |
| Database | Supabase (Postgres via REST API) |
| Auth | Supabase Auth (email + password, admin only) |
| File storage | Supabase Storage — public bucket `payment-proofs` |
| Icons | Tabler Icons (CDN) |
| Fonts | DM Sans + DM Serif Display (Google Fonts CDN) |

---

## Repository Structure

```
nta/
├── index.html          # Member-facing booking app
├── admin.html          # Admin panel (login-gated)
├── favicon.svg         # Tennis ball SVG favicon
├── vercel.json         # URL rewrites
└── migrations/
    ├── 001_create_members.sql       # members table + RLS
    ├── 002_create_bookings.sql      # bookings table + RLS
    ├── 003_create_settings.sql      # settings table + RLS + seed row
    ├── 004_add_ai_checked.sql       # adds ai_checked (existing installs only)
    └── 005_rename_statuses.sql      # renames statuses + CHECK constraint
```

---

## Supabase Setup

Run migrations **in order** via the Supabase SQL Editor (Dashboard → SQL Editor). All files are idempotent — safe to re-run.

### Tables

#### `members`

```sql
phone         TEXT        PRIMARY KEY
name          TEXT        NOT NULL
nationality   TEXT        NOT NULL DEFAULT 'np'   -- 'np' | 'intl'
is_ranked     BOOLEAN     NOT NULL DEFAULT false
is_verified   BOOLEAN     NOT NULL DEFAULT false
registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

RLS policies: `anon` can INSERT and SELECT (self-registration + identity lookup). `authenticated` (admin) has full access.

#### `bookings`

```sql
id          UUID        PRIMARY KEY DEFAULT gen_random_uuid()
ref         TEXT        NOT NULL UNIQUE            -- e.g. NTA-A1B2-C3D
phone       TEXT        NOT NULL
name        TEXT        NOT NULL
court       INTEGER     NOT NULL CHECK (1–6)
date        DATE        NOT NULL
time_label  TEXT        NOT NULL                   -- e.g. "7:00 AM – 9:00 AM"
slots       INTEGER[]   NOT NULL                   -- e.g. {7,8}
match_type  TEXT        NOT NULL CHECK ('singles'|'doubles')
amount      INTEGER     NOT NULL
status      TEXT        NOT NULL DEFAULT 'Awaiting Payment'  -- CHECK: Awaiting Payment | Pending Verification | Confirmed | Cancelled
proof_url   TEXT
ai_checked  BOOLEAN     NOT NULL DEFAULT false
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
```

Valid statuses (enforced by CHECK constraint): `Awaiting Payment`, `Pending Verification`, `Confirmed`, `Cancelled`.

RLS policies: `anon` can INSERT, SELECT, and UPDATE (needed for proof upload). `authenticated` (admin) has full access.

#### `settings`

Single-row config table (id = 1).

```sql
id              INT  PRIMARY KEY DEFAULT 1
open_from       INT     NOT NULL DEFAULT 6       -- hour, 0–23
open_to         INT     NOT NULL DEFAULT 19      -- hour, 0–23
price_singles   INT     NOT NULL DEFAULT 400     -- NPR per hour
price_doubles   INT     NOT NULL DEFAULT 600     -- NPR per hour
whatsapp        TEXT    DEFAULT '9779841044844'
qr_url          TEXT                             -- payment QR image URL
closure_from    DATE
closure_to      DATE
closure_message TEXT    DEFAULT 'Courts are temporarily closed.'
```

RLS policies: `anon` can SELECT. `authenticated` (admin) has full access.

### Storage Bucket

1. Create a bucket named **`payment-proofs`** — set to **Public**.
2. Apply these storage policies:

```sql
-- Anyone can upload proof images
CREATE POLICY "anon_upload_proofs" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'payment-proofs');

-- Anyone can read files (needed to display proofs in admin)
CREATE POLICY "anon_read_proofs" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'payment-proofs');

-- Anyone can update (needed for re-upload)
CREATE POLICY "anon_update_proofs" ON storage.objects
  FOR UPDATE TO anon USING (bucket_id = 'payment-proofs');

-- Admin can delete
CREATE POLICY "auth_all_proofs" ON storage.objects
  FOR ALL TO authenticated USING (bucket_id = 'payment-proofs');
```

### Admin User

Create one admin account via **Authentication → Users → Invite user**. There is no self-registration for admin accounts. The session is stored in `sessionStorage` — it survives hard refreshes but clears when the tab is closed. A 401 mid-session redirects to the login screen automatically.

---

## Configuration

Both HTML files have two constants at the top of their `<script>` block:

```js
const SUPABASE_URL = 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co';
const SUPABASE_KEY = 'eyJ...';   // anon (publishable) key — safe to expose
```

These are the only values to update when deploying to a new Supabase project. Everything else — prices, opening hours, WhatsApp number, QR code, closure dates — is managed through the **Settings tab** in the admin panel.

---

## User Flow

```
Enter phone number
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
    │  • Upload payment screenshot / photo
    │
Confirmation screen
       • Booking reference (e.g. NTA-A1B2-C3)
       • Live status badge
       • Refresh button to poll for updates
       • Re-upload proof option (while Awaiting Payment or Pending Verification)
```

### Booking Status Lifecycle

```
Awaiting Payment  →  Pending Verification  →  Confirmed
                                           →  Cancelled
                  →  Cancelled
```

Rows that have been **Awaiting Payment for more than 10 minutes** are flagged with an **Overdue** tag in the admin panel. The admin cancels them manually — there is no automatic expiry.

---

## Admin Panel

### Bookings Tab *(default)*

- **Auto-refresh** every 60 seconds; red badge shows count of rows needing action
- **Search** by booking ref, member name, or phone number
- **Filters** by status and date range (Today / Yesterday / Last 7 days / Last 30 days / All time)
- **Stats bar** reflects the current filter: total, awaiting payment, pending verification, confirmed, cancelled
- **Overdue tag** on Awaiting Payment rows older than 10 minutes
- **Proof icon** (📷) inline with the status badge — click to open the proof modal
- **Proof modal** — full-size image with Confirm / Undo / Cancel actions
- **Row actions** — Confirm (Pending Verification rows), Undo (Confirmed rows), Cancel (any open row)
- **AI checked badge** — green "Checked" badge when `ai_checked = true` (placeholder for future automation)
- **Export CSV** — choose 30 days / 90 days / All time
- **Add Booking** — manually create a booking on behalf of a member

### Members Tab

- Lists all registered members with name, phone, nationality, ranked status, and verified status
- Red badge shows count of unverified members
- Toggle verified / unverified with one click
- **Add Member** — manually register a member

### Settings Tab

| Card | Fields |
|------|--------|
| **Opening Hours** | Open from / Open to (hourly). Drives available time slots in the booking app. |
| **Closure / Maintenance** | From date, To date, custom message. A banner appears in the booking app 7 days before the closure starts and throughout the closure period. |
| **Pricing** | Singles price (NPR/hr), Doubles price (NPR/hr) |
| **Contact & Payment** | WhatsApp number, QR code image upload |

---

## Booking Rules

| Rule | Value |
|------|-------|
| Booking window | Today and tomorrow only |
| Slot duration | 1 hour |
| Max consecutive slots | 2 |
| Available hours | Configurable via settings (default 06:00–19:00) |
| Courts | 1–6 (hardcoded; court count matches the CHECK constraint) |
| Match types | Singles, Doubles |
| Default prices | Singles NPR 400 / hr · Doubles NPR 600 / hr |
| Double-booking prevention | None — admin resolves conflicts manually |

---

## Payment Proof Storage

Images are compressed client-side (max 800 px, JPEG 0.6 quality) before upload. Files are stored under the booking's ref folder:

```
payment-proofs/
└── NTA-A1B2-C3/
    ├── receipt.jpg              # original upload
    └── 1A2B3C_receipt.jpg       # re-upload (timestamped prefix)
settings/
    └── qr.jpg                   # QR code image (overwritten on each upload)
```

---

## Closure Banner

The booking app shows a banner when a closure is configured in settings:

- **Up to 7 days before start:** "Upcoming closure from 10 Jun to 15 Jun: Courts are temporarily closed."
- **During the closure:** "Courts are temporarily closed." (the configured message)

The banner is informational only — it does not block bookings.

---

## Deployment

### Vercel (recommended)

1. Push this repo to GitHub.
2. Import at [vercel.com/new](https://vercel.com/new) — no build command needed.
3. `vercel.json` rewrites are picked up automatically.

### CLI

```bash
npm i -g vercel
vercel --prod
```

### URL Routing (`vercel.json`)

```json
{ "source": "/admin",           "destination": "/admin.html" }
{ "source": "/((?!admin).*)",   "destination": "/index.html" }
```

`/admin` serves the admin panel. Everything else routes to the booking app (supports direct links without 404s).

---

## First-Time Setup Checklist

- [ ] Create a Supabase project
- [ ] Run `migrations/001` through `003` in the SQL Editor (in order)
- [ ] Create the `payment-proofs` storage bucket (public) and apply the four storage policies
- [ ] Create an admin user via Supabase Auth → Users → Invite
- [ ] Update `SUPABASE_URL` and `SUPABASE_KEY` in both `index.html` and `admin.html`
- [ ] Deploy to Vercel
- [ ] Log in to `/admin` → Settings → set prices, opening hours, WhatsApp number, QR code

## Existing Installation Migration

Run these if upgrading an existing database (fresh installs from `002` already include these changes):

- [ ] `migrations/004_add_ai_checked.sql` — adds the `ai_checked` column
- [ ] `migrations/005_rename_statuses.sql` — renames statuses and adds a CHECK constraint

---

## Supabase Keys Reference

| Key | Where to find | Safe to expose? |
|-----|---------------|-----------------|
| Project URL | Settings → API → Project URL | Yes |
| `anon` key | Settings → API → Project API keys → `anon` | **Yes** — RLS enforces access |
| `service_role` key | Settings → API → Project API keys → `service_role` | **No** — never put this in frontend code |

Only the `anon` key is used in this project. It is embedded in the HTML intentionally.

---

## Known Limitations

- **No double-booking prevention** — two members can book the same court and slot simultaneously. Admin resolves conflicts manually.
- **No email or SMS notifications** — members check status by revisiting the confirmation screen.
- **No slot availability display** — the booking form shows all slots; taken courts are only greyed out after a slot is selected.
- **Closure banner is informational only** — does not block bookings during a closure.
- **Single admin account recommended** — no per-admin audit trail.

---

## Planned Improvements

### AI Payment Proof Verification

The `ai_checked` boolean on `bookings` is a placeholder. Planned flow:

1. When `proof_url` is set on a booking, trigger a Supabase Edge Function
2. Pass the image to a vision model (e.g. Claude, GPT-4o) with the expected amount
3. On high-confidence match → set `ai_checked = true`, optionally advance status to `Confirmed`
4. On low confidence → leave `ai_checked = false` for manual admin review

The admin table already shows a green **Checked** badge when `ai_checked = true` — no UI changes needed.

### Slot Availability

Show remaining available slots before a court is selected, and add a unique DB constraint on `(date, court, slots)` to enforce it at the database level.

### Notifications

Notify members when their booking status changes (Confirmed / Cancelled) via Supabase Edge Functions + Resend (email) or an SMS gateway.

### Multi-Admin Audit Log

Track which admin performed each action (Confirm, Cancel, etc.) with timestamps in a separate `audit_log` table.
