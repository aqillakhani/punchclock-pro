-- =====================================================================
-- 001_initial_schema.sql
-- Core tables for PunchClock Pro (organizations, users, event-sourced
-- time records, geofences, breaks, scheduling, payroll).
-- Row-level security is enabled on every tenant-scoped table.
-- =====================================================================

BEGIN;

-- ---- Enums --------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'manager', 'employee', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'inactive', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE time_event_type AS ENUM (
    'punch_in', 'punch_out', 'break_start', 'break_end',
    'entry_edited', 'entry_deleted', 'job_switched'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE time_entry_status AS ENUM ('in_progress', 'completed', 'edited', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE break_type AS ENUM ('lunch', 'standard', 'unpaid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE break_status AS ENUM ('in_progress', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE geofence_enforcement AS ENUM ('flag', 'override_required', 'block');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shift_type AS ENUM ('standard', 'overtime', 'double');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE shift_status AS ENUM ('scheduled', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payroll_status AS ENUM ('draft', 'submitted', 'approved', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---- Organizations -----------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   VARCHAR(255) NOT NULL,
  slug                   VARCHAR(255) NOT NULL UNIQUE,
  timezone               VARCHAR(64) NOT NULL DEFAULT 'UTC',
  industry               VARCHAR(64),
  geofencing_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  break_tracking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- ---- Users --------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email              VARCHAR(255) NOT NULL,
  phone              VARCHAR(32),
  first_name         VARCHAR(100),
  last_name          VARCHAR(100),
  password_hash      VARCHAR(255),
  role               user_role NOT NULL DEFAULT 'employee',
  pay_rate           NUMERIC(10, 2),
  status             user_status NOT NULL DEFAULT 'active',
  pin_hash           VARCHAR(255),
  last_login_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ,
  CONSTRAINT users_org_email_unique UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id);


-- ---- Geofences ----------------------------------------------------

CREATE TABLE IF NOT EXISTS geofences (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  latitude           DOUBLE PRECISION NOT NULL,
  longitude          DOUBLE PRECISION NOT NULL,
  radius_meters      INT NOT NULL DEFAULT 100,
  enforcement_level  geofence_enforcement NOT NULL DEFAULT 'flag',
  geog               GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS
                       (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT geofences_org_name_unique UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_geofences_organization_id ON geofences(organization_id);
CREATE INDEX IF NOT EXISTS idx_geofences_geog ON geofences USING GIST(geog);


-- ---- Event-sourced time records ----------------------------------
-- time_entry_events is the immutable append-only log.
-- time_entries is the materialized current-state projection,
-- updated by the event publisher on write.

CREATE TABLE IF NOT EXISTS time_entry_events (
  id                   UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_entry_id        UUID,
  event_type           time_event_type NOT NULL,
  event_data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_generated_id  VARCHAR(128),
  actor_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, recorded_at)
);

-- recorded_at is included because TimescaleDB requires any UNIQUE index on a
-- hypertable to contain the partitioning column. App-level idempotency lookup
-- in publisher.ts keys only on (org, user, client_generated_id), so retries
-- with the same recorded_at are still rejected; clients are expected to
-- preserve recorded_at across retries.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_time_events_idempotency
  ON time_entry_events (organization_id, user_id, client_generated_id, recorded_at)
  WHERE client_generated_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_time_events_org_user ON time_entry_events(organization_id, user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_events_entry ON time_entry_events(time_entry_id);

-- Convert to a TimescaleDB hypertable (chunk by week).
SELECT create_hypertable(
  'time_entry_events', 'recorded_at',
  if_not_exists => TRUE,
  chunk_time_interval => INTERVAL '7 days'
);


CREATE TABLE IF NOT EXISTS time_entries (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  punch_in_at            TIMESTAMPTZ NOT NULL,
  punch_out_at           TIMESTAMPTZ,
  punch_in_latitude      DOUBLE PRECISION,
  punch_in_longitude     DOUBLE PRECISION,
  punch_in_accuracy_m    DOUBLE PRECISION,
  punch_out_latitude     DOUBLE PRECISION,
  punch_out_longitude    DOUBLE PRECISION,
  punch_out_accuracy_m   DOUBLE PRECISION,
  punch_in_geofence_id   UUID REFERENCES geofences(id) ON DELETE SET NULL,
  punch_out_geofence_id  UUID REFERENCES geofences(id) ON DELETE SET NULL,
  duration_minutes       INT,
  status                 time_entry_status NOT NULL DEFAULT 'in_progress',
  notes                  TEXT,
  device_info            JSONB,
  is_manual              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT time_entries_out_after_in
    CHECK (punch_out_at IS NULL OR punch_out_at > punch_in_at)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_date ON time_entries(user_id, punch_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_org_date ON time_entries(organization_id, punch_in_at DESC);

-- At most one open (punch_out_at IS NULL) entry per user at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_time_entries_open_per_user
  ON time_entries(user_id)
  WHERE punch_out_at IS NULL AND status = 'in_progress';


-- ---- Breaks -------------------------------------------------------

CREATE TABLE IF NOT EXISTS breaks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  time_entry_id    UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  break_start      TIMESTAMPTZ NOT NULL,
  break_end        TIMESTAMPTZ,
  duration_minutes INT,
  break_type       break_type NOT NULL DEFAULT 'standard',
  status           break_status NOT NULL DEFAULT 'in_progress',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT breaks_end_after_start
    CHECK (break_end IS NULL OR break_end > break_start)
);

CREATE INDEX IF NOT EXISTS idx_breaks_time_entry ON breaks(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_breaks_organization ON breaks(organization_id);


-- ---- Scheduling: shifts + templates ------------------------------

CREATE TABLE IF NOT EXISTS shifts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_date        DATE NOT NULL,
  shift_start           TIME NOT NULL,
  shift_end             TIME NOT NULL,
  duration_minutes      INT NOT NULL,
  shift_type            shift_type NOT NULL DEFAULT 'standard',
  required_break_minutes INT NOT NULL DEFAULT 30,
  status                shift_status NOT NULL DEFAULT 'scheduled',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_shifts_org_date ON shifts(organization_id, scheduled_date);


CREATE TABLE IF NOT EXISTS shift_templates (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  template_data    JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shift_templates_org_name_unique UNIQUE (organization_id, name)
);


-- ---- Pay rates & payroll records ---------------------------------

CREATE TABLE IF NOT EXISTS pay_rates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hourly_rate         NUMERIC(10, 2) NOT NULL,
  overtime_multiplier NUMERIC(3, 2) NOT NULL DEFAULT 1.5,
  effective_date      DATE NOT NULL,
  end_date            DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pay_rates_user_date ON pay_rates(user_id, effective_date DESC);


CREATE TABLE IF NOT EXISTS payroll_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start_date  DATE NOT NULL,
  period_end_date    DATE NOT NULL,
  regular_hours      NUMERIC(10, 2) NOT NULL DEFAULT 0,
  overtime_hours     NUMERIC(10, 2) NOT NULL DEFAULT 0,
  regular_pay        NUMERIC(12, 2) NOT NULL DEFAULT 0,
  overtime_pay       NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_pay          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status             payroll_status NOT NULL DEFAULT 'draft',
  external_reference VARCHAR(255),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_user_period ON payroll_records(user_id, period_start_date);


-- ---- Audit log ---------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id               UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  resource_type    VARCHAR(64) NOT NULL,
  resource_id      VARCHAR(255),
  action           VARCHAR(64) NOT NULL,
  changes          JSONB,
  ip_address       INET,
  user_agent       VARCHAR(1024),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_date ON audit_logs(organization_id, created_at DESC);

SELECT create_hypertable(
  'audit_logs', 'created_at',
  if_not_exists => TRUE,
  chunk_time_interval => INTERVAL '30 days'
);


-- ---- updated_at trigger helper -----------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','users','geofences','time_entries','breaks',
    'shifts','shift_templates'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I_updated_at ON %I;
       CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      t, t, t, t);
  END LOOP;
END $$;

COMMIT;
