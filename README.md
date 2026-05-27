# NTA Court Booking

Online court booking system for **Nepal Tennis Association**. Members register, pick a slot, upload payment proof, and an admin verifies everything — no third-party payment gateway needed.

**Live:**
- Booking app → `https://<your-vercel-domain>/`
- Admin panel → `https://<your-vercel-domain>/admin`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (no build step) |
| Hosting | Vercel (static) |
| Database | Supabase (Postgres via REST API) |
| Auth | Supabase Auth (email + password) |
| File storage | Supabase Storage (public bucket `payment-proofs`) |
| Icons | Tabler Icons (CDN) |
| Fonts | Inter (Google Fonts CDN) |

---

## Repository Structure

```
nta/
├── index.html          # User-facing booking app
├── admin.html          # Admin panel (login-gated)
├── favicon.svg         # Tennis ball SVG favicon
├── vercel.json         # URL rewrites
└── setup-settings.sql  # One-time SQL to run in Supabase
```

### URL Routing (`vercel.json`)

```json
{
  "rewrites": [
    { "source": "/admin",           "destination": "/admin.html" },
    { "source": "/((?!admin).*)",   "destination": "/index.html" }
  ]
}
```

`/admin` serves the admin panel. Everything else routes to the booking app (supports deep links without 404s).

---

## Supabase Setup

### 1. Tables

Run these in the **Supabase SQL Editor** (Dashboard → SQL Editor).

#### `members`
```sql
create table members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,
  phone       text,
  verified    boolean default false,
  created_at  timestamptz default now()
);

alter table members enable row level security;

-- Anyone can register
create policy "anon_insert_members" on members
  for insert to anon with check (true);

-- Anyone can look up members (needed for identify screen)
create policy "anon_select_members" on members
  for select to anon using (true);

-- Admin can do everything
create policy "auth_all_members" on members
  for all to authenticated using (true) with check (true);
```

#### `bookings`
```sql
create table bookings (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  name        text not null,
  email       text not null,
  phone       text,
  date        date not null,
  slot        text not null,
  court       text not null,
  type        text not null,         -- 'Singles' | 'Doubles'
  price       int  not null,
  status      text not null default 'Pending',
  proof_url   text,
  created_at  timestamptz default now()
);

alter table bookings enable row level security;

-- Anyone can create a booking
create policy "anon_insert_bookings" on bookings
  for insert to anon with check (true);

-- Anyone can read bookings (needed for status screen)
create policy "anon_select_bookings" on bookings
  for select to anon using (true);

-- Anyone can update bookings (needed for proof upload + re-upload)
create policy "anon_update_bookings" on bookings
  for update to anon using (true) with check (true);

-- Admin can do everything
create policy "auth_all_bookings" on bookings
  for all to authenticated using (true) with check (true);
```

#### `settings`

Use the included `setup-settings.sql` file, or paste this:

```sql
create table if not exists settings (
  id              int  primary key default 1,
  closure_from    date,
  closure_to      date,
  closure_message text    default 'Courts are temporarily closed.',
  open_from       int     not null default 6,
  open_to         int     not null default 19,
  price_singles   int     not null default 400,
  price_doubles   int     not null default 600,
  whatsapp        text    default '9779841044844',
  qr_url          text
);

insert into settings (id) values (1) on conflict (id) do nothing;

alter table settings enable row level security;

-- Booking app can read settings
create policy "anon_select_settings" on settings
  for select to anon using (true);

-- Admin can update settings
create policy "auth_all_settings" on settings
  for all to authenticated using (true) with check (true);
```

### 2. Storage Bucket

1. Go to **Storage → New bucket**
2. Name: `payment-proofs`
3. Public: **Yes**
4. Add storage policies:

```sql
-- Allow anyone to upload proof images
create policy "anon_upload_proofs" on storage.objects
  for insert to anon with check (bucket_id = 'payment-proofs');

-- Allow anyone to read files
create policy "anon_read_proofs" on storage.objects
  for select to anon using (bucket_id = 'payment-proofs');

-- Allow anyone to update (needed for re-uploading proof)
create policy "anon_update_proofs" on storage.objects
  for update to anon using (bucket_id = 'payment-proofs');

-- Admin can delete
create policy "auth_all_proofs" on storage.objects
  for all to authenticated using (bucket_id = 'payment-proofs');
```

### 3. Admin User

Create one admin user via **Authentication → Users → Invite user**. Only authenticated (admin) users can approve/cancel bookings or change settings. There is no self-registration for admin accounts.

---

## Configuration

Both HTML files share two constants near the top of their `<script>` block:

```js
const SUPABASE_URL = 'https://xxxxxxxxxxxxxxxxxxxx.supabase.co';
const SUPABASE_KEY = 'eyJ...';   // publishable anon key — safe to expose
```

These are the only values you need to change when deploying to a new Supabase project. The anon key has limited permissions enforced by Row Level Security — it is intentionally public.

All other configuration (prices, opening hours, WhatsApp number, QR code, closure dates) is managed through the **Settings tab** in the admin panel and stored in the `settings` table.

---

## User Flow

