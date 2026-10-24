import {
  Actions,
  DockLocation,
  Layout,
  Model,
  TabNode,
  TabSetNode,
  type Action,
  type IJsonModel,
  type IJsonTabNode,
  type ITabRenderValues,
} from 'flexlayout-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { registerHarness, type TabsetInfo } from '../shared/harness.ts'
import { RoomPanel, type WorkspaceProps } from '../shared/Page.tsx'
import { defaultColumns, pickFewest, reconcilePlan, room, type Room } from '../shared/rooms.ts'
import { RoomTabLabel } from '../shared/unread.tsx'

/**
 * FlexLayout derives DOM ids from node ids (id="flexlayout-tabbutton-<id>") and moves focus
 * with document.getElementById. Four workspaces showing the same rooms would share ids and
 * keyboard focus would jump to the first workspace (D15). So tab ids are namespaced by
 * workspace, and ?rawids shows the failure.
 */
interface TabIds {
  tab(roomId: string): string
  room(tabId: string): string
}

function tabIds(wsId: string, raw: boolean): TabIds {
  const prefix = `${wsId}:`
  return {
    tab: (roomId) => (raw ? roomId : prefix + roomId),
    room: (tabId) => (tabId.startsWith(prefix) ? tabId.slice(prefix.length) : tabId),
  }
}

function tabJson(r: Room, ids: TabIds): IJsonTabNode {
  return { type: 'tab', id: ids.tab(r.id), name: r.name, component: 'room' }
}

/** PLY-40 default as FlexLayout JSON: one row of equal-weight tabsets. */
function defaultJson(rooms: readonly Room[], ids: TabIds): IJsonModel {
  return {
    global: {
      tabEnableClose: false,
      tabEnablePopout: true,
      tabEnablePopoutIcon: true,
    },
    borders: [],
    layout: {
      type: 'row',
      weight: 100,
      children: defaultColumns(rooms).map((column) => ({
        type: 'tabset',
        weight: 1,
        children: column.map((r) => tabJson(r, ids)),
      })),
    },
  }
}

/** Tabsets of the docked layout in tree (left-to-right) order; popouts excluded. */
function mainTabsets(model: Model): TabSetNode[] {
  const out: TabSetNode[] = []
  model.visitLayoutNodes(Model.MAIN_LAYOUT_ID, (node) => {
    if (node instanceof TabSetNode) out.push(node)
  })
  return out
}

function allTabs(model: Model): TabNode[] {
  const out: TabNode[] = []
  model.visitNodes((node) => {
    if (node instanceof TabNode) out.push(node)
  })
  return out
}

/** PLY-41: public API only. Count each docked tabset's tabs; add to the first with fewest. */
function addToFewest(model: Model, r: Room, ids: TabIds): void {
  const tabsets = mainTabsets(model)
  const target = tabsets[pickFewest(tabsets.map((ts) => ts.getChildren().length))]
  if (target === undefined) throw new Error('no tabset')
  model.doAction(Actions.addTab(tabJson(r, ids), target.getId(), DockLocation.CENTER, -1, false))
}

/** D6, PLY-6: drop rooms no longer visible, add new ones by the PLY-41 rule. */
function reconcile(model: Model, rooms: readonly string[], ids: TabIds): void {
  const plan = reconcilePlan(
    allTabs(model).map((t) => ids.room(t.getId())),
    rooms,
  )
  for (const id of plan.remove) model.doAction(Actions.deleteTab(ids.tab(id)))
  for (const id of plan.add) addToFewest(model, room(id), ids)
}

const rawIds = new URLSearchParams(location.search).has('rawids')

