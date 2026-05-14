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
  overrides: [
    {
      // The bare Espree parser cannot read TypeScript syntax (type
      // annotations, generics, `import type`, etc). Switch the
      // parser for `.ts` files only — no extra rules, just enough
      // for lint to actually run instead of choking on the first
      // type annotation.
      files: ['**/*.ts', '**/*.tsx'],
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  ],
};
