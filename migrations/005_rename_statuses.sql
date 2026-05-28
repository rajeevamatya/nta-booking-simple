-- Migration 005: Rename booking statuses to clearer names
-- Safe to re-run — UPDATE WHERE is idempotent if already applied

UPDATE bookings SET status = 'Awaiting Payment'    WHERE status = 'Pending Payment';
UPDATE bookings SET status = 'Pending Verification' WHERE status = 'Payment Submitted';
UPDATE bookings SET status = 'Confirmed'            WHERE status = 'Paid';

-- Add CHECK constraint to enforce valid statuses going forward
ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status = ANY (ARRAY[
    'Awaiting Payment',
    'Pending Verification',
    'Confirmed',
    'Cancelled'
  ]));
