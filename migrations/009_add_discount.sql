-- Migration 009: Add discount_percent to settings
-- Applied to ranked and coach players. Default 25%.
-- Safe to re-run — uses IF NOT EXISTS and ON CONFLICT DO NOTHING

ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS discount_percent INT NOT NULL DEFAULT 25;
