import {
  DockviewReact,
  Orientation,
  themeLight,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type SerializedDockview,
} from 'dockview-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { registerHarness, type TabsetInfo } from '../shared/harness.ts'
import { RoomPanel, type WorkspaceProps } from '../shared/Page.tsx'
import { defaultColumns, pickFewest, reconcilePlan, room, type Room } from '../shared/rooms.ts'
import { RoomTabLabel } from '../shared/unread.tsx'

// The group state type is not exported, so derive it from the public serialised form.
type GridNode = SerializedDockview['grid']['root']
type GroupState = Exclude<GridNode['data'], unknown[]>

// Relative, so it works under any base path. dockview's own default is root-relative
// '/popout.html', which breaks a build served from a sub-path (DOC-11).
const POPOUT_URL = 'popout.html'

/**
 * PLY-40 default as a dockview layout. Built as SerializedDockview and loaded with fromJSON:
 * adding groups one by one with addGroup({direction: 'right'}) halves the reference group each
 * time, so equal columns would need a setSize pass after layout.
 */
function defaultLayout(rooms: readonly Room[]): SerializedDockview {
  const columns = defaultColumns(rooms)
  const width = 1200
  const height = 800
  return {
    grid: {
      root: {
        type: 'branch',
        size: height,
        data: columns.map((column, i): GridNode => ({
          type: 'leaf',
          size: width / columns.length,
          data: { id: `col-${i}`, views: column.map((r) => r.id), activeView: column[0]?.id },
        })),
      },
      width,
      height,
      orientation: Orientation.HORIZONTAL,
    },
    panels: Object.fromEntries(
      rooms.map((r) => [
        r.id,
        { id: r.id, contentComponent: 'room', tabComponent: 'room', title: r.name },
      ]),
    ),
  }
}

/** Docked groups in tree (left-to-right) order, read from the public serialised form. */
function mainGroups(api: DockviewApi): TabsetInfo[] {
  const out: TabsetInfo[] = []
  const walk = (node: GridNode) => {
    if (Array.isArray(node.data)) {
      for (const child of node.data) walk(child)
    } else {
      const data: GroupState = node.data
      out.push({ id: data.id, tabs: [...data.views], selected: data.activeView })
    }
  }
  if (api.groups.some((g) => g.api.location.type === 'grid')) walk(api.toJSON().grid.root)
  return out
}

function groupById(api: DockviewApi, id: string): DockviewGroupPanel {
  const group = api.groups.find((g) => g.id === id)
  if (group === undefined) throw new Error(`no group ${id}`)
  return group
}

/** PLY-41: public API only. Count each docked group's panels; add to the first with fewest. */
function addToFewest(api: DockviewApi, r: Room): void {
  const groups = mainGroups(api)
  const target = groups[pickFewest(groups.map((g) => g.tabs.length))]
  api.addPanel({
    id: r.id,
    component: 'room',
    tabComponent: 'room',
    title: r.name,
    inactive: true,
    ...(target === undefined
      ? {}
      : { position: { referenceGroup: target.id, direction: 'within' as const } }),
  })
}

/** D6, PLY-6: drop rooms no longer visible, add new ones by the PLY-41 rule. */
function reconcile(api: DockviewApi, rooms: readonly string[]): void {
  const plan = reconcilePlan(
    api.panels.map((p) => p.id),
    rooms,
  )
  for (const id of plan.remove) {
    const panel = api.getPanel(id)
    if (panel !== undefined) api.removePanel(panel)
  }
  for (const id of plan.add) addToFewest(api, room(id))
}

const components = {
  room: (props: IDockviewPanelProps) => <RoomPanel roomId={props.api.id} />,
}

// PLY-11: the unread badge goes in through a tab component, never the DOM.
const tabComponents = {
  room: (props: IDockviewPanelHeaderProps) => {
    const r = room(props.api.id)
    return <RoomTabLabel roomId={r.id} name={props.api.title ?? r.name} accent={r.accent} />
  },
}

