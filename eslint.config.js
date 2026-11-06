import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import wrx from './tools/eslint-rules/index.js'

const STANZA = { name: 'stanza', message: 'Import StanzaJS only in packages/transport-xmpp.' }
const STANZA_HOME = 'packages/transport-xmpp/**'
const FLEXLAYOUT = {
  name: 'flexlayout-react',
  message:
    'Import FlexLayout only in the workspace module, packages/player-ui/src/workspace (ARC-9).',
}
const FLEXLAYOUT_HOME = 'packages/player-ui/src/workspace/**'
// Annex A (F7): RJSF's Ajv validator compiles schemas with `new Function`, which the CSP refuses;
// templates use `createTemplateFormValidator` from @wrx/templates/rjsf. @rjsf/core's root entry
// re-exports a test helper that imports Ajv, so import its components by path
// (`@rjsf/core/lib/components/Form.js`).
const AJV = {
  name: '@rjsf/validator-ajv8',
  message: 'Ajv needs unsafe-eval (F7): use createTemplateFormValidator from @wrx/templates/rjsf.',
}
const RJSF_ROOT = {
  name: '@rjsf/core',
  message: 'Its root entry imports @rjsf/validator-ajv8: import @rjsf/core/lib/components/Form.js.',
  subpaths: false,
}

/** `no-restricted-imports` configs: each forbids its libraries and their subpaths. */
function restrictedImports(sets) {
  return sets.map(({ files, ignores, libraries }) => ({
    files,
    ...(ignores === undefined ? {} : { ignores }),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: libraries.map(({ name, message }) => ({ name, message })),
          patterns: libraries
            .filter(({ subpaths }) => subpaths !== false)
            .map(({ name, message }) => ({ group: [`${name}/*`], message })),
        },
      ],
    },
  }))
}

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
      // The Python SDK's virtual environment (WP 6.1).
      'python/.venv/**',
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
    // ARC-2 applies to shipped code, not tests, Storybook stories, scripts or tools.
    files: ['packages/*/src/**/*.{ts,tsx}', 'apps/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/*.stories.tsx', '**/fixtures.ts'],
    plugins: { wrx },
    rules: { 'wrx/no-module-mutable-state': 'error' },
  },
  // Library boundaries (one rule config per file set: a later `no-restricted-imports` replaces an
  // earlier one, so each set lists every library it may not import).
  // WP 0.3: StanzaJS stays inside the real transport, so no library type leaks out of it.
  // WP 2.5 (ARC-9): FlexLayout stays inside the workspace module.
  ...restrictedImports([
    {
      files: ['**/*.{ts,tsx,js}'],
      ignores: [STANZA_HOME, FLEXLAYOUT_HOME],
      libraries: [STANZA, FLEXLAYOUT, AJV, RJSF_ROOT],
    },
    { files: [STANZA_HOME], libraries: [FLEXLAYOUT, AJV, RJSF_ROOT] },
    { files: [FLEXLAYOUT_HOME], libraries: [STANZA, AJV, RJSF_ROOT] },
  ]),
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.js', 'tools/**/*.ts', '**/scripts/**/*.ts', '**/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
)
