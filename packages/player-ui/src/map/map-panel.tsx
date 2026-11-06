// The map room's player panel (PLY-57, ARC-5): the world state this client accepts (D25, PLY-58,
// PLY-59), from `useWorldState`, on a Leaflet map with milsymbol symbols, and the same assets in
// a table, the view a keyboard or screen reader uses. Selecting an asset, on either, shows its
// fields. Read-only for every role: the map room has no composer. Register it with `withSlots`
// for `map`.
//
// In the admin's own game view (not a preview as a role), the panel is also the world-state
// editor (ADM-44, WP 5.6): assets are added (a form, or a click on the map), dragged, edited in a
// form and deleted, into a draft held in this browser (ADM-45, R25), and published from here with
// a change summary (ADM-46), or with the next phase change from the turn panel.
import {
  addWorldAsset,
  moveWorldAsset,
  normalisePosition,
  removeWorldAsset,
  updateWorldAsset,
} from '@wrx/domain'
import { useForces, useGameState, useMe, useSessionStore, useWorldState } from '@wrx/hooks'
import type { PlayerPanelProps } from '@wrx/hooks'
import { mapRoomConfigReader } from '@wrx/schemas'
import type { Force, MapRoomConfig, WorldAsset, WorldState } from '@wrx/schemas'
import { Banner, Button, ChunkBoundary, Spinner } from '@wrx/ui'
import { Suspense, useCallback, useId, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { AssetForm } from './asset-form.tsx'
import { LazyMapView } from './lazy.tsx'
import { ConfirmPanel, DraftBanner, PublishPanel, newAsset } from './map-editor.tsx'
import type { MapEditing } from './map-editor.tsx'
import { useMapTiles } from './tiles.tsx'
import type { MapTiles } from './tiles.tsx'
import {
  assetBounds,
  assetFields,
  assetRows,
  forceNameOf,
  formatPercent,
  formatPosition,
} from './view.ts'
import {
  draftForTurn,
  sizeRefusal,
  useAdminWorldDraft,
  useWorldDraftStorage,
  worldPublishErrorText,
} from './world-draft.tsx'

export interface MapPanelCoreProps {
  readonly name: string
  /** The accepted world state, if one has been found; for the admin's editor, its draft. */
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
  /** The admin's world-state editor (ADM-44); undefined for everyone else. */
  readonly editing?: MapEditing | undefined
  /**
   * The search stopped at its page limit with none found among the newest messages
   * (`WorldStateView.unreached`): the panel says so and offers to look further back.
   */
  readonly onSearchFurther?: (() => void) | undefined
}

type View = 'map' | 'table'

/** What the side panel shows for the editor, over an asset's details. */
type Task =
  | { readonly kind: 'add'; readonly asset: WorldAsset }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'delete'; readonly id: string }
  | { readonly kind: 'publish' }
  | { readonly kind: 'discard' }

/** The status line over the map, announced when it changes (PLY-59). */
function statusText(state: WorldState, editing: MapEditing | undefined, assets: string): string {
  if (editing?.dirty === true) return `Your draft for turn ${state.turn}: ${assets}, not published`
  if (editing !== undefined && !editing.anyPublished) {
    return `No world state published yet: ${assets}`
  }
  return `World state for turn ${state.turn}: ${assets}`
}

