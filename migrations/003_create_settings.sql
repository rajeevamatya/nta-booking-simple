-- Migration 003: Create settings table
-- Safe to re-run — uses IF NOT EXISTS and ON CONFLICT DO NOTHING

CREATE TABLE IF NOT EXISTS settings (
  id              INT  PRIMARY KEY DEFAULT 1,
  closure_from    DATE,
  closure_to      DATE,
  closure_message TEXT    DEFAULT 'Courts are temporarily closed.',
  open_from       INT     NOT NULL DEFAULT 6,
  open_to         INT     NOT NULL DEFAULT 19,
  price_singles   INT     NOT NULL DEFAULT 400,
  price_doubles   INT     NOT NULL DEFAULT 600,
  whatsapp        TEXT    DEFAULT '9779841044844',
  qr_url          TEXT
);

-- Seed the single config row
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_settings" ON settings;
DROP POLICY IF EXISTS "auth_all_settings"    ON settings;

-- Public booking app can read settings (anon)
CREATE POLICY "anon_select_settings" ON settings
  FOR SELECT TO anon USING (true);

-- Admin can update settings (authenticated)
CREATE POLICY "auth_all_settings" ON settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