export function FlexWorkspace({ wsId, initialRooms, unread }: WorkspaceProps) {
  const [ids] = useState(() => tabIds(wsId, rawIds))
  const [model, setModel] = useState(() => Model.fromJson(defaultJson(initialRooms, ids)))
  const modelRef = useRef(model)
  const roomsRef = useRef(initialRooms.map((r) => r.id))
  // StrictMode may render twice; the ref must hold the model the Layout actually committed.
  useEffect(() => {
    modelRef.current = model
  }, [model])

  // FlexLayout turns a closed popout window into a floating panel (CLOSE_POPOUT sets the
  // layout's type to "float"). Dock its tabs back by the PLY-41 rule instead, via moveNode;
  // dockFloatToLayout refuses DockLocation.CENTER, so it cannot merge into a tabset.
  useEffect(() => {
    const listener = {
      onAfterAction(action: Action) {
        if (action.type !== Actions.CLOSE_POPOUT) return
        const layoutId: unknown = action.data['layoutId']
        queueMicrotask(() => {
          for (const t of allTabs(model).filter((t) => t.getLayoutId() === layoutId)) {
            const tabsets = mainTabsets(model)
            const target = tabsets[pickFewest(tabsets.map((ts) => ts.getChildren().length))]
            if (target !== undefined)
              model.doAction(
                Actions.moveNode(t.getId(), target.getId(), DockLocation.CENTER, -1, false),
              )
          }
        })
      },
    }
    model.addChangeListener(listener)
    return () => model.removeChangeListener(listener)
  }, [model])

  useEffect(() => {
    // Swap in a new model. Passing the old one to fromJson keeps matching tabs mounted.
    const swap = (next: Model) => {
      modelRef.current = next
      setModel(next)
    }
    return registerHarness(wsId, {
      library: 'flexlayout',
      rooms: () => [...roomsRef.current],
      structure: (): TabsetInfo[] =>
        mainTabsets(modelRef.current).map((ts) => {
          const selected = ts.getSelectedNode()
          return {
            id: ts.getId(),
            tabs: ts.getChildren().map((n) => ids.room(n.getId())),
            selected: selected === undefined ? undefined : ids.room(selected.getId()),
          }
        }),
      popouts: () =>
        allTabs(modelRef.current)
          .filter((t) => t.getLayoutId() !== Model.MAIN_LAYOUT_ID)
          .map((t) => ids.room(t.getId())),
      toJson: () => JSON.stringify(modelRef.current.toJson()),
      addRoom(id) {
        roomsRef.current = [...roomsRef.current, id]
        addToFewest(modelRef.current, room(id), ids)
      },
      removeRoom(id) {
        roomsRef.current = roomsRef.current.filter((r) => r !== id)
        modelRef.current.doAction(Actions.deleteTab(ids.tab(id)))
      },
      moveRoom(id, toTabset) {
        const target = mainTabsets(modelRef.current)[toTabset]
        if (target === undefined) throw new Error(`no tabset ${toTabset}`)
        modelRef.current.doAction(
          Actions.moveNode(ids.tab(id), target.getId(), DockLocation.CENTER, -1, true),
        )
      },
      selectRoom(id) {
        modelRef.current.doAction(Actions.selectTab(ids.tab(id)))
      },
      restore(json, rooms) {
        roomsRef.current = [...rooms]
        const next = Model.fromJson(JSON.parse(json) as IJsonModel, modelRef.current)
        reconcile(next, rooms, ids)
        swap(next)
      },
      reset() {
        swap(Model.fromJson(defaultJson(roomsRef.current.map(room), ids), modelRef.current))
      },
      setUnread: (id, count) => unread.set(id, count),
    })
  }, [wsId, unread, ids])

  const factory = (node: TabNode) =>
    node.getComponent() === 'room' ? <RoomPanel roomId={ids.room(node.getId())} /> : null

  // PLY-11: the unread badge goes in through the tab-render callback, never the DOM.
  const onRenderTab = (node: TabNode, values: ITabRenderValues) => {
    const r = room(ids.room(node.getId()))
    values.content = <RoomTabLabel roomId={r.id} name={node.getName()} accent={r.accent} />
  }

  // NFR-14 workaround: FlexLayout has no keyboard tab move, so Alt+Shift+Arrow moves the
  // selected tab of the active tabset to the neighbouring tabset through Actions.moveNode.
  const onKeyDownCapture = (e: KeyboardEvent) => {
    if (!e.altKey || !e.shiftKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return
    const m = modelRef.current
    const from = m.getActiveTabset()
    const tab = from?.getSelectedNode()
    if (from === undefined || tab === undefined) return
    const tabsets = mainTabsets(m)
    const target = tabsets[tabsets.indexOf(from) + (e.key === 'ArrowRight' ? 1 : -1)]
    e.preventDefault()
    e.stopPropagation()
    if (target !== undefined)
      m.doAction(Actions.moveNode(tab.getId(), target.getId(), DockLocation.CENTER, -1, true))
  }

  return (
    <div className="lib-root" onKeyDownCapture={onKeyDownCapture}>
      <Layout model={model} factory={factory} onRenderTab={onRenderTab} popoutURL="popout.html" />
    </div>
  )
}
