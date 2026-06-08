-- 000_extensions.sql
--
-- Postgres extensions required by PunchClock Pro, created as the FIRST
-- migration so that production databases have them before 001 builds
-- TimescaleDB hypertables and PostGIS geography columns.
--
-- Why this exists: in local Docker, src/db/init/00-extensions.sql is run
-- automatically by the Postgres entrypoint. Managed/self-hosted production
-- databases do NOT run that init script, and migrate.ts only executes files
-- under src/db/migrations — so without this file the very first deploy fails
-- at `create_hypertable(...)` in 001 ("function does not exist").
--
-- Idempotent (IF NOT EXISTS) and runs in its own transaction, so:
--   * it is a no-op where the init script already created the extensions, and
--   * timescaledb is committed before 001's create_hypertable() calls run.

-- TimescaleDB first: 001 calls create_hypertable(), which needs it present.
-- (Requires `shared_preload_libraries = 'timescaledb'` on the server.)
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Spatial types + distance functions for geofencing.
CREATE EXTENSION IF NOT EXISTS postgis;

-- UUID generation + crypto helpers used by table column defaults.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
