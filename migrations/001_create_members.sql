-- Migration 001: Create members table
-- Safe to re-run — uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS members (
  phone         TEXT        NOT NULL,
  name          TEXT        NOT NULL,
  nationality   TEXT        NOT NULL DEFAULT 'np',   -- 'np' | 'intl'
  is_ranked     BOOLEAN     NOT NULL DEFAULT FALSE,
  is_verified   BOOLEAN     NOT NULL DEFAULT FALSE,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT members_pkey PRIMARY KEY (phone)
);

ALTER TABLE members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_insert_members" ON members;
DROP POLICY IF EXISTS "anon_select_members" ON members;
DROP POLICY IF EXISTS "auth_all_members"    ON members;

-- Anyone can register
CREATE POLICY "anon_insert_members" ON members
  FOR INSERT TO anon WITH CHECK (true);

-- Anyone can look up members (needed for identify screen)
CREATE POLICY "anon_select_members" ON members
  FOR SELECT TO anon USING (true);

-- Admin can do everything
CREATE POLICY "auth_all_members" ON members
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
