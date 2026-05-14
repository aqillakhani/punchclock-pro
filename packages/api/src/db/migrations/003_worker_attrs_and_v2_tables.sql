-- =====================================================================
-- 003_worker_attrs_and_v2_tables.sql
--
-- MVP v2 — Phase A foundation.
--   - Promote worker classification (W-2 vs 1099, onshore vs offshore)
--     to first-class columns on `users`, plus pay-currency, manager
--     cap-exempt window, and a selfie-reference URL.
--   - Add hard-cap settings, accounting hooks, and v2 feature flags to
--     `organizations`. All flags default to off unless the design doc
--     §4 marks them as low-risk-on (documents/time_off/trades/push).
--   - Create the four v2 tables (time_off_requests, shift_trades,
--     cash_drawer_counts, employee_documents) with the same RLS
--     pattern used in 002.
--
-- Forward-only and idempotent — re-running the file is a no-op.
-- =====================================================================

BEGIN;

-- ---- New enums ----------------------------------------------------

DO $$ BEGIN
  CREATE TYPE worker_type AS ENUM ('W2', 'contractor_1099');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE worksite AS ENUM ('onshore', 'offshore');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---- Users: worker classification + cap-exempt window -------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS worker_type      worker_type NOT NULL DEFAULT 'W2',
  ADD COLUMN IF NOT EXISTS worksite         worksite    NOT NULL DEFAULT 'onshore',
  ADD COLUMN IF NOT EXISTS job_title        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pay_currency     CHAR(3)     NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS cap_exempt_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS photo_url        TEXT;

CREATE INDEX IF NOT EXISTS idx_users_worker_type
  ON users(organization_id, worker_type);

CREATE INDEX IF NOT EXISTS idx_users_worksite
  ON users(organization_id, worksite);


-- ---- Organizations: caps, accounting, feature flags ---------------

ALTER TABLE organizations
  -- Hard caps. Defaults match owner's stated 8h/40h limits.
  ADD COLUMN IF NOT EXISTS max_daily_minutes  INT NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS max_weekly_minutes INT NOT NULL DEFAULT 2400,
  ADD COLUMN IF NOT EXISTS cap_enforcement    TEXT NOT NULL DEFAULT 'block'
    CHECK (cap_enforcement IN ('off', 'warn', 'block')),
  -- Labor cost budgeting + QuickBooks chart-of-accounts mapping.
  ADD COLUMN IF NOT EXISTS weekly_labor_budget   NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS qb_chart_of_accounts  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Cross-currency support for offshore contractors. JSONB so the owner
  -- can set whatever pairs they need without a schema change.
  ADD COLUMN IF NOT EXISTS fx_rates              JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- v2 feature flags. Off by default unless explicitly low-risk.
  ADD COLUMN IF NOT EXISTS feature_cash_drawer           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS feature_kiosk_qr              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS feature_predictive_scheduling BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS feature_documents             BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS feature_time_off              BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS feature_shift_trades          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS feature_push_notifications    BOOLEAN NOT NULL DEFAULT TRUE,
  -- Anti-buddy-punching multi-select. Subset of
  --   ('selfie' | 'pin' | 'ip' | 'device').
  -- Empty array = nothing extra beyond the existing geofence.
  ADD COLUMN IF NOT EXISTS punch_verification_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- CIDR ranges for IP-restricted punches. Only consulted when
  -- 'ip' is in punch_verification_methods.
  ADD COLUMN IF NOT EXISTS allowed_punch_cidrs        JSONB NOT NULL DEFAULT '[]'::jsonb;


-- ---- Time-off requests --------------------------------------------

CREATE TABLE IF NOT EXISTS time_off_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT time_off_requests_dates_ok CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_org_user
  ON time_off_requests(organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_time_off_requests_org_status
  ON time_off_requests(organization_id, status);


-- ---- Shift trades --------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id        UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  from_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'approved', 'rejected', 'cancelled')),
  decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shift_trades_org_status
  ON shift_trades(organization_id, status);

CREATE INDEX IF NOT EXISTS idx_shift_trades_shift_id
  ON shift_trades(shift_id);

CREATE INDEX IF NOT EXISTS idx_shift_trades_from_user
  ON shift_trades(from_user_id);


-- ---- Cash drawer counts -------------------------------------------

CREATE TABLE IF NOT EXISTS cash_drawer_counts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_entry_id   UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  count_type      TEXT NOT NULL CHECK (count_type IN ('start', 'end')),
  expected_cents  BIGINT,
  counted_cents   BIGINT NOT NULL,
  -- Variance defaults to 0 when no register integration provides an
  -- expected value (COALESCE keeps the GENERATED expression total).
  variance_cents  BIGINT GENERATED ALWAYS AS
    (counted_cents - COALESCE(expected_cents, counted_cents)) STORED,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_org_user_type
  ON cash_drawer_counts(organization_id, user_id, count_type);

CREATE INDEX IF NOT EXISTS idx_cash_drawer_time_entry
  ON cash_drawer_counts(time_entry_id);


-- ---- Employee documents -------------------------------------------

CREATE TABLE IF NOT EXISTS employee_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL,
  storage_url     TEXT,
  expires_at      DATE,
  verified_at     TIMESTAMPTZ,
  verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_org_user
  ON employee_documents(organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_employee_documents_expires
  ON employee_documents(organization_id, expires_at)
  WHERE expires_at IS NOT NULL;


-- ---- Row-level security for the four new tables -------------------
-- Same pattern as 002: bypass via the `app.bypass_rls` GUC, otherwise
-- filter by `organization_id = current_org_id()`.

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'time_off_requests', 'shift_trades',
    'cash_drawer_counts', 'employee_documents'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (rls_bypass() OR organization_id = current_org_id())
         WITH CHECK (rls_bypass() OR organization_id = current_org_id());',
      t);
  END LOOP;
END $$;


-- ---- updated_at triggers for new tables that carry one ------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['time_off_requests', 'shift_trades']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I_updated_at ON %I;
       CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t, t, t, t);
  END LOOP;
END $$;

COMMIT;
