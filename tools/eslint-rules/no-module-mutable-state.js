// ARC-2: client code holds no module-level mutable state, so every pane in the multi-client
// view (D15) owns its own session. Flags top-level `let`/`var`; top-level `const` arrays and
// objects unless frozen or marked `as const`; and top-level collections, which no freeze makes
// immutable.

const COLLECTIONS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet'])

/**
 * What kind of mutable value an initialiser creates, or undefined if none.
 * @param {import('estree').Node | null | undefined} node
 * @returns {'array' | 'object' | 'collection' | undefined}
 */
function mutableKind(node) {
  if (!node) return undefined
  switch (node.type) {
    case 'ArrayExpression':
      return 'array'
    case 'ObjectExpression':
      return 'object'
    case 'NewExpression':
      if (node.callee.type !== 'Identifier') return undefined
      if (COLLECTIONS.has(node.callee.name)) return 'collection'
      return node.callee.name === 'Array' ? 'array' : undefined
    case 'CallExpression': {
      // Object.freeze(new Map()) still leaves the Map mutable.
      const [arg] = node.arguments
      return arg && arg.type !== 'SpreadElement' && mutableKind(arg) === 'collection'
        ? 'collection'
        : undefined
    }
    default:
      return undefined
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow module-level mutable state (ARC-2)' },
    messages: {
      mutableBinding:
        'Module-level `{{kind}}` is shared by every pane (ARC-2). Move it into the session store or a function.',
      mutableValue:
        'Module-level `{{name}}` is a mutable {{what}} shared by every pane (ARC-2). Freeze it, mark it `as const`, or move it into the session store.',
      mutableCollection:
        'Module-level `{{name}}` is a collection shared by every pane (ARC-2), and freezing does not stop it changing. Move it into the session store or a function.',
    },
    schema: [],
  },
  create(context) {
    /** @param {import('estree').VariableDeclaration} declaration */
    function check(declaration) {
      if (declaration.kind !== 'const') {
        context.report({
          node: declaration,
          messageId: 'mutableBinding',
          data: { kind: declaration.kind },
        })
        return
      }
      for (const declarator of declaration.declarations) {
        const kind = mutableKind(declarator.init)
        if (kind === undefined) continue
        const name = declarator.id.type === 'Identifier' ? declarator.id.name : 'binding'
        context.report({
          node: declarator,
          messageId: kind === 'collection' ? 'mutableCollection' : 'mutableValue',
          data: { name, what: kind },
        })
      }
    }
    return {
      'Program > VariableDeclaration': check,
      'Program > ExportNamedDeclaration > VariableDeclaration': check,
    }
  },
}
