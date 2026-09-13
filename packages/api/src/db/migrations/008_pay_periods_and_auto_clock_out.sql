-- =====================================================================
-- 008_pay_periods_and_auto_clock_out.sql
--
-- Two protections for the time record, both gaps the market audit flagged.
--
-- 1. PAY PERIOD LOCKING. Once payroll has been run for a period, nothing
--    may retroactively change the hours in it — otherwise an approved
--    correction silently contradicts a payroll run that already went out
--    the door.
--
--    Period boundaries are DERIVED from the organization's schedule
--    (type + anchor date) rather than materialized on a cron, so there is
--    no job to fall behind. A row exists in `pay_periods` only once a
--    period has actually been locked; anything with no row is open. That
--    keeps "is this date locked?" a single indexed lookup and means the
--    table stays tiny.
--
-- 2. AUTO CLOCK-OUT. A forgotten punch-out otherwise leaves an entry
--    open forever, which blocks the worker's next punch-in (the partial
--    unique index allows only one open entry per user) and inflates
--    hours without bound.
--
--    Deliberately DISABLED by default (`auto_clock_out_minutes` NULL).
--    Enabling it changes what people are paid, so an existing
--    installation must opt in rather than discover it after the fact.
--
-- Forward-only and idempotent — re-running the file is a no-op.
-- =====================================================================

BEGIN;

-- ---- Organization-level configuration ------------------------------

ALTER TABLE organizations
  -- How the payroll calendar is cut. 'anchor' is any date known to be the
  -- FIRST day of a period; every other boundary is computed from it.
  ADD COLUMN IF NOT EXISTS pay_period_type TEXT NOT NULL DEFAULT 'biweekly'
    CHECK (pay_period_type IN ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  ADD COLUMN IF NOT EXISTS pay_period_anchor_date DATE NOT NULL DEFAULT DATE '2026-01-05',
  -- NULL = auto clock-out is off. When set, an entry open longer than
  -- this many minutes is closed at punch_in + this many minutes.
  ADD COLUMN IF NOT EXISTS auto_clock_out_minutes INT
    CHECK (auto_clock_out_minutes IS NULL
           OR (auto_clock_out_minutes >= 60 AND auto_clock_out_minutes <= 1440));

COMMENT ON COLUMN organizations.pay_period_anchor_date IS
  'Any date that is the first day of a pay period; all boundaries derive from it.';
COMMENT ON COLUMN organizations.auto_clock_out_minutes IS
  'NULL disables auto clock-out. Otherwise an open entry is closed at punch_in + this many minutes.';


-- ---- Pay periods ----------------------------------------------------
-- A row here means "this period has been locked at least once". Absence
-- means open, so the common case costs nothing to store.

CREATE TABLE IF NOT EXISTS pay_periods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'locked'
    CHECK (status IN ('open', 'locked')),
  locked_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_at        TIMESTAMPTZ,
  -- Kept after an unlock so the audit trail survives re-locking.
  unlocked_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  unlocked_at      TIMESTAMPTZ,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pay_periods_dates_ok CHECK (end_date >= start_date),
  -- One row per period per org; start_date identifies the period.
  CONSTRAINT pay_periods_org_start_unique UNIQUE (organization_id, start_date),
  -- A locked period must say who locked it and when.
  CONSTRAINT pay_periods_lock_complete CHECK (
    status <> 'locked' OR (locked_by IS NOT NULL AND locked_at IS NOT NULL)
  )
);

-- The hot path: "is <date> inside a locked period for this org?".
CREATE INDEX IF NOT EXISTS idx_pay_periods_lookup
  ON pay_periods(organization_id, start_date, end_date)
  WHERE status = 'locked';


-- ---- Auto clock-out marker on the entry -----------------------------

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS auto_closed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN time_entries.auto_closed IS
  'True when the system closed this entry because it exceeded auto_clock_out_minutes. The worker is expected to file a correction if the time is wrong.';

-- Finding entries eligible for auto-closing is a background sweep across
-- all organizations, so it wants an index on the open ones only.
CREATE INDEX IF NOT EXISTS idx_time_entries_open
  ON time_entries(organization_id, punch_in_at)
  WHERE punch_out_at IS NULL AND status = 'in_progress';


-- ---- Row-level security (same pattern as 002/003/007) ---------------

ALTER TABLE pay_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pay_periods;
CREATE POLICY tenant_isolation ON pay_periods
  USING (rls_bypass() OR organization_id = current_org_id())
  WITH CHECK (rls_bypass() OR organization_id = current_org_id());

DROP TRIGGER IF EXISTS pay_periods_updated_at ON pay_periods;
CREATE TRIGGER pay_periods_updated_at
  BEFORE UPDATE ON pay_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
