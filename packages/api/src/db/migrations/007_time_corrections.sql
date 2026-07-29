-- =====================================================================
-- 007_time_corrections.sql
--
-- Two related changes to make the time record both CORRECT and FIXABLE.
--
-- 1. Break accounting. `time_entries.duration_minutes` was raw
--    wall-clock (punch_out - punch_in) and nothing ever subtracted
--    unpaid break time, so a worker taking a 30-minute unpaid lunch was
--    paid for it. Every consumer sums `duration_minutes`, so the fix is
--    to redefine that column as PAYABLE minutes and keep the raw number
--    alongside it:
--
--      gross_minutes        = punch_out - punch_in   (wall clock)
--      unpaid_break_minutes = SUM(lunch + unpaid breaks)
--      duration_minutes     = gross - unpaid         (what payroll pays)
--
--    Paid rest breaks (break_type='standard') are deliberately NOT
--    deducted — under the FLSA short rest breaks are compensable.
--
--    Existing rows are backfilled, which changes historical totals for
--    anyone who logged an unpaid break. That is the point: those totals
--    were overstated. See the reconciliation query at the bottom of this
--    file to quantify the change before/after applying.
--
-- 2. `time_correction_requests` — the employee-initiated workflow for
--    fixing a punch after the fact, mirroring the time-off request
--    pattern (pending → approved/rejected, with an approver and a
--    decision timestamp).
--
--    Approving a request does NOT rewrite history: the original
--    punch_in/punch_out rows in `time_entry_events` stay exactly as
--    recorded. The approval appends a new `entry_edited` event and
--    updates the `time_entries` projection, so the immutable log still
--    shows what was originally punched and who changed it afterwards.
--
-- Forward-only and idempotent — re-running the file is a no-op.
-- =====================================================================

BEGIN;

-- ---- 1. Break-aware minute accounting on time_entries --------------

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS gross_minutes        INT,
  ADD COLUMN IF NOT EXISTS unpaid_break_minutes INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN time_entries.duration_minutes IS
  'PAYABLE minutes = gross_minutes - unpaid_break_minutes. Summed by timesheets and payroll export.';
COMMENT ON COLUMN time_entries.gross_minutes IS
  'Wall-clock minutes between punch_in_at and punch_out_at, before break deduction.';
COMMENT ON COLUMN time_entries.unpaid_break_minutes IS
  'Completed lunch/unpaid break minutes on this entry. Paid rest breaks are excluded.';

-- Backfill in three passes, each independently idempotent so a re-run
-- can never double-deduct.

-- (a) Preserve what was recorded: today's duration_minutes IS the gross.
--     Guarded on NULL so a second run does not overwrite a real gross
--     with an already-netted duration.
UPDATE time_entries
SET gross_minutes = duration_minutes
WHERE gross_minutes IS NULL
  AND duration_minutes IS NOT NULL;

-- (b) Attribute completed unpaid breaks to their entry.
UPDATE time_entries te
SET unpaid_break_minutes = u.minutes
FROM (
  SELECT time_entry_id,
         COALESCE(SUM(duration_minutes), 0)::int AS minutes
  FROM breaks
  WHERE status = 'completed'
    AND break_type IN ('lunch', 'unpaid')
  GROUP BY time_entry_id
) u
WHERE u.time_entry_id = te.id
  AND te.unpaid_break_minutes IS DISTINCT FROM u.minutes;

-- (c) Recompute payable minutes from the two columns above. Stable
--     under repetition because it derives from gross, not from itself.
UPDATE time_entries
SET duration_minutes = GREATEST(0, gross_minutes - unpaid_break_minutes)
WHERE gross_minutes IS NOT NULL
  AND duration_minutes IS DISTINCT FROM GREATEST(0, gross_minutes - unpaid_break_minutes);

-- Open (in-progress) entries have no duration yet; leave them null and
-- let punch-out compute both columns.

ALTER TABLE time_entries
  DROP CONSTRAINT IF EXISTS time_entries_minutes_nonneg;
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_minutes_nonneg
  CHECK (
    (duration_minutes IS NULL OR duration_minutes >= 0)
    AND (gross_minutes IS NULL OR gross_minutes >= 0)
    AND unpaid_break_minutes >= 0
  );


