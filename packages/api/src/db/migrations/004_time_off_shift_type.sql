-- =====================================================================
-- 004_time_off_shift_type.sql
--
-- Adds a `time_off` value to the shift_type enum so that approved
-- time-off requests can be materialized as a placeholder shift row
-- (start='00:00', end='23:59') per affected date. The schedule UI
-- renders these as PTO bars rather than coverage shifts, and the
-- Phase D conflict detector can refuse overlap insertions without a
-- separate cross-table query.
--
-- ALTER TYPE … ADD VALUE is forward-only; nothing to drop.
-- =====================================================================

BEGIN;

ALTER TYPE shift_type ADD VALUE IF NOT EXISTS 'time_off';

COMMIT;