export function MapPanelCore({
  name,
  state,
  loading,
  problem,
  forces,
  config,
  tiles,
  editing,
  onSearchFurther,
}: MapPanelCoreProps) {
  const [view, setView] = useState<View>('map')
  const [picked, setPicked] = useState<string | undefined>(undefined)
  const [fitRequest, setFitRequest] = useState(0)
  const [showRequest, setShowRequest] = useState(0)
  const [task, setTask] = useState<Task | undefined>(undefined)
  const [placing, setPlacing] = useState(false)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  // The table's one Tab stop among its rows (A2, WP 5.9): the row last moved to with the arrow
  // keys, else the selected asset's, else the first.
  const [rowStop, setRowStop] = useState<string | undefined>(undefined)
  const detailsId = useId()
  const rows = useMemo(() => (state === undefined ? [] : assetRows(state, forces)), [state, forces])
  // A selection the newer state no longer holds is gone.
  const selected = picked !== undefined && state?.assets[picked] !== undefined ? picked : undefined
  const asset = selected === undefined ? undefined : state?.assets[selected]
  const select = useCallback((id: string) => {
    setPicked(id)
  }, [])
  const onEdit = editing?.onEdit
  const onMove = useCallback(
    (id: string, lat: number, lon: number) => {
      if (onEdit === undefined) return
      setEditError(onEdit((s) => moveWorldAsset(s, id, lat, lon)))
    },
    [onEdit],
  )
  const onPlace = useCallback(
    (lat: number, lon: number) => {
      setPlacing(false)
      setTask({ kind: 'add', asset: newAsset(forces, normalisePosition(lat, lon)) })
    },
    [forces],
  )

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (placing) {
      event.stopPropagation()
      setPlacing(false)
    } else if (task !== undefined) {
      event.stopPropagation()
      setTask(undefined)
    } else if (selected !== undefined) {
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
        ) : onSearchFurther !== undefined ? (
          <div className="wrx-empty">
            <p>
              The umpire’s latest world state was not among this room’s recent messages, which hold
              many messages that are not world states from the umpire. It is further back.
            </p>
            <Button size="small" onClick={onSearchFurther}>
              Look further back
            </Button>
          </div>
        ) : (
          <p className="wrx-empty">The umpire has not published a world state yet.</p>
        )}
      </div>
    )
  }

  const count = rows.length
  const assets = `${count.toLocaleString('en-GB')} ${count === 1 ? 'asset' : 'assets'}`
  // A task on an asset another tab has since deleted is over.
  const open =
    task !== undefined &&
    (task.kind === 'edit' || task.kind === 'delete') &&
    state.assets[task.id] === undefined
      ? undefined
      : task
  const close = () => {
    setTask(undefined)
  }

  let side: ReactNode = null
  if (editing !== undefined && open !== undefined) {
    switch (open.kind) {
      case 'add':
        side = (
          <AssetForm
            key={open.asset.id}
            mode="add"
            asset={open.asset}
            forces={forces}
            onCancel={close}
            onSave={(added) => {
              const refused = editing.onEdit((s) => addWorldAsset(s, added))
              if (refused === undefined) {
                setTask(undefined)
                setPicked(added.id)
              }
              return refused
            }}
          />
        )
        break
      case 'edit': {
        const current = state.assets[open.id]
        if (current === undefined) break
        side = (
          <AssetForm
            key={open.id}
            mode="edit"
            asset={current}
            forces={forces}
            onCancel={close}
            onSave={(changed) => {
              const { id: _id, ...patch } = changed
              const refused = editing.onEdit((s) => updateWorldAsset(s, open.id, patch))
              if (refused === undefined) setTask(undefined)
              return refused
            }}
          />
        )
        break
      }
      case 'delete': {
        const current = state.assets[open.id]
        side = (
          <ConfirmPanel
            title={`Delete ${current?.title ?? 'this asset'}?`}
            text="It is removed from your draft. Players still see it until you publish; discarding the draft brings it back."
            action="Delete from the draft"
            onClose={close}
            onConfirm={() => {
              setEditError(editing.onEdit((s) => removeWorldAsset(s, open.id)))
              setTask(undefined)
              setPicked(undefined)
            }}
          />
        )
        break
      }
      case 'publish':
        side = <PublishPanel editing={editing} forces={forces} onClose={close} />
        break
      case 'discard':
        side = (
          <ConfirmPanel
            title="Discard the draft?"
            text="Every unpublished edit is lost, and the map shows the published world state again. Players see no change."
            action="Discard draft"
            onClose={close}
            onConfirm={() => {
              editing.onDiscard()
              setTask(undefined)
            }}
          />
        )
        break
    }
  }
  if (side === null && asset !== undefined) {
    side = (
      <>
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
          {editing === undefined ? null : (
            <>
              <Button
                size="small"
                variant="primary"
                onClick={() => {
                  setTask({ kind: 'edit', id: asset.id })
                }}
              >
                Edit…
              </Button>
              <Button
                size="small"
                variant="danger"
                onClick={() => {
                  setTask({ kind: 'delete', id: asset.id })
                }}
              >
                Delete…
              </Button>
            </>
          )}
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
      </>
    )
  }

  const ids = new Set(rows.map((r) => r.asset.id))
  const tabStop =
    rowStop !== undefined && ids.has(rowStop)
      ? rowStop
      : selected !== undefined && ids.has(selected)
        ? selected
        : rows[0]?.asset.id

  const addAt = () => {
    const bounds = assetBounds(Object.values(state.assets))
    const centre =
      bounds === undefined
        ? { lat: 0, lon: 0 }
        : { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 }
    setPlacing(false)
    setTask({ kind: 'add', asset: newAsset(forces, normalisePosition(centre.lat, centre.lon)) })
  }

  return (
    <div
      className={editing === undefined ? 'wrx-map' : 'wrx-map wrx-map--editing'}
      role="group"
      aria-label={`${name}: world state`}
      onKeyDown={onKeyDown}
    >
      <div className="wrx-map__bar">
        <h2 className="wrx-map__name">{name}</h2>
        {/* Announced when a newer state replaces this one (PLY-59). */}
        <p className="wrx-map__turn" role="status">
          {statusText(state, editing, assets)}
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
      {editing === undefined ? null : (
        <div className="wrx-map__editor" role="group" aria-label="World-state editor">
          <div className="wrx-map__tools">
            <Button size="small" onClick={addAt}>
              Add asset…
            </Button>
            <Button
              size="small"
              aria-pressed={placing}
              onClick={() => {
                setView('map')
                setPlacing((p) => !p)
              }}
            >
              Place on map
            </Button>
            <Button
              size="small"
              disabled={!editing.dirty}
              onClick={() => {
                setPlacing(false)
                setTask({ kind: 'publish' })
              }}
            >
              Publish world state…
            </Button>
            {editing.hasDraft ? (
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  setPlacing(false)
                  setTask({ kind: 'discard' })
                }}
              >
                Discard draft…
              </Button>
            ) : null}
          </div>
          {placing ? (
            <p className="wrx-map__draft-note" role="status">
              Click the map where the new asset goes, or press Escape. Drag a symbol to move it.
            </p>
          ) : null}
          {editError === undefined ? null : (
            <Banner
              tone="danger"
              title="That edit was not made"
              onDismiss={() => {
                setEditError(undefined)
              }}
            >
              {editError}
            </Banner>
          )}
          <DraftBanner editing={editing} />
        </div>
      )}
      <div className="wrx-map__body">
        {/* The map stays mounted behind the table, so switching back keeps its view. */}
        <div className="wrx-map__stage" hidden={view !== 'map'}>
          <ChunkBoundary what="the map">
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
                editable={editing !== undefined}
                onMove={onMove}
                placing={placing}
                onPlace={onPlace}
              />
            </Suspense>
          </ChunkBoundary>
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
                  Assets in the world state for turn {state.turn}, by force. The up and down arrow
                  keys move between assets; Tab leaves the table.
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
                <tbody
                  onKeyDown={(event) => {
                    const to = rowKeyTarget(
                      event.key,
                      rows.map((r) => r.asset.id),
                      (event.target as HTMLElement).closest('tr')?.dataset.asset,
                    )
                    if (to === undefined) return
                    event.preventDefault()
                    setRowStop(to)
                    event.currentTarget
                      .querySelector<HTMLButtonElement>(`tr[data-asset="${CSS.escape(to)}"] button`)
                      ?.focus()
                  }}
                >
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
                          tabIndex={a.id === tabStop ? 0 : -1}
                          onFocus={() => {
                            setRowStop(a.id)
                          }}
                          onClick={() => {
                            // Safari does not focus a clicked button: the stop follows the click.
                            setRowStop(a.id)
                            setTask(undefined)
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
        {side === null ? null : (
          <section
            id={detailsId}
            className={
              open === undefined ? 'wrx-map__details' : 'wrx-map__details wrx-map__details--task'
            }
            aria-label={open === undefined ? 'Asset details' : 'World-state editor panel'}
          >
            {side}
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

/**
 * The map room panel over the pane's store (PLY-57); for the admin's own view, with the
 * world-state editor when the host keeps drafts (`WorldDraftProvider`).
 */
export function MapPanel({ roomId, room, config }: PlayerPanelProps) {
  const world = useWorldState(roomId)
  const forces = useForces().data
  const tiles = useMapTiles()
  const view = useMemo(() => mapConfig(config), [config])
  const store = useSessionStore()
  const storage = useWorldDraftStorage()
  // The admin's own view only: a preview as a role reports the role, not the admin (ADM-30).
  const isAdmin = useMe().data.identity.isAdmin
  const turn = useGameState().data?.turn
  const draft = useAdminWorldDraft(isAdmin ? roomId : undefined, world.data, turn)

  const toPublish = draft?.draft === undefined ? undefined : draftForTurn(draft.draft, turn)
  const onPublish = useCallback(async (): Promise<string | undefined> => {
    if (draft?.draft === undefined || toPublish === undefined || storage === undefined) {
      return 'there is no draft to publish.'
    }
    const tooLarge = sizeRefusal(toPublish)
    if (tooLarge !== undefined) return tooLarge
    const sent = await store.sendWorldState(roomId, toPublish)
    if (!sent.ok) return worldPublishErrorText(sent.error)
    if (draft.text !== undefined) {
      storage.published(draft.key, draft.text, toPublish, draft.publishedStanzaId)
    }
    return undefined
  }, [draft, toPublish, storage, store, roomId])

  const editing: MapEditing | undefined =
    draft === undefined
      ? undefined
      : {
          dirty: draft.dirty,
          hasDraft: draft.draft !== undefined,
          diff: draft.diff,
          toPublish,
          anyPublished: draft.published !== undefined,
          stale: draft.stale,
          orphaned: draft.orphaned,
          saveProblem: draft.saveProblem,
          unreadable: draft.unreadable,
          onEdit: draft.edit,
          onDiscard: draft.discard,
          onPublish,
        }
  return (
    <MapPanelCore
      name={room.name}
      state={draft === undefined ? world.data?.state : draft.working}
      loading={
        (world.status === 'loading' || draft?.searching === true) && world.data?.unreached !== true
      }
      problem={world.status === 'error' ? (world.error?.message ?? 'unavailable') : undefined}
      forces={forces}
      config={view}
      tiles={tiles}
      editing={editing}
      onSearchFurther={
        world.data?.unreached === true && !world.data.searching
          ? () => void store.searchWorldStateFurther(roomId)
          : undefined
      }
    />
  )
}

/** How far Page Up and Page Down move in the asset table. */
const ROW_PAGE = 10

/**
 * The row the asset table's arrow keys move to from `from` (A2, WP 5.9): up and down by one,
 * Page Up and Page Down by ten, Home and End to the ends. Undefined for any other key.
 */
export function rowKeyTarget(
  key: string,
  ids: readonly string[],
  from: string | undefined,
): string | undefined {
  if (ids.length === 0) return undefined
  const at = from === undefined ? -1 : ids.indexOf(from)
  const last = ids.length - 1
  const index =
    key === 'ArrowDown'
      ? Math.min(at + 1, last)
      : key === 'ArrowUp'
        ? Math.max(at - 1, 0)
        : key === 'PageDown'
          ? Math.min(at + ROW_PAGE, last)
          : key === 'PageUp'
            ? Math.max(at - ROW_PAGE, 0)
            : key === 'Home'
              ? 0
              : key === 'End'
                ? last
                : undefined
  return index === undefined ? undefined : ids[index]
}
