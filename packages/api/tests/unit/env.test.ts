import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_DEV_JWT_SECRET,
  parseEnv,
  productionEnvProblems,
  type AppEnv,
} from '../../src/config/env.js';

/** A minimal raw env that parses cleanly in development. */
const devRaw: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://localhost:5432/punchclock',
};

/** Build a fully-valid production AppEnv, then let callers override fields. */
function prodEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  const base = parseEnv({ ...devRaw });
  return {
    ...base,
    NODE_ENV: 'production',
    JWT_SECRET: 'a-genuinely-random-64-byte-secret-value-not-the-dev-default',
    DATABASE_SSL: true,
    CORS_ALLOWED_ORIGINS: 'https://punchclock.example.com',
    ...overrides,
  };
}

describe('parseEnv()', () => {
  it('parses a minimal development env with sane defaults', () => {
    const env = parseEnv({ ...devRaw });
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.JWT_SECRET).toBe(DEFAULT_DEV_JWT_SECRET);
    expect(env.EMAIL_PROVIDER).toBe('log');
  });

  it('throws when a required variable (DATABASE_URL) is missing', () => {
    expect(() => parseEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/i);
  });

  it('throws in production when secrets are still at dev defaults', () => {
    expect(() =>
      parseEnv({
        ...devRaw,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db.example.com/punchclock',
      }),
    ).toThrow(/production/i);
  });

  it('accepts a fully-configured production env', () => {
    expect(() =>
      parseEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://db.example.com/punchclock',
        DATABASE_SSL: 'true',
        JWT_SECRET: 'a-genuinely-random-64-byte-secret-value-not-the-dev-default',
        CORS_ALLOWED_ORIGINS: 'https://punchclock.example.com',
      }),
    ).not.toThrow();
  });
});

describe('productionEnvProblems()', () => {
  it('reports no problems outside production', () => {
    const env = parseEnv({ ...devRaw }); // development, dev defaults
    expect(productionEnvProblems(env)).toEqual([]);
  });

  it('reports no problems for a correctly-configured production env', () => {
    expect(productionEnvProblems(prodEnv())).toEqual([]);
  });

  it('flags the dev JWT secret in production', () => {
    const problems = productionEnvProblems(prodEnv({ JWT_SECRET: DEFAULT_DEV_JWT_SECRET }));
    expect(problems.some((p) => /JWT_SECRET/.test(p))).toBe(true);
  });

  it('flags DATABASE_SSL=false in production', () => {
    const problems = productionEnvProblems(prodEnv({ DATABASE_SSL: false }));
    expect(problems.some((p) => /DATABASE_SSL/.test(p))).toBe(true);
  });

  it('flags localhost CORS origins in production', () => {
    const problems = productionEnvProblems(
      prodEnv({ CORS_ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:3000' }),
    );
    expect(problems.some((p) => /CORS/.test(p))).toBe(true);
  });

  it('flags an empty CORS allowlist in production', () => {
    const problems = productionEnvProblems(prodEnv({ CORS_ALLOWED_ORIGINS: '' }));
    expect(problems.some((p) => /CORS/.test(p))).toBe(true);
  });

  it('requires a Resend API key when EMAIL_PROVIDER=resend', () => {
    const problems = productionEnvProblems(
      prodEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: undefined }),
    );
    expect(problems.some((p) => /RESEND_API_KEY/.test(p))).toBe(true);
  });

  it('accepts EMAIL_PROVIDER=resend when the key is present', () => {
    const problems = productionEnvProblems(
      prodEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_123' }),
    );
    expect(problems).toEqual([]);
  });
});
