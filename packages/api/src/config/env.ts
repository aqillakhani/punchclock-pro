import { z } from 'zod';

/**
 * The placeholder JWT secret shipped for local development. It is a valid
 * value in dev/test but MUST be replaced in production — `parseEnv` refuses
 * to boot a production process that still uses it.
 */
export const DEFAULT_DEV_JWT_SECRET = 'dev-only-secret-please-replace';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:8081'),
  /** Public URL of the web app, used to build links in transactional emails. */
  WEB_APP_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(20),
  DATABASE_SSL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16).default(DEFAULT_DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().default('24h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  /** Build provenance — set to the git SHA at deploy time; surfaced on /health. */
  APP_VERSION: z.string().default('dev'),

  // ---- Error tracking (Sentry) — optional, no-op when unset ----
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  // ---- Transactional email ----
  EMAIL_PROVIDER: z.enum(['resend', 'log']).default('log'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('PunchClock Pro <onboarding@resend.dev>'),

  // ---- Document storage (S3-compatible: Cloudflare R2 / AWS S3) ----
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  DOCUMENTS_PRESIGN_EXPIRY_SECONDS: z.coerce.number().int().positive().default(900),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Split a comma-separated origins string into a trimmed, non-empty list. */
function splitOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLocalOrigin(origin: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/.test(origin);
}

/**
 * Production-only configuration checks that a schema can't express on its
 * own (cross-field rules, refusing dev defaults). Returns a list of
 * human-readable problems; empty means the config is safe to boot.
 *
 * Pure and side-effect-free so it can be unit-tested directly.
 */
export function productionEnvProblems(env: AppEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  if (env.JWT_SECRET === DEFAULT_DEV_JWT_SECRET) {
    problems.push('JWT_SECRET must be set to a real, random secret in production');
  }
  if (!env.DATABASE_SSL) {
    problems.push('DATABASE_SSL must be true in production');
  }

  const origins = splitOrigins(env.CORS_ALLOWED_ORIGINS);
  if (origins.length === 0) {
    problems.push('CORS_ALLOWED_ORIGINS must be set to the production web origin(s)');
  } else if (origins.some(isLocalOrigin)) {
    problems.push('CORS_ALLOWED_ORIGINS must not include localhost origins in production');
  }

  if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY) {
    problems.push('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
  }

  return problems;
}

function formatFieldErrors(error: z.ZodError): string {
  const fieldErrors = error.flatten().fieldErrors;
  return Object.entries(fieldErrors)
    .map(([key, msgs]) => `${key}: ${(msgs ?? []).join(', ')}`)
    .join('; ');
}

/**
 * Validate a raw env object (e.g. `process.env`) into a typed `AppEnv`,
 * applying production hardening. Throws with a descriptive message on
 * failure. Pure — does not read `process.env` itself, which makes it
 * straightforward to test.
 */
export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${formatFieldErrors(parsed.error)}`);
  }
  const problems = productionEnvProblems(parsed.data);
  if (problems.length > 0) {
    throw new Error(`Invalid production environment configuration:\n - ${problems.join('\n - ')}`);
  }
  return parsed.data;
}

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  cached = parseEnv(process.env);
  return cached;
}

export function corsOrigins(env: AppEnv = loadEnv()): string[] {
  return splitOrigins(env.CORS_ALLOWED_ORIGINS);
}
