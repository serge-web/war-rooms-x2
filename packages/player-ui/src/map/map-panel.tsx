// The map room's player panel: a placeholder until WP 5.5 brings the map (PLY-57). It shows the
// world state this client accepts (D25, PLY-58, PLY-59), from `useWorldState`: the turn, and each
// force's assets in a plain list. Register it with `withSlots` for `map`.
import { useForces, useWorldState } from '@wrx/hooks'
import type { PlayerPanelProps } from '@wrx/hooks'
import type { Force, WorldAsset, WorldState } from '@wrx/schemas'
import { Spinner } from '@wrx/ui'

export interface MapPanelCoreProps {
  readonly name: string
  /** The accepted world state, if one has been found. */
  readonly state: WorldState | undefined
  /** Still looking for one. */
  readonly loading: boolean
  /** Why it cannot be shown, if it cannot. */
  readonly problem: string | undefined
  readonly forces: readonly Force[]
}

/** The assets of each force, in force order, then by title; unknown forces last. */
export function assetsByForce(
  state: WorldState,
  forces: readonly Force[],
): { readonly forceId: string; readonly name: string; readonly assets: WorldAsset[] }[] {
  const groups = new Map<string, WorldAsset[]>()
  for (const asset of Object.values(state.assets)) {
    groups.set(asset.forceId, [...(groups.get(asset.forceId) ?? []), asset])
  }
  const known = forces.filter((f) => groups.has(f.id)).map((f) => ({ forceId: f.id, name: f.name }))
  const unknown = [...groups.keys()]
    .filter((id) => !forces.some((f) => f.id === id))
    .sort()
    .map((id) => ({ forceId: id, name: 'Unknown force' }))
  return [...known, ...unknown].map((g) => ({
    ...g,
    assets: (groups.get(g.forceId) ?? []).sort(
      (a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
    ),
  }))
}

export function MapPanelCore({ name, state, loading, problem, forces }: MapPanelCoreProps) {
  return (
    // Focusable, so a pane too small for the list can be scrolled from the keyboard (WCAG 2.1.1).
    <div
      className="wrx-room-placeholder wrx-map-placeholder"
      tabIndex={0}
      role="group"
      aria-label={`${name}: world state`}
    >
      <h2 className="wrx-room-placeholder__name">{name}</h2>
      {problem !== undefined ? (
        <p className="wrx-empty">This map cannot be shown: {problem}</p>
      ) : loading ? (
        <Spinner label="Loading the world state" />
      ) : state === undefined ? (
        <p className="wrx-empty">The umpire has not published a world state yet.</p>
      ) : (
        <>
          <p className="wrx-room-placeholder__type">
            World state for turn {state.turn}: {Object.keys(state.assets).length} assets. The map
            itself is not in this build yet.
          </p>
          {assetsByForce(state, forces).map((group) => (
            <section
              key={group.forceId}
              aria-label={group.name}
              className="wrx-map-placeholder__force"
            >
              <h3 className="wrx-map-placeholder__heading">{group.name}</h3>
              <ul className="wrx-map-placeholder__assets">
                {group.assets.map((asset) => (
                  <li key={asset.id} data-asset={asset.id}>
                    {asset.title} ({asset.category}), {asset.state}: health {asset.health}, fuel{' '}
                    {asset.fuel}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

/** The map room panel over the pane's store: the placeholder WP 5.5 replaces. */
export function MapPanel({ roomId, room }: PlayerPanelProps) {
  const world = useWorldState(roomId)
  const forces = useForces().data
  return (
    <MapPanelCore
      name={room.name}
      state={world.data?.state}
      loading={world.status === 'loading'}
      problem={world.status === 'error' ? (world.error?.message ?? 'unavailable') : undefined}
      forces={forces}
    />
  )
}
