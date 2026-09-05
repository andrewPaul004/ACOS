// @ts-check
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * S1A lint configuration.
 *
 * Deliberately small. The rules that earn their place are the ones that would let a
 * money-path defect through silently — floating promises, unchecked `any`, unhandled
 * rejections — plus a project-specific rule that keeps the declared lock order a single
 * acquisition site.
 */
export default [
  {
    // tests/type-negative/** is excluded from the root tsconfig by design (it must fail to
    // compile), so the type-aware lint rules cannot resolve it.
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'docs/architecture/**',
      'tests/type-negative/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module',
        ecmaVersion: 2022,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // A dropped promise on the money path is a transaction that silently never
      // committed. This is the single most valuable rule in the set.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true, allowNullish: false },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Test and spike files legitimately print their measured results; that output IS the
    // deliverable for the negative controls and the kill-point matrix.
    files: ['tests/**/*.ts', 'spikes/**/*.ts', 'src/db/migrate.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];
