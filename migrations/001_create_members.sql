-- Migration 001: Create members table
-- Safe to re-run — uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  email       TEXT        NOT NULL UNIQUE,
  phone       TEXT,
  verified    BOOLEAN     DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT now()
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