-- ---- 2. Time correction requests -----------------------------------

CREATE TABLE IF NOT EXISTS time_correction_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Whose time record this is about. Normally the requester, but a
  -- manager may file on a worker's behalf (e.g. a phone died on site).
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- NULL for request_type='add_entry' — there is no entry yet.
  time_entry_id      UUID REFERENCES time_entries(id) ON DELETE CASCADE,

  request_type       TEXT NOT NULL
    CHECK (request_type IN ('edit_times', 'add_entry', 'delete_entry')),

  -- Snapshot of the record as it stood when the request was filed, so
  -- the approver sees a true before/after even if something else
  -- changed in the meantime.
  original_punch_in_at   TIMESTAMPTZ,
  original_punch_out_at  TIMESTAMPTZ,

  -- What the worker is asking for. Null punch-out on an edit means
  -- "leave it as it is"; add_entry requires both.
  requested_punch_in_at  TIMESTAMPTZ,
  requested_punch_out_at TIMESTAMPTZ,

  -- Mandatory: every competitor requires a justification, and a DOL
  -- audit wants to know why a time record moved.
  reason             TEXT NOT NULL CHECK (length(btrim(reason)) > 0),

  status             TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

  decided_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  decision_note      TEXT,

  -- The entry created or updated when the request was approved.
  applied_entry_id   UUID REFERENCES time_entries(id) ON DELETE SET NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- An edit or delete must name the entry it targets; an add must not.
  CONSTRAINT correction_entry_ref_ok CHECK (
    (request_type = 'add_entry' AND time_entry_id IS NULL)
    OR (request_type <> 'add_entry' AND time_entry_id IS NOT NULL)
  ),
  -- A new entry needs both ends of the shift.
  CONSTRAINT correction_add_needs_both_times CHECK (
    request_type <> 'add_entry'
    OR (requested_punch_in_at IS NOT NULL AND requested_punch_out_at IS NOT NULL)
  ),
  -- An edit has to actually request something.
  CONSTRAINT correction_edit_needs_a_time CHECK (
    request_type <> 'edit_times'
    OR (requested_punch_in_at IS NOT NULL OR requested_punch_out_at IS NOT NULL)
  ),
  -- Never let an approved shift end before it starts.
  CONSTRAINT correction_times_ordered CHECK (
    requested_punch_in_at IS NULL
    OR requested_punch_out_at IS NULL
    OR requested_punch_out_at > requested_punch_in_at
  ),
  -- A decided request must record who decided it and when.
  CONSTRAINT correction_decision_complete CHECK (
    status NOT IN ('approved', 'rejected')
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_corrections_org_status
  ON time_correction_requests(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_corrections_user
  ON time_correction_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_corrections_entry
  ON time_correction_requests(time_entry_id)
  WHERE time_entry_id IS NOT NULL;

-- At most one pending request per time entry — otherwise two approvals
-- race and the second silently overwrites the first.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_corrections_one_pending_per_entry
  ON time_correction_requests(time_entry_id)
  WHERE status = 'pending' AND time_entry_id IS NOT NULL;


-- ---- Row-level security (same pattern as 002/003) ------------------

ALTER TABLE time_correction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_correction_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON time_correction_requests;
CREATE POLICY tenant_isolation ON time_correction_requests
  USING (rls_bypass() OR organization_id = current_org_id())
  WITH CHECK (rls_bypass() OR organization_id = current_org_id());

DROP TRIGGER IF EXISTS time_correction_requests_updated_at ON time_correction_requests;
CREATE TRIGGER time_correction_requests_updated_at
  BEFORE UPDATE ON time_correction_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- =====================================================================
-- Reconciliation helper — run AFTER applying to see the payroll impact
-- of the break backfill. Zero rows means no historical entry had an
-- unpaid break, and no reported total changed.
--
--   SELECT u.email,
--          COUNT(*)                        AS entries_adjusted,
--          SUM(te.unpaid_break_minutes)/60.0 AS hours_removed
--   FROM time_entries te
--   JOIN users u ON u.id = te.user_id
--   WHERE te.unpaid_break_minutes > 0
--   GROUP BY u.email
--   ORDER BY hours_removed DESC;
-- =====================================================================
