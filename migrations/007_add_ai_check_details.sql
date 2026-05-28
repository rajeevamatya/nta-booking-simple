-- Migration 007: Add ai_check_details column to bookings
-- Stores per-check breakdown from payment verification (amount, date, receiver, sender)

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ai_check_details JSONB;
