import * as Sentry from '@sentry/node';
import { loadEnv, type AppEnv } from './env.js';
import { logger } from './logger.js';

/**
 * Build Sentry init options from env, or `null` when no DSN is set (the
 * default in dev/test — Sentry stays disabled). Pure, so it's unit-testable.
 */
export function buildSentryOptions(env: AppEnv): Sentry.NodeOptions | null {
  if (!env.SENTRY_DSN) return null;
  return {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.APP_VERSION,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  };
}

let initialized = false;

/**
 * Initialize Sentry if a DSN is configured. Safe to call when disabled
 * (returns false). Sentry's default integrations install global handlers
 * for uncaught exceptions and unhandled rejections.
 */
export function initSentry(env: AppEnv = loadEnv()): boolean {
  if (initialized) return true;
  const options = buildSentryOptions(env);
  if (!options) return false;
  Sentry.init(options);
  initialized = true;
  logger.info(
    { environment: options.environment, release: options.release },
    'Sentry error tracking enabled',
  );
  return true;
}

/** Report an exception to Sentry. No-op when Sentry isn't initialized. */
export function captureException(err: unknown): void {
  Sentry.captureException(err);
}
