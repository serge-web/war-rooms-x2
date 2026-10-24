import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import rule from './no-module-mutable-state.js'

RuleTester.describe = describe
RuleTester.it = it

new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: 'module' } }).run(
  'no-module-mutable-state',
  rule,
  {
    valid: [
      'const LIMIT = 10',
      "const NAMES = Object.freeze(['a', 'b'])",
      'const make = () => new Map()',
      'function f() { let x = 1; const m = new Map(); return [x, m] }',
      'export const schema = z.object({})',
      'class Store { items = new Map() }',
    ],
    invalid: [
      { code: 'let count = 0', errors: [{ messageId: 'mutableBinding' }] },
      { code: 'var cache', errors: [{ messageId: 'mutableBinding' }] },
      { code: 'export let session = null', errors: [{ messageId: 'mutableBinding' }] },
      { code: 'const cache = new Map()', errors: [{ messageId: 'mutableCollection' }] },
      {
        code: 'const seen = Object.freeze(new Set())',
        errors: [{ messageId: 'mutableCollection' }],
      },
      { code: 'const buffer = new Array(10)', errors: [{ messageId: 'mutableValue' }] },
      { code: 'export const listeners = []', errors: [{ messageId: 'mutableValue' }] },
      { code: 'const state = { ready: false }', errors: [{ messageId: 'mutableValue' }] },
    ],
  },
)
