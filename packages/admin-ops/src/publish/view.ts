// What the publish planner knows about the server (WP 2.3): `AdminOps.readState` plus the items
// on every WRX1 node, the online roles (ADM-17), the vault and the publish marker. Reading it
// changes nothing. The planner itself (plan.ts) is pure over this view, so it is unit-tested
// without a server.
import { bareJid, domainpart, localpart } from '@wrx/domain'
import { RESERVED_ROLE_IDS, slugSchema } from '@wrx/schemas'
import type { Item } from '@wrx/transport'
import { opsErr, opsOk } from '../errors.ts'
import type { OpsOutcome } from '../errors.ts'
import type { AdminOps, NodeSnapshot, RoomSnapshot } from '../ops.ts'
import { ObserverVault } from '../vault.ts'
import type { MarkerStore, PublishMarker } from './marker.ts'

export interface NodeView extends NodeSnapshot {
  /** The node's items as the server holds them (documents, objectives items, announcements). */
  readonly items: readonly Item[]
}

export interface VaultView {
  /** Whether the admin account stores a vault. */
  readonly exists: boolean
  /** Role ids the vault holds a password for, when it is unlocked; undefined while locked. */
  readonly roles?: readonly string[]
}

export interface ServerView {
  /** The XMPP domain: role `x` is the account `x@<domain>`. */
  readonly domain: string
  readonly rooms: readonly RoomSnapshot[]
  readonly nodes: readonly NodeView[]
  /** Role ids with at least one session online (XEP-0133 online users), admin excluded. */
  readonly online: readonly string[]
  readonly vault: VaultView
  /** Set while a publish has started and not finished (marker.ts). */
  readonly marker: PublishMarker | undefined
}

/** The role id of a bare or full JID on this domain, if it names a role account. */
export function roleIdOf(jid: string, domain: string): string | undefined {
  const bare = bareJid(jid)
  if (!bare.endsWith(`@${domain}`)) return undefined
  const id = localpart(bare)
  if (id === undefined || RESERVED_ROLE_IDS.includes(id)) return undefined
  return slugSchema.safeParse(id).success ? id : undefined
}

export interface ReadViewOptions {
  /** The unlocked vault, so the view lists whose passwords it holds. */
  readonly vault?: ObserverVault
  /** Where the publish marker is kept; without one, no publish is taken to be unfinished. */
  readonly marker?: MarkerStore
}

/** Reads the whole view: every room on the MUC service and every WRX1 node with its items. */
export async function readServerView(
  ops: AdminOps,
  options: ReadViewOptions = {},
): OpsOutcome<ServerView> {
  const state = await ops.readState()
  if (!state.ok) return state
  const nodes: NodeView[] = []
  for (const node of state.value.nodes) {
    const items = await ops.session.pubsub.getItems(node.node)
    if (!items.ok) {
      if (items.error.condition === 'item-not-found') continue
      return opsErr('refused', `reading the items of ${node.node} failed`, {
        op: 'readServerView',
        step: 'read items',
        target: node.node,
        cause: items.error,
      })
    }
    nodes.push({ ...node, items: items.value })
  }
  const online = await ops.session.admin.onlineUsers()
  if (!online.ok) {
    return opsErr('refused', 'listing online users failed', {
      op: 'readServerView',
      step: 'online users',
      cause: online.error,
    })
  }
  const domain = domainpart(ops.session.jid)
  const exists = await ObserverVault.exists(ops.session.admin)
  if (!exists.ok) return exists
  const vault = options.vault?.unlocked === true ? options.vault : undefined
  const onlineRoles = [
    ...new Set(
      online.value.map((j) => roleIdOf(j, domain)).filter((id): id is string => id !== undefined),
    ),
  ].sort()
  return opsOk({
    domain,
    rooms: state.value.rooms,
    nodes,
    online: onlineRoles,
    vault: vault === undefined ? { exists: exists.value } : { exists: true, roles: vault.roles() },
    marker: options.marker?.read(),
  })
}
