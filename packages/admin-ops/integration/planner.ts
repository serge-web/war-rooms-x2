// A minimal planner for the integration runs: turns one design's target state into the next
// through AdminOps primitives, in the order 2.3's publish is expected to use. It is test code,
// not the publish feature (WP 2.3 owns the diff, progress and confirmation UI).
import type { DesignFile } from '@wrx/schemas'
import type { AdminOps, RoleAccessPlan } from '../src/index.ts'
import { targetState } from '../src/index.ts'
import type { AdminOpsError, TargetState } from '../src/index.ts'

const EMPTY: TargetState = Object.freeze({ roles: [], readOnlyRoles: [], rooms: [], nodes: [] })

function must<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: AdminOpsError },
  what: string,
): T {
  if (result.ok) return result.value
  const { code, message, step, target, cause } = result.error
  const where = [step, target].filter((s) => s !== undefined).join(' ')
  const why =
    cause === undefined
      ? ''
      : ` [${cause.condition}${cause.text === undefined ? '' : `: ${cause.text}`}]`
  throw new Error(`${what}: ${code} at ${where}: ${message}${why}`)
}

export { must as mustOps }

/** Every role's change of access from `prev` to `next`, for rooms and nodes `next` keeps. */
export function rolePlans(prev: TargetState, next: TargetState): Map<string, RoleAccessPlan> {
  const plans = new Map<
    string,
    {
      rooms: NonNullable<RoleAccessPlan['rooms']>[number][]
      nodes: NonNullable<RoleAccessPlan['nodes']>[number][]
    }
  >()
  const planOf = (roleId: string) => {
    const plan = plans.get(roleId) ?? { rooms: [], nodes: [] }
    plans.set(roleId, plan)
    return plan
  }
  for (const room of next.rooms) {
    const before =
      prev.rooms.find((r) => r.roomId === room.roomId)?.access ??
      new Map<string, 'write' | 'read'>()
    for (const roleId of new Set([...before.keys(), ...room.access.keys()])) {
      if (!next.roles.includes(roleId)) continue
      const from = before.get(roleId) ?? 'none'
      const access = room.access.get(roleId) ?? 'none'
      if (from !== access) planOf(roleId).rooms.push({ roomId: room.roomId, access, from })
    }
  }
  for (const node of next.nodes) {
    const before =
      prev.nodes.find((n) => n.node === node.node)?.access ?? new Map<string, 'publish' | 'read'>()
    for (const roleId of new Set([...before.keys(), ...node.access.keys()])) {
      if (!next.roles.includes(roleId)) continue
      const from = before.get(roleId) ?? 'none'
      const access = node.access.get(roleId) ?? 'none'
      if (from !== access) planOf(roleId).nodes.push({ node: node.node, access })
    }
  }
  return plans
}

export interface ProvisionReport {
  /** Message counts of rooms destroyed (R-F), by room id. */
  readonly destroyed: ReadonlyMap<string, number>
}

/**
 * Converges the server from `previous` (undefined: nothing provisioned) to `design`. New roles
 * get `passwords[roleId]`. Read-only access is applied before any document is published (S13).
 */
export async function provision(
  ops: AdminOps,
  design: DesignFile,
  previous: DesignFile | undefined,
  passwords: (roleId: string) => string,
): Promise<ProvisionReport> {
  const prev = previous === undefined ? EMPTY : targetState(previous)
  const next = targetState(design)

  for (const roleId of next.roles.filter((r) => !prev.roles.includes(r))) {
    must(
      await ops.createAccount(roleId, passwords(roleId), {
        readOnly: next.readOnlyRoles.includes(roleId),
      }),
      `create account ${roleId}`,
    )
  }
  for (const room of next.rooms) {
    must(
      await ops.ensureRoom(room.roomId, { name: room.config.name }),
      `ensure room ${room.roomId}`,
    )
  }
  for (const node of next.nodes) {
    must(await ops.ensureNode(node.node, node.config), `ensure node ${node.node}`)
  }
  for (const [roleId, plan] of rolePlans(prev, next)) {
    must(await ops.moveRole(roleId, plan), `access for ${roleId}`)
  }
  for (const node of next.nodes) {
    for (const doc of node.documents) {
      must(
        await ops.publishDocument(node.node, node.config, doc.itemId, doc.payload),
        `publish ${node.node}`,
      )
    }
  }
  const allRooms = [...new Set([...prev.rooms, ...next.rooms].map((r) => r.roomId))]
  const allNodes = [...new Set([...prev.nodes, ...next.nodes].map((n) => n.node))]
  for (const roleId of prev.roles.filter((r) => !next.roles.includes(r))) {
    must(
      await ops.deleteRole(roleId, { rooms: allRooms, nodes: allNodes }),
      `delete role ${roleId}`,
    )
  }
  const destroyed = new Map<string, number>()
  for (const room of prev.rooms.filter((r) => !next.rooms.some((n) => n.roomId === r.roomId))) {
    const count = must(await ops.roomMessageCount(room.roomId), `count ${room.roomId}`)
    const done = must(
      await ops.destroyRoom(room.roomId, { messageCount: count }),
      `destroy ${room.roomId}`,
    )
    destroyed.set(room.roomId, done.messageCount)
  }
  for (const node of prev.nodes.filter((p) => !next.nodes.some((n) => n.node === p.node))) {
    must(await ops.deleteNode(node.node), `delete node ${node.node}`)
  }
  return { destroyed }
}

/** Removes everything either design provisions: the test's stand-in for a game reset. */
export async function reset(ops: AdminOps, designs: readonly DesignFile[]): Promise<void> {
  const targets = designs.map((d) => targetState(d))
  const rooms = [...new Set(targets.flatMap((t) => t.rooms.map((r) => r.roomId)))]
  const nodes = [...new Set(targets.flatMap((t) => t.nodes.map((n) => n.node)))]
  for (const roleId of new Set(targets.flatMap((t) => t.roles))) {
    must(await ops.deleteRole(roleId, { rooms: [], nodes: [] }), `reset ${roleId}`)
  }
  for (const roomId of rooms) {
    const count = await ops.roomMessageCount(roomId)
    const messageCount = count.ok ? count.value : 0
    await ops.destroyRoom(roomId, { messageCount })
  }
  for (const node of nodes) must(await ops.deleteNode(node), `reset ${node}`)
}
