// Server views for the planner's unit tests: what a server holds after a complete publish of a
// design, built from `targetState` the way the executor provisions it, so tests change one thing
// at a time.
import { DOCUMENT_ITEM_ID } from '@wrx/domain'
import type { DesignFile } from '@wrx/schemas'
import { targetState } from '../target.ts'
import type { NodeView, ServerView } from './view.ts'

export const DOMAIN = 'wrx.test'
export const jid = (roleId: string): string => `${roleId}@${DOMAIN}`

export function emptyView(overrides: Partial<ServerView> = {}): ServerView {
  return {
    domain: DOMAIN,
    rooms: [],
    nodes: [],
    online: [],
    vault: { exists: false },
    marker: undefined,
    registered: [jid('admin')],
    ...overrides,
  }
}

/** The server after publishing `design` completely, at `game.designVersion`. */
export function publishedView(design: DesignFile, overrides: Partial<ServerView> = {}): ServerView {
  const target = targetState(design)
  const rooms = target.rooms.map((room) => ({
    roomId: room.roomId,
    config: room.config,
    affiliations: [
      { jid: jid('admin'), affiliation: 'owner' as const },
      ...[...room.access.keys()].map((id) => ({ jid: jid(id), affiliation: 'member' as const })),
    ],
  }))
  const nodes: NodeView[] = target.nodes.map((node) => ({
    node: node.node,
    config: node.config,
    affiliations: [
      { jid: jid('admin'), affiliation: 'owner' as const },
      ...[...node.access].map(([id, access]) => ({
        jid: jid(id),
        affiliation: access === 'publish' ? ('publisher' as const) : ('member' as const),
      })),
    ],
    subscriptions: [],
    items: node.documents.map((d) => ({
      id: d.itemId,
      payload: d.payload,
      publisher: jid('admin'),
    })),
  }))
  const readOnly = target.readOnlyRoles
  return emptyView({
    rooms,
    nodes,
    registered: [jid('admin'), ...target.roles.map(jid)],
    vault: readOnly.length > 0 ? { exists: true, roles: readOnly } : { exists: false },
    ...overrides,
  })
}

/** A view with one node changed. */
export function withNode(
  view: ServerView,
  node: string,
  change: (n: NodeView) => NodeView,
): ServerView {
  return { ...view, nodes: view.nodes.map((n) => (n.node === node ? change(n) : n)) }
}

export { DOCUMENT_ITEM_ID }
