-- =====================================================================
-- 002_row_level_security.sql
-- Enable row-level security. Every tenant-scoped table is filtered by
-- the session-local setting `app.current_org_id`, which is set by the
-- API middleware on every request based on the authenticated user's
-- JWT claims. A `bypass_rls` GUC allows the migration runner and
-- background jobs to opt out.
-- =====================================================================

BEGIN;

-- A small helper that reads the current organization from settings.
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID LANGUAGE plpgsql STABLE AS $$
DECLARE
  v TEXT;
BEGIN
  v := current_setting('app.current_org_id', TRUE);
  IF v IS NULL OR v = '' THEN
    RETURN NULL;
  END IF;
  RETURN v::UUID;
END
$$;

CREATE OR REPLACE FUNCTION rls_bypass()
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
DECLARE v TEXT;
BEGIN
  v := current_setting('app.bypass_rls', TRUE);
  RETURN v = 'on';
END
$$;

-- Enable RLS on all tenant-scoped tables.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'organizations','users','geofences','time_entry_events','time_entries',
    'breaks','shifts','shift_templates','pay_rates','payroll_records',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- Policies -----------------------------------------------------------

-- organizations: a user sees only their own org.
DROP POLICY IF EXISTS org_isolation ON organizations;
CREATE POLICY org_isolation ON organizations
  USING (rls_bypass() OR id = current_org_id())
  WITH CHECK (rls_bypass() OR id = current_org_id());

-- For every tenant-scoped table, filter by organization_id.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','geofences','time_entry_events','time_entries','breaks',
    'shifts','shift_templates','pay_rates','payroll_records',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (rls_bypass() OR organization_id = current_org_id())
         WITH CHECK (rls_bypass() OR organization_id = current_org_id());',
      t);
  END LOOP;
END $$;

COMMIT;
