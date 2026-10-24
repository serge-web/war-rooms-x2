// spike/s13 is a standalone throwaway package outside the pnpm workspace, with its own lockfile.
// CI's root `pnpm install` does not install its dependencies, so the root config's type-aware rules
// cannot resolve its types there (`stanza` would be `any`). ESLint 10 uses the config nearest each
// file, so this one applies here: the recommended rules without type information. Types are checked
// by this package's own `pnpm typecheck` (tsc --noEmit), after `pnpm install --ignore-workspace`.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended],
    // tsconfigRootDir: without it, a root `eslint .` run sees two candidate roots and refuses.
    languageOptions: {
      globals: globals.node,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  { files: ['**/*.js'], languageOptions: { globals: globals.node } },
)
