/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
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
  // Unit suite only. The integration tests need a live Postgres and run
  // via `pnpm test:integration` (jest.integration.cjs).
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/tests/unit/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/db/migrate.ts', '!src/db/prod-seed.ts', '!src/db/prune-audit-logs.ts'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80,
    },
  },
};
