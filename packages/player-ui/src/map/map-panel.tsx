// The map room's player panel (PLY-57, ARC-5): the world state this client accepts (D25, PLY-58,
// PLY-59), from `useWorldState`, on a Leaflet map with milsymbol symbols, and the same assets in
// a table, the view a keyboard or screen reader uses. Selecting an asset, on either, shows its
// fields. Read-only for every role: the map room has no composer. Register it with `withSlots`
// for `map`.
import { useForces, useWorldState } from '@wrx/hooks'
import type { PlayerPanelProps } from '@wrx/hooks'
import { mapRoomConfigReader } from '@wrx/schemas'
import type { Force, MapRoomConfig, WorldState } from '@wrx/schemas'
import { Button, Spinner } from '@wrx/ui'
import { Suspense, useCallback, useId, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { LazyMapView } from './lazy.tsx'
import { useMapTiles } from './tiles.tsx'
import type { MapTiles } from './tiles.tsx'
import { assetFields, assetRows, forceNameOf, formatPercent, formatPosition } from './view.ts'

export interface MapPanelCoreProps {
  readonly name: string
  /** The accepted world state, if one has been found. */
  readonly state: WorldState | undefined
  /** Still looking for one. */
  readonly loading: boolean
  /** Why it cannot be shown, if it cannot. */
  readonly problem: string | undefined
  readonly forces: readonly Force[]
  /** The room's opening view; undefined fits the assets. */
  readonly config?: MapRoomConfig | undefined
  /** The deployment's base tiles; undefined shows no base map. */
  readonly tiles: MapTiles | undefined
}

type View = 'map' | 'table'

export function MapPanelCore({
  name,
  state,
  loading,
  problem,
  forces,
  config,
  tiles,
}: MapPanelCoreProps) {
  const [view, setView] = useState<View>('map')
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [fitRequest, setFitRequest] = useState(0)
  const [showRequest, setShowRequest] = useState(0)
  const detailsId = useId()
  const rows = useMemo(() => (state === undefined ? [] : assetRows(state, forces)), [state, forces])
  // A selection the newer state no longer holds is gone.
  const selected = picked !== undefined && state?.assets[picked] !== undefined ? picked : undefined
  const asset = selected === undefined ? undefined : state?.assets[selected]
  const select = useCallback((id: string) => {
    setPicked(id)
  }, [])

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && selected !== undefined) {
      event.stopPropagation()
      setPicked(undefined)
    }
  }

  // A state already shown stays while the room rejoins (a reconnection), so the map keeps its view.
  if (problem !== undefined || state === undefined) {
    return (
      <div className="wrx-map wrx-map--empty" role="group" aria-label={`${name}: world state`}>
        <h2 className="wrx-map__name">{name}</h2>
        {problem !== undefined ? (
          <p className="wrx-empty">This map cannot be shown: {problem}</p>
        ) : loading ? (
          <Spinner label="Loading the world state" />
        ) : (
          <p className="wrx-empty">The umpire has not published a world state yet.</p>
        )}
      </div>
    )
  }

  const count = rows.length
  const assets = `${count.toLocaleString('en-GB')} ${count === 1 ? 'asset' : 'assets'}`
  return (
    <div className="wrx-map" role="group" aria-label={`${name}: world state`} onKeyDown={onKeyDown}>
      <div className="wrx-map__bar">
        <h2 className="wrx-map__name">{name}</h2>
        {/* Announced when a newer state replaces this one (PLY-59). */}
        <p className="wrx-map__turn" role="status">
          World state for turn {state.turn}: {assets}
        </p>
        <div className="wrx-map__views" role="group" aria-label="Show as">
          <Button
            size="small"
            aria-pressed={view === 'map'}
            onClick={() => {
              setView('map')
            }}
          >
            Map
          </Button>
          <Button
            size="small"
            aria-pressed={view === 'table'}
            onClick={() => {
              setView('table')
            }}
          >
            Table
          </Button>
        </div>
        {view === 'map' && count > 0 ? (
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setFitRequest((n) => n + 1)
            }}
          >
            Show all assets
          </Button>
        ) : null}
      </div>
      <div className="wrx-map__body">
        {/* The map stays mounted behind the table, so switching back keeps its view. */}
        <div className="wrx-map__stage" hidden={view !== 'map'}>
          <Suspense fallback={<Spinner label="Loading the map" />}>
            <LazyMapView
              assets={state.assets}
              tiles={tiles}
              config={config}
              selected={selected}
              onSelect={select}
              label={`${name}: map of ${assets}. Arrow keys pan, plus and minus zoom. The table shows the same assets.`}
              fitRequest={fitRequest}
              showRequest={showRequest}
            />
          </Suspense>
          {tiles === undefined ? (
            <p className="wrx-map__notice">
              No base map is configured for this deployment: the assets are shown on a plain
              background.
            </p>
          ) : (
            <p className="wrx-map__attribution">
              {tiles.attributionUrl === undefined ? (
                tiles.attribution
              ) : (
                <a href={tiles.attributionUrl} target="_blank" rel="noopener noreferrer">
                  {tiles.attribution}
                </a>
              )}
            </p>
          )}
        </div>
        {view === 'table' ? (
          // Focusable, so a pane too small for the table can be scrolled from the keyboard.
          <div className="wrx-map__table-wrap" tabIndex={0} role="region" aria-label="Assets">
            {count === 0 ? (
              <p className="wrx-empty">This world state has no assets.</p>
            ) : (
              <table className="wrx-map__table">
                <caption className="wrx-visually-hidden">
                  Assets in the world state for turn {state.turn}, by force
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Force</th>
                    <th scope="col">Category</th>
                    <th scope="col">State</th>
                    <th scope="col">Health</th>
                    <th scope="col">Fuel</th>
                    <th scope="col">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ asset: a, forceName }) => (
                    <tr
                      key={a.id}
                      data-asset={a.id}
                      className={a.id === selected ? 'wrx-map__row--selected' : undefined}
                    >
                      <th scope="row">
                        <button
                          type="button"
                          className="wrx-map__pick"
                          aria-pressed={a.id === selected}
                          aria-controls={a.id === selected ? detailsId : undefined}
                          onClick={() => {
                            setPicked(a.id === selected ? undefined : a.id)
                          }}
                        >
                          {a.title}
                        </button>
                      </th>
                      <td>{forceName}</td>
                      <td>{a.category}</td>
                      <td>{a.state}</td>
                      <td>{formatPercent(a.health)}</td>
                      <td>{formatPercent(a.fuel)}</td>
                      <td>{formatPosition(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
        {asset === undefined ? null : (
          <section id={detailsId} className="wrx-map__details" aria-label="Asset details">
            <h3 className="wrx-map__details-title">{asset.title}</h3>
            <dl className="wrx-map__fields">
              {assetFields(asset, forceNameOf(asset.forceId, forces)).map(([label, value]) => (
                <div key={label} className="wrx-map__field">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="wrx-map__details-actions">
              <Button
                size="small"
                onClick={() => {
                  setView('map')
                  setShowRequest((n) => n + 1)
                }}
              >
                Show on map
              </Button>
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  setPicked(undefined)
                }}
              >
                Close
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** The room's opening view, from its validated config; anything else reads as the defaults. */
function mapConfig(config: unknown): MapRoomConfig | undefined {
  const parsed = mapRoomConfigReader.safeParse(config)
  return parsed.success ? parsed.data : undefined
}

/** The map room panel over the pane's store (PLY-57). */
export function MapPanel({ roomId, room, config }: PlayerPanelProps) {
  const world = useWorldState(roomId)
  const forces = useForces().data
  const tiles = useMapTiles()
  const view = useMemo(() => mapConfig(config), [config])
  return (
    <MapPanelCore
      name={room.name}
      state={world.data?.state}
      loading={world.status === 'loading'}
      problem={world.status === 'error' ? (world.error?.message ?? 'unavailable') : undefined}
      forces={forces}
      config={view}
      tiles={tiles}
    />
  )
}
