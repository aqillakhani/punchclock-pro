-- =====================================================================
-- 005_password_reset_tokens.sql
-- Single-use, short-lived tokens for password reset and invite setup.
-- Only the SHA-256 hash of the token is stored; the raw token lives only
-- in the emailed link. Pre-auth flows query this table with bypass_rls.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON password_reset_tokens;
CREATE POLICY tenant_isolation ON password_reset_tokens
  USING (rls_bypass() OR organization_id = current_org_id())
  WITH CHECK (rls_bypass() OR organization_id = current_org_id());

COMMIT;
