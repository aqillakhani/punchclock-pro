/**
 * Punch-verification — design §3d (anti-buddy-punching).
 *
 * Loads the org's configured methods + per-user state, then runs
 * each enabled method in order. Geofence stays separate (already
 * enforced upstream). Offshore workers are skipped for IP rules.
 *
 * Pure CIDR check kept out of any database / express dep so the
 * unit tests don't need a network stack.
 */
import type { PoolClient } from 'pg';
import bcrypt from 'bcrypt';
import { AppError } from '../lib/errors.js';

export type PunchVerificationMethod = 'selfie' | 'pin' | 'ip' | 'device';

export interface VerificationContext {
  enabledMethods: PunchVerificationMethod[];
  allowedCidrs: string[];
  userWorksite: 'onshore' | 'offshore';
  userPinHash: string | null;
}

/**
 * Returns true if `ip` (an IPv4 string) falls inside `cidr`
 * (e.g. "73.42.18.0/24"). Two practical conveniences:
 *
 *   - "::/0" is treated as a wildcard that matches any IP, including
 *     IPv6. Owners who want "any network" don't need to know about
 *     dual-stack quirks.
 *   - Express's IPv6-mapped IPv4 form (::ffff:73.42.18.5) and the
 *     IPv6 loopback (::1, treated as 127.0.0.1) are normalized to
 *     IPv4 before the prefix comparison runs.
 *
 * True IPv6 prefix matching is deferred — the c-store deployment
 * target is single-WAN IPv4 for the foreseeable future.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
  if (cidr === '::/0') return true;

  let normalized = ip;
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice('::ffff:'.length);
  } else if (normalized === '::1') {
    normalized = '127.0.0.1';
  }
  if (!isIPv4(normalized)) return false;
  const [range, bitsRaw] = cidr.split('/');
  if (!range || !bitsRaw) return false;
  if (!isIPv4(range)) return false;
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipInt = ipv4ToInt(normalized);
  const rangeInt = ipv4ToInt(range);
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export function ipInAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  return cidrs.some((c) => ipInCidr(ip, c));
}

function isIPv4(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function ipv4ToInt(ip: string): number {
  const [a = 0, b = 0, c = 0, d = 0] = ip.split('.').map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export interface OrgVerificationConfig {
  enabledMethods: PunchVerificationMethod[];
  allowedCidrs: string[];
}

export async function loadOrgVerificationConfig(db: PoolClient): Promise<OrgVerificationConfig> {
  const { rows } = await db.query<{
    punch_verification_methods: unknown;
    allowed_punch_cidrs: unknown;
  }>(`SELECT punch_verification_methods, allowed_punch_cidrs FROM organizations LIMIT 1`);
  const row = rows[0];
  return {
    enabledMethods: Array.isArray(row?.punch_verification_methods)
      ? (row.punch_verification_methods as PunchVerificationMethod[]).filter(
          (m): m is PunchVerificationMethod =>
            m === 'selfie' || m === 'pin' || m === 'ip' || m === 'device',
        )
      : [],
    allowedCidrs: Array.isArray(row?.allowed_punch_cidrs)
      ? (row.allowed_punch_cidrs as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
  };
}

export async function loadUserVerificationState(
  db: PoolClient,
  userId: string,
): Promise<{ pinHash: string | null; worksite: 'onshore' | 'offshore' }> {
  const { rows } = await db.query<{
    pin_hash: string | null;
    worksite: 'onshore' | 'offshore';
  }>(`SELECT pin_hash, worksite FROM users WHERE id = $1`, [userId]);
  const row = rows[0];
  if (!row) throw AppError.notFound('User');
  return { pinHash: row.pin_hash, worksite: row.worksite };
}

/**
 * Runs the enabled verification methods. Throws AppError on the
 * first failure; returns silently when all enabled methods pass
 * (or no methods are enabled).
 *
 * Caller is responsible for selfie + device pinning — those need
 * filesystem / extra DB writes that don't fit here.
 */
export async function verifyPunchCredentials(args: {
  config: OrgVerificationConfig;
  user: { pinHash: string | null; worksite: 'onshore' | 'offshore' };
  providedPin: string | undefined;
  clientIp: string | null;
}): Promise<void> {
  const methods = args.config.enabledMethods;

  if (methods.includes('pin')) {
    if (!args.user.pinHash) {
      // User hasn't set a PIN yet — surfaced specifically so the
      // mobile/web client can route them through the set-PIN flow
      // rather than just bouncing off the punch button.
      throw AppError.pinRequired();
    }
    if (!args.providedPin) {
      throw AppError.pinRequired();
    }
    const matches = await bcrypt.compare(args.providedPin, args.user.pinHash);
    if (!matches) {
      throw AppError.pinInvalid();
    }
  }

  if (methods.includes('ip') && args.user.worksite === 'onshore') {
    if (!args.clientIp) {
      throw AppError.ipRestricted({ clientIp: 'unknown' });
    }
    if (
      args.config.allowedCidrs.length > 0 &&
      !ipInAnyCidr(args.clientIp, args.config.allowedCidrs)
    ) {
      throw AppError.ipRestricted({ clientIp: args.clientIp });
    }
  }
}
