import { describe, it, expect } from '@jest/globals';
import { buildSentryOptions } from '../../src/config/sentry.js';
import { parseEnv } from '../../src/config/env.js';

describe('buildSentryOptions()', () => {
  it('returns null when no DSN is configured (Sentry disabled)', () => {
    const env = parseEnv({ DATABASE_URL: 'postgres://x' });
    expect(buildSentryOptions(env)).toBeNull();
  });

  it('builds init options from env when a DSN is present', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x',
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
      APP_VERSION: 'sha123',
      SENTRY_TRACES_SAMPLE_RATE: '0.25',
    });
    expect(buildSentryOptions(env)).toMatchObject({
      dsn: 'https://abc@o1.ingest.sentry.io/1',
      environment: 'development',
      release: 'sha123',
      tracesSampleRate: 0.25,
    });
  });

  it('defaults the trace sample rate to 0 (errors only)', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgres://x',
      SENTRY_DSN: 'https://abc@o1.ingest.sentry.io/1',
    });
    expect(buildSentryOptions(env)?.tracesSampleRate).toBe(0);
  });
});
