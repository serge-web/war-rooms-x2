// The admin's preview as a role (ADM-30, ADM-31): the admin's own store, seen through a role.
// Everything is read and sent through the admin's session, so posts go from the admin account and
// are attributed to it by the server (§3 rule 3), never to the role. Only what the UI asks about
// "me" changes: `identity` and `me()` describe the previewed role, so the workspace shows exactly
// that role's rooms (from the same effective access the role gets, §3 rule 4), its saved layout
// key, its force theme and its force's objectives. The admin can read every document, so nothing
// the role sees is missing.
import { canEditObjectives, roomsForRole } from '@wrx/domain'
import type { Identity, Me, SessionStore, Snapshot } from '@wrx/domain'

/** A view of an admin store as `roleId` sees it. Holds its memo in the closure, per preview. */
export function previewAsRole(store: SessionStore, roleId: string): SessionStore {
  const identity: Identity = Object.freeze({ ...store.identity, roleId, isAdmin: false })
  let last: { readonly deps: readonly unknown[]; readonly value: Snapshot<Me> } | undefined

  const me = (): Snapshot<Me> => {
    const base = store.me()
    const matrix = store.access().data
    const roles = store.roles().data
    const forces = store.forces().data
    const deps = [base, matrix, roles, forces]
    if (last?.deps.every((d, i) => Object.is(d, deps[i])) === true) return last.value
    const role = roles.find((r) => r.id === roleId)
    const force = role === undefined ? undefined : forces.find((f) => f.id === role.forceId)
    const byId = new Map(base.data.rooms.map(({ room }) => [room.id, room]))
    const rooms = roomsForRole(matrix, roleId).flatMap(({ roomId, access }) => {
      const room = byId.get(roomId)
      return room === undefined ? [] : [{ room, access }]
    })
    const data: Me = Object.freeze({
      identity,
      role,
      force,
      isUmpire: force?.isUmpire === true,
      isObserver: role?.isObserver === true,
      // What the role itself may do, so a White observer's preview offers no editing.
      canEditObjectives: canEditObjectives(false, force, role),
      rooms: Object.freeze(rooms),
    })
    const value: Snapshot<Me> = Object.freeze({ ...base, data })
    last = { deps, value }
    return value
  }

  // Every other member is the admin store's own, bound to it so its private state is used.
  const bound = new Map<PropertyKey, unknown>()
  return new Proxy(store, {
    get(target, property) {
      if (property === 'identity') return identity
      if (property === 'me') return me
      const known = bound.get(property)
      if (known !== undefined) return known
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      const fn = (value as (...args: unknown[]) => unknown).bind(target)
      bound.set(property, fn)
      return fn
    },
  })
}
