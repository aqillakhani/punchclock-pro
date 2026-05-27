import { randomBytes, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

/**
 * Password reset / invite-setup tokens.
 *
 * The raw token is sent only in the emailed link; the database stores just
 * its SHA-256 hash, so a database leak doesn't expose usable reset links.
 * Tokens are single-use and short-lived. Pre-auth flows query these with
 * RLS bypassed (system context), since the requester isn't authenticated.
 */

export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetTokenExpiry(now: Date, ttlMinutes = 15): Date {
  return new Date(now.getTime() + ttlMinutes * 60_000);
}

export function isTokenUsable(
  row: { expires_at: string | Date; used_at: string | Date | null },
  now: Date,
): boolean {
  if (row.used_at) return false;
  return new Date(row.expires_at).getTime() > now.getTime();
}

// ---- DB helpers (thin; run under withTenantTx(null, ...) — pre-auth) ----

export interface ResetUser {
  id: string;
  organization_id: string;
  email: string;
  first_name: string | null;
}

export async function findActiveUserByEmail(
  client: PoolClient,
  email: string,
): Promise<ResetUser | null> {
  const { rows } = await client.query<ResetUser>(
    `SELECT id, organization_id, email, first_name
     FROM users
     WHERE email = $1 AND deleted_at IS NULL AND status = 'active'
     LIMIT 1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function storeResetToken(
  client: PoolClient,
  args: { organizationId: string; userId: string; tokenHash: string; expiresAt: Date },
): Promise<void> {
  await client.query(
    `INSERT INTO password_reset_tokens (organization_id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [args.organizationId, args.userId, args.tokenHash, args.expiresAt],
  );
}

export interface ResetTokenRow {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

export async function findResetTokenByHash(
  client: PoolClient,
  tokenHash: string,
): Promise<ResetTokenRow | null> {
  const { rows } = await client.query<ResetTokenRow>(
    `SELECT id, user_id, expires_at, used_at
     FROM password_reset_tokens WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function applyPasswordReset(
  client: PoolClient,
  args: { tokenId: string; userId: string; passwordHash: string },
): Promise<void> {
  await client.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    args.passwordHash,
    args.userId,
  ]);
  await client.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [
    args.tokenId,
  ]);
}
