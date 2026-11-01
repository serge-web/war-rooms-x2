import { idSchema, slugSchema } from './common.ts'

/** Singleton PubSub nodes (SRD §3). */
export const SINGLETON_NODES = Object.freeze({
  gameSetup: 'game-setup',
  gameState: 'game-state',
  announcements: 'announcements',
  /** The last names of deleted forces and roles, one item each (§3 rule 1). */
  retired: 'retired',
  /** Entity GUIDs, and each role's GUID by login name (§3 rule 1). */
  directory: 'directory',
  /** Message templates, one item per template, item id its GUID (Annex A, TPL-1). */
  templates: 'templates',
} as const)

/** Prefixes of per-entity PubSub nodes, `<prefix>:<id>`. */
export const NODE_PREFIXES = Object.freeze([
  'forces',
  'roles',
  'rooms',
  'objectives',
  'assets',
] as const)

/**
 * Node names kept for later features: no singleton or prefix may take them, and the tooling
 * neither creates, changes nor deletes a node of that name or below it. None since WP 4.1, when
 * `templates` became a managed singleton.
 */
export const RESERVED_NODE_NAMES: readonly string[] = Object.freeze([])

/**
 * Names below which nothing is the game's: `templates:…`. The `templates` node itself is a
 * managed singleton (Annex A, provisional answer 1: a leaf, not a collection), but a node below
 * it is never created, listed, changed or deleted by the tooling, nor read by the client.
 */
export const RESERVED_NODE_PREFIXES: readonly string[] = Object.freeze(['templates'])

export type NodePrefix = (typeof NODE_PREFIXES)[number]
export type SingletonNode = (typeof SINGLETON_NODES)[keyof typeof SINGLETON_NODES]

export type NodeRef =
  | { readonly kind: 'singleton'; readonly node: SingletonNode }
  | { readonly kind: NodePrefix; readonly id: string }

export const nodeName = Object.freeze({
  force: (forceId: string) => entityNode('forces', forceId),
  role: (roleId: string) => entityNode('roles', roleId),
  room: (roomId: string) => entityNode('rooms', roomId),
  objectives: (forceId: string) => entityNode('objectives', forceId),
  asset: (assetId: string) => entityNode('assets', assetId),
})

function entityNode(prefix: NodePrefix, id: string): string {
  if (!idSchema.safeParse(id).success) {
    throw new RangeError(`Not a valid id for ${prefix}: ${JSON.stringify(id)}`)
  }
  return `${prefix}:${id}`
}

function singletonOf(node: string): SingletonNode | undefined {
  return Object.values(SINGLETON_NODES).find((s) => s === node)
}

/**
 * Parses a node name into its kind and id; `undefined` for nodes WRX1 doesn't use, reserved
 * names, and per-entity nodes whose id is not a GUID.
 */
export function parseNodeName(node: string): NodeRef | undefined {
  const singleton = singletonOf(node)
  if (singleton !== undefined) return { kind: 'singleton', node: singleton }
  const separator = node.indexOf(':')
  if (separator < 0) return undefined
  const prefix = NODE_PREFIXES.find((p) => p === node.slice(0, separator))
  const id = node.slice(separator + 1)
  if (prefix === undefined || !idSchema.safeParse(id).success) return undefined
  return { kind: prefix, id }
}

/** Whether a node name is reserved: a reserved name or below it, or below `templates`. */
export function isReservedNodeName(node: string): boolean {
  return (
    RESERVED_NODE_NAMES.some((name) => node === name || node.startsWith(`${name}:`)) ||
    RESERVED_NODE_PREFIXES.some((name) => node.startsWith(`${name}:`))
  )
}

/**
 * Whether the admin tooling treats the node as the game's (one game per server, D11): a
 * singleton, or `<prefix>:<slug>`, so nodes a release before GUID ids published (`forces:blue`)
 * are found too, and a reset (ADM-15) removes them. Reserved names never are, nor anything below `templates`.
 */
export function isGameNodeName(node: string): boolean {
  if (isReservedNodeName(node)) return false
  if (singletonOf(node) !== undefined) return true
  const separator = node.indexOf(':')
  if (separator < 0) return false
  const prefix = NODE_PREFIXES.find((p) => p === node.slice(0, separator))
  return prefix !== undefined && slugSchema.safeParse(node.slice(separator + 1)).success
}
