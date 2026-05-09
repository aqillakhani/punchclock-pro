/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@punchclock/shared$': '<rootDir>/../shared/src/index.ts',
    '^@punchclock/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^expo-constants$': '<rootDir>/tests/mocks/expo-constants.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          jsx: 'react-jsx',
          strict: true,
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        diagnostics: { ignoreCodes: ['TS151001'] },
      },
    ],
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  collectCoverageFrom: [
    'src/db/repos/**/*.ts',
    'src/services/sync.service.ts',
    '!src/**/*.test.ts',
  ],
};
