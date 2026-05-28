-- Migration 002: Create bookings table
-- Safe to re-run — uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS bookings (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  phone       TEXT        NOT NULL,
  court       TEXT        NOT NULL,
  date        DATE        NOT NULL,
  time_label  TEXT        NOT NULL,          -- human-readable range e.g. "7:00 AM – 9:00 AM"
  slots       INT[]       NOT NULL,          -- array of hour integers e.g. {7,8}
  match_type  TEXT        NOT NULL,          -- 'singles' | 'doubles'
  amount      INT         NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'Pending',
  proof_url   TEXT,
  ai_checked  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_bookings" ON bookings;
DROP POLICY IF EXISTS "anon_select_bookings" ON bookings;
DROP POLICY IF EXISTS "anon_update_bookings" ON bookings;
DROP POLICY IF EXISTS "auth_all_bookings"    ON bookings;

-- Anyone can create a booking
CREATE POLICY "anon_insert_bookings" ON bookings
  FOR INSERT TO anon WITH CHECK (true);

-- Anyone can read bookings (needed for status screen)
CREATE POLICY "anon_select_bookings" ON bookings
  FOR SELECT TO anon USING (true);

-- Anyone can update bookings (needed for proof upload + re-upload)
CREATE POLICY "anon_update_bookings" ON bookings
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Admin can do everything
CREATE POLICY "auth_all_bookings" ON bookings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
