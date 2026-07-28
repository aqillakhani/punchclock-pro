/**
 * Integration suite — drives the real Express app against a real Postgres.
 *
 * Kept separate from jest.config.cjs so `pnpm test` stays fast and
 * hermetic, while `pnpm test:integration` opts in to a database.
 *
 *   docker compose up -d postgres && pnpm db:migrate && pnpm test:integration
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  setupFiles: ['<rootDir>/tests/integration/setup-env.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@punchclock/shared$': '<rootDir>/../shared/src/index.ts',
    '^@punchclock/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: { module: 'esnext', moduleResolution: 'bundler' },
      },
    ],
  },
  testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
  // Real network + bcrypt + Postgres round-trips are slower than unit work.
  testTimeout: 30_000,
  // Each file seeds its own org, but they share one pg pool per worker;
  // serial execution keeps connection counts predictable on small CI boxes.
  maxWorkers: 1,
};
