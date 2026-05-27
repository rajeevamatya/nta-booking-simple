-- Run this in Supabase SQL editor (Dashboard → SQL Editor)
-- Adds ai_checked column to bookings — defaults to false.
-- Safe to re-run (uses IF NOT EXISTS).

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ai_checked BOOLEAN NOT NULL DEFAULT FALSE;
