-- 012_intake_pointer_calendar_columns.sql
--
-- Adds the two columns the booking-guard confirm handler writes when it
-- promotes a soft-hold into an appointment:
--   appointment_time     — UTC ISO 8601 start time of the booked slot
--   therapist_staff_id   — Jane staff ID the appointment is with
--
-- Both are nullable: existing pointers (from the older booking flow that
-- pre-dated the calendar integration) don't have these values.

ALTER TABLE bt.intake_pointers
    ADD COLUMN IF NOT EXISTS appointment_time   timestamptz,
    ADD COLUMN IF NOT EXISTS therapist_staff_id integer;

CREATE INDEX IF NOT EXISTS intake_pointers_therapist_time_idx
    ON bt.intake_pointers (therapist_staff_id, appointment_time DESC)
    WHERE therapist_staff_id IS NOT NULL AND purged_at IS NULL;
