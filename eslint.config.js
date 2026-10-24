import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import wrx from './tools/eslint-rules/index.js'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // Throwaway Phase 0 prototypes; each has its own tooling.
      'spike/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // NFR-19: no `any`, and no unchecked casts of network data.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // ARC-2 applies to shipped code, not tests, scripts or tools.
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/fixtures.ts'],
    plugins: { wrx },
    rules: { 'wrx/no-module-mutable-state': 'error' },
  },
  {
    // WP 0.3: StanzaJS stays inside the real transport, so no library type leaks out of it.
    files: ['**/*.{ts,tsx,js}'],
    ignores: ['packages/transport-xmpp/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'stanza', message: 'Import StanzaJS only in packages/transport-xmpp.' }],
          patterns: [
            { group: ['stanza/*'], message: 'Import StanzaJS only in packages/transport-xmpp.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.js', 'tools/**/*.ts', '**/scripts/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
)
