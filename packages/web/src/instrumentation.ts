import * as Sentry from '@sentry/nextjs';

/**
 * Next.js instrumentation hook. Initializes Sentry on the server/edge runtimes
 * only when a DSN is configured (disabled by default in dev). Client-side
 * capture and build-time source-map upload (via `withSentryConfig`) are a
 * follow-up once the Sentry project + auth token exist — see docs/deploy.md.
 */
export async function register(): Promise<void> {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      release: process.env.APP_VERSION,
      tracesSampleRate: 0,
    });
  }
}

// Captures errors thrown in server components, route handlers, and middleware.
export const onRequestError = Sentry.captureRequestError;