/** dockview has no built-in pop-out button; this header action pops out the active panel. */
function PopoutAction(props: IDockviewHeaderActionsProps) {
  const panel = props.activePanel
  if (panel === undefined || props.group.api.location.type !== 'grid') return null
  return (
    <button
      type="button"
      className="popout-action"
      aria-label={`Pop out ${panel.title ?? panel.id}`}
      onClick={() => void props.containerApi.addPopoutGroup(panel, { popoutUrl: POPOUT_URL })}
    >
      ⧉
    </button>
  )
}

const keyboardNavigation = new URLSearchParams(location.search).has('kbnav')

export function DockWorkspace({ wsId, initialRooms, unread }: WorkspaceProps) {
  const apiRef = useRef<DockviewApi | null>(null)
  const roomsRef = useRef(initialRooms.map((r) => r.id))

  const onReady = (event: DockviewReadyEvent) => {
    // Under StrictMode dockview is created, disposed and created again: keep the latest.
    apiRef.current = event.api
    event.api.fromJSON(defaultLayout(roomsRef.current.map(room)))
  }

  useEffect(() => {
    const api = () => {
      if (apiRef.current === null) throw new Error('dockview not ready')
      return apiRef.current
    }
    return registerHarness(wsId, {
      library: 'dockview',
      rooms: () => [...roomsRef.current],
      structure: () => mainGroups(api()),
      popouts: () =>
        api()
          .groups.filter((g) => g.api.location.type === 'popout')
          .flatMap((g) => g.panels.map((p) => p.id)),
      toJson: () => JSON.stringify(api().toJSON()),
      addRoom(id) {
        roomsRef.current = [...roomsRef.current, id]
        addToFewest(api(), room(id))
      },
      removeRoom(id) {
        roomsRef.current = roomsRef.current.filter((r) => r !== id)
        const panel = api().getPanel(id)
        if (panel !== undefined) api().removePanel(panel)
      },
      moveRoom(id, toTabset) {
        const target = mainGroups(api())[toTabset]
        const panel = api().getPanel(id)
        if (target === undefined || panel === undefined) throw new Error(`cannot move ${id}`)
        panel.api.moveTo({ group: groupById(api(), target.id), position: 'center' })
      },
      selectRoom(id) {
        api().getPanel(id)?.api.setActive()
      },
      restore(json, rooms) {
        roomsRef.current = [...rooms]
        // reuseExistingPanels keeps matching panels mounted, like FlexLayout's previousModel.
        api().fromJSON(JSON.parse(json) as SerializedDockview, { reuseExistingPanels: true })
        reconcile(api(), rooms)
      },
      reset() {
        api().fromJSON(defaultLayout(roomsRef.current.map(room)), { reuseExistingPanels: true })
      },
      setUnread: (id, count) => unread.set(id, count),
    })
  }, [wsId, unread])

  // NFR-14 workaround: keyboard docking is a dockview-enterprise module, so Alt+Shift+Arrow
  // moves the active panel to the neighbouring group through panel.api.moveTo.
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (!e.altKey || !e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    const api = apiRef.current
    const panel = api?.activePanel
    if (api === null || panel === undefined) return
    const groups = mainGroups(api)
    const from = groups.findIndex((g) => g.id === panel.group.id)
    const target = groups[from + (e.key === 'ArrowRight' ? 1 : -1)]
    e.preventDefault()
    e.stopPropagation()
    if (from !== -1 && target !== undefined)
      panel.api.moveTo({ group: groupById(api, target.id), position: 'center' })
  }

  return (
    <div className="lib-root" onKeyDownCapture={onKeyDownCapture}>
      <DockviewReact
        components={components}
        tabComponents={tabComponents}
        rightHeaderActionsComponent={PopoutAction}
        onReady={onReady}
        theme={themeLight}
        popoutUrl={POPOUT_URL}
        keyboardNavigation={keyboardNavigation}
      />
    </div>
  )
}
