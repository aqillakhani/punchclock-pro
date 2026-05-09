/** Root ESLint config — per-package configs extend this where needed. */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    '.next',
    '.turbo',
    '.expo',
    'coverage',
    'packages/mobile/**',
    'packages/web/**',
  ],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
};
