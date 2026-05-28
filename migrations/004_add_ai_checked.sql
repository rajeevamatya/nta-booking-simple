-- Migration 004: Add ai_checked column to bookings
-- Safe to re-run — uses IF NOT EXISTS
-- Note: 002_create_bookings.sql already includes this column for fresh installs.
-- Only needed if upgrading an existing database created before migration 004.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ai_checked BOOLEAN NOT NULL DEFAULT FALSE;
