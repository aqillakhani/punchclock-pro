-- =====================================================================
-- 006_audit_log_retention.sql
--
-- Add audit log retention configuration to organizations.
-- Organizations can set a per-tenant retention window (in days) to control
-- how long audit logs are kept before automatic pruning.
-- Minimum retention is 30 days (sane floor for compliance and debugging).
--
-- Forward-only; re-running is a no-op.
-- =====================================================================

BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS audit_logs_retention_days INTEGER NOT NULL DEFAULT 365
    CHECK (audit_logs_retention_days >= 30);

COMMIT;