```
[Identify screen]
    │
    ├── new user ──→ [Register] ──→ back to Identify
    │
    ▼ returning member
[Book a Court]
    │  • Pick date (today or tomorrow only)
    │  • Pick time slot
    │  • Pick court (Court 1 / Court 2)
    │  • Pick type (Singles / Doubles)
    │
    ▼
[Payment screen]
    │  • Price shown (from settings)
    │  • QR code (if uploaded in admin Settings)
    │  • WhatsApp contact link
    │  • Upload payment screenshot
    │
    ▼
[Confirmation / Status screen]
       • Booking reference (e.g. NTA-2024-0042)
       • Live status badge
       • Refresh button to poll for updates
       • Re-upload proof option (while Pending / Payment Submitted)
```

### Booking Status Lifecycle

```
Pending  →  Payment Submitted  →  Paid
                               →  Cancelled
         →  Cancelled
```

---

## Admin Panel

### Login

Supabase email + password authentication. The session is kept in `sessionStorage` so it survives hard refreshes (Cmd+Shift+R) but is cleared when the tab is closed.

If the JWT expires mid-session, the next API call returns 401 and the admin is automatically redirected to the login screen with a "Session expired" message.

### Bookings Tab *(default tab)*

| Feature | Detail |
|---|---|
| Auto-refresh | Table polls every 60 s; red badge on the tab shows pending-proof count |
| Row highlight | Blue left-border on rows requiring action (status = Payment Submitted) |
| Filter | Dropdown: Last 30 days / Last 90 days / All time |
| Proof modal | Click **View proof** to open image popup with approve/cancel/undo buttons |
| Mark paid | Available on Payment Submitted rows (and inside the proof modal) |
| Undo paid | Available on Paid rows — rolls status back to Payment Submitted |
| Cancel | Available on non-final rows (Pending, Payment Submitted) |
| Export CSV | Choose 30 days / 90 days / All; downloads all booking fields |

### Members Tab

- Lists all registered members with name, email, phone, and verified status
- Red badge on the tab shows count of unverified members
- Toggle verified / unverified per member with one click

### Settings Tab

Four cards, each saved independently:

| Card | Fields |
|---|---|
| **Opening Hours** | Open from / Open to (hourly, 00:00–23:00). Drives available time slots in the booking app. |
| **Closure / Maintenance** | From date, To date, Custom message. Shows a banner on the booking app during the range. |
| **Pricing** | Singles price (NPR), Doubles price (NPR) |
| **Contact & Payment** | WhatsApp number (with country code, no `+`), QR code image upload |

---

## Booking Rules

| Rule | Value |
|---|---|
| Booking window | Today and tomorrow only |
| Slot duration | 1 hour |
| Available slots | Driven by `open_from` / `open_to` in settings (default 06:00–19:00) |
| Courts | Court 1, Court 2 |
| Types | Singles, Doubles |
| Default prices | Singles NPR 400 / Doubles NPR 600 |
| Double-booking prevention | None — admin resolves conflicts manually |

**Example:** On May 28 a member can book any slot on May 28 or May 29. On May 29 they can book May 29 or May 30.

---

## Payment Proof Storage

Proof images are stored in Supabase Storage under `payment-proofs/`:

```
payment-proofs/
└── NTA-2024-0042/
    ├── 1716825600000_receipt.jpg    # original upload
    └── 1716826000000_receipt2.jpg   # re-upload (if user replaced proof)
settings/
    └── qr.jpg                       # QR code (overwritten on each upload)
```

Images are compressed client-side before upload (max 800 px, JPEG quality 0.6) to keep storage usage low.

---

## Deployment

### Vercel (Recommended)

1. Push this repository to GitHub.
2. Import the project at [vercel.com/new](https://vercel.com/new).
3. No build command needed — Vercel serves the static files directly.
4. The `vercel.json` rewrites are picked up automatically.

### Manual Deploy via CLI

```bash
npm i -g vercel
vercel --prod
```

### First-Time Setup Checklist

- [ ] Create a Supabase project
- [ ] Run the three table SQL blocks above (or use `setup-settings.sql` for the settings table)
- [ ] Create the `payment-proofs` storage bucket (public) and apply the storage policies
- [ ] Create an admin user via Supabase Auth → Users → Invite
- [ ] Update `SUPABASE_URL` and `SUPABASE_KEY` in both `index.html` and `admin.html`
- [ ] Deploy to Vercel
- [ ] Open `/admin`, log in, go to Settings → configure prices, opening hours, WhatsApp number, and upload a QR code image

---

## Known Limitations

- **No double-booking prevention** — two users can book the same court + slot simultaneously. The admin resolves conflicts manually.
- **No email notifications** — status updates are only visible by revisiting the confirmation screen.
- **No slot availability display** — the booking form shows all slots regardless of existing bookings.
- **Closure mode is informational only** — the banner warns members but does not block bookings.
- **Single admin recommended** — there is no per-admin audit trail; all actions appear under the same authenticated session.

---

## Supabase Keys Reference

| Key | Where to find | Safe to expose? |
|---|---|---|
| Project URL | Settings → API → Project URL | Yes |
| `anon` public key | Settings → API → Project API keys → `anon` | **Yes** — RLS enforces access |
| `service_role` key | Settings → API → Project API keys → `service_role` | **No** — never put this in frontend code |

Only the `anon` key is used in this project. It is embedded in the HTML source intentionally. All sensitive operations are protected by Supabase Row Level Security policies.
