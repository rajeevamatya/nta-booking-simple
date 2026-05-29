-- Migration 008: Add player_type to members
-- Replaces the boolean is_ranked with a three-value type: recreational | ranked | coach
-- Safe to re-run — uses IF NOT EXISTS and idempotent UPDATE

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS player_type TEXT NOT NULL DEFAULT 'recreational';

-- Backfill existing rows from is_ranked
UPDATE members
  SET player_type = 'ranked'
  WHERE is_ranked = TRUE AND player_type = 'recreational';

ALTER TABLE members
  DROP CONSTRAINT IF EXISTS members_player_type_check;

ALTER TABLE members
  ADD CONSTRAINT members_player_type_check
  CHECK (player_type = ANY (ARRAY['recreational', 'ranked', 'coach']));
