import { slugSchema } from './common.ts'

/** Singleton PubSub nodes (SRD §3). */
export const SINGLETON_NODES = Object.freeze({
  gameSetup: 'game-setup',
  gameState: 'game-state',
  announcements: 'announcements',
} as const)

/** Prefixes of per-entity PubSub nodes, `<prefix>:<id>`. */
export const NODE_PREFIXES = Object.freeze([
  'forces',
  'roles',
  'rooms',
  'objectives',
  'assets',
] as const)

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
  if (!slugSchema.safeParse(id).success) {
    throw new RangeError(`Not a valid id for ${prefix}: ${JSON.stringify(id)}`)
  }
  return `${prefix}:${id}`
}

/** Parses a node name into its kind and id; `undefined` for nodes WRX1 doesn't use. */
export function parseNodeName(node: string): NodeRef | undefined {
  for (const singleton of Object.values(SINGLETON_NODES)) {
    if (node === singleton) return { kind: 'singleton', node: singleton }
  }
  const separator = node.indexOf(':')
  if (separator < 0) return undefined
  const prefix = NODE_PREFIXES.find((p) => p === node.slice(0, separator))
  const id = node.slice(separator + 1)
  if (prefix === undefined || !slugSchema.safeParse(id).success) return undefined
  return { kind: prefix, id }
}
