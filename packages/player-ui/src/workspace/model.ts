// The FlexLayout adapter (ARC-9): the only code that touches the library's model. Every change
// goes through `Model.doAction` with `Actions.*`, the library's public API, and runs without a
// DOM, so the layout rules are unit-tested in Node. FlexLayout's `any` (doAction's result,
// `Action.data`) stops here: callers see typed functions only.
import { Actions, BorderNode, DockLocation, Model, TabNode, TabSetNode } from 'flexlayout-react'
import type {
  Action,
  IGlobalAttributes,
  IJsonBorderNode,
  IJsonModel,
  IJsonRowNode,
  IJsonTabNode,
  IJsonTabSetNode,
} from 'flexlayout-react'
import { parseTabId, roomTabId } from './ids.ts'
import type { TabIds, TabKind } from './ids.ts'
import { defaultColumns, sameRooms } from './rules.ts'
import { parseRoomTabState } from './tab-state.ts'
import type { RoomTabState } from './tab-state.ts'

export { Model }
export type { Action }

/** A tab the workspace should hold: its logical id and its label. */
export interface TabSpec {
  /** `room:<roomId>` or `panel:<panelId>` (see `ids.ts`). */
  readonly id: string
  readonly name: string
}

/** Everything the workspace shows: the role's rooms in display order, and the other panels. */
export interface LayoutSpec {
  readonly rooms: readonly TabSpec[]
  readonly panels: readonly TabSpec[]
  /**
   * A tab the host adds and takes away (`special:<id>`), e.g. the out-of-game column in a narrow
   * client (FT-1). It cannot be closed or popped out, and it is never saved: a saved layout
   * holds the rooms and panels only, so adding and removing it leaves them where they were.
   */
  readonly special?: TabSpec | undefined
}

/** The tab button class of a special tab, which the workspace styles (FT-1). */
export const SPECIAL_TAB_CLASS = 'wrx-tab-special'

/** A docked tabset, for tests and announcements. */
export interface TabsetInfo {
  /** Logical tab ids in tab-strip order. */
  readonly tabs: readonly string[]
  readonly selected: string | undefined
}

/** Where the non-room panels start: a collapsed strip along the bottom (PLY-8). */
const PANEL_BORDER = 'bottom'

/** Settings applied to every model, saved or default; never read back from storage. */
const GLOBAL: IGlobalAttributes = Object.freeze({
  tabEnableClose: false,
  tabEnableRename: false,
  tabEnableFloat: false,
  tabEnablePopout: true,
  tabEnablePopoutIcon: true,
  tabSetEnableTabGroups: false,
  tabSetEnableDeleteWhenEmpty: true,
  borderEnableAutoHide: false,
  borderSize: 260,
})

function tabJson(spec: TabSpec, ids: TabIds): IJsonTabNode {
  const kind: TabKind = parseTabId(spec.id)?.kind ?? 'room'
  const tab: IJsonTabNode = {
    type: 'tab',
    id: ids.toModel(spec.id),
    name: spec.name,
    component: kind,
  }
  if (kind !== 'special') return tab
  // Its content belongs to the host's page (FT-1), so it stays docked in this window.
  return {
    ...tab,
    className: SPECIAL_TAB_CLASS,
    enableClose: false,
    enablePopout: false,
    enablePopoutIcon: false,
    enableFloat: false,
    enableRename: false,
  }
}

function act(model: Model, action: Action): void {
  // doAction returns `any`; nothing here needs its result.
  model.doAction(action)
}

// ---- Building ----------------------------------------------------------------------------

/** PLY-40 (and PLY-42 reset): rooms in up to three equal columns, panels in the bottom strip. */
export function defaultLayoutJson(spec: LayoutSpec, ids: TabIds): IJsonModel {
  const columns = defaultColumns(spec.rooms)
  return {
    global: { ...GLOBAL },
    borders: [
      {
        type: 'border',
        location: PANEL_BORDER,
        selected: -1,
        children: spec.panels.map((p) => tabJson(p, ids)),
      },
    ],
    layout: {
      type: 'row',
      weight: 100,
      children: (columns.length === 0 ? [[]] : columns).map((column): IJsonTabSetNode => ({
        type: 'tabset',
        weight: 1,
        children: column.map((r) => tabJson(r, ids)),
      })),
    },
  }
}

export function defaultModel(spec: LayoutSpec, ids: TabIds, previous?: Model): Model {
  return Model.fromJson(defaultLayoutJson(spec, ids), previous)
}

// ---- Reading -----------------------------------------------------------------------------

/** Tabsets of the docked layout in tree (left-to-right) order; borders and popouts excluded. */
export function mainTabsets(model: Model): TabSetNode[] {
  const out: TabSetNode[] = []
  model.visitLayoutNodes(Model.MAIN_LAYOUT_ID, (node) => {
    if (node instanceof TabSetNode) out.push(node)
  })
  return out
}

/** Every tab in the model: docked, in borders and in popouts. */
export function allTabs(model: Model): TabNode[] {
  const out: TabNode[] = []
  model.visitNodes((node) => {
    if (node instanceof TabNode) out.push(node)
  })
  return out
}

/** This instance's tabs by logical id. Nodes without our prefix are ignored. */
function tabsById(model: Model, ids: TabIds): Map<string, TabNode> {
  const out = new Map<string, TabNode>()
  for (const tab of allTabs(model)) {
    const logical = ids.toLogical(tab.getId())
    if (logical !== undefined) out.set(logical, tab)
  }
  return out
}

/** Logical ids of every tab, in model order. */
export function tabIdsIn(model: Model, ids: TabIds): string[] {
  return [...tabsById(model, ids).keys()]
}

/** The docked tabsets as logical ids, left to right. */
export function structure(model: Model, ids: TabIds): TabsetInfo[] {
  return mainTabsets(model).map((ts) => {
    const selected = ts.getSelectedNode()
    return {
      tabs: ts.getTabNodes().flatMap((t) => ids.toLogical(t.getId()) ?? []),
      selected: selected === undefined ? undefined : ids.toLogical(selected.getId()),
    }
  })
}

/** Logical ids of the tabs in the panel strip, in order. */
export function borderTabs(model: Model, ids: TabIds): string[] {
  const border = panelBorder(model)
  if (border === undefined) return []
  return border.getTabNodes().flatMap((t) => ids.toLogical(t.getId()) ?? [])
}

/** Logical ids of tabs outside the docked layout and the borders (popouts, floats). */
export function detachedTabs(model: Model, ids: TabIds): string[] {
  return allTabs(model)
    .filter((t) => t.getLayoutId() !== Model.MAIN_LAYOUT_ID)
    .flatMap((t) => ids.toLogical(t.getId()) ?? [])
}

function panelBorder(model: Model): BorderNode | undefined {
  let found: BorderNode | undefined
  model.visitNodes((node) => {
    if (node instanceof BorderNode && node.getLocation().getName() === PANEL_BORDER) found ??= node
  })
  return found
}

// ---- Changing ----------------------------------------------------------------------------

/** The first docked tabset, left to right, if any. */
function firstTabset(model: Model): TabSetNode | undefined {
  return mainTabsets(model)[0]
}

/**
 * Adds a tab to the first docked tabset, without selecting it; with none left (everything was
 * dragged to the strip), it starts a column. Only for tabs that are not rooms: panels with no
 * strip to go to, and the special tab (FT-1).
 */
function addDocked(model: Model, spec: TabSpec, ids: TabIds): void {
  const target = firstTabset(model) ?? model.getRootRow()
  if (target === undefined) return
  act(model, Actions.addTab(tabJson(spec, ids), target.getId(), DockLocation.CENTER, -1, false))
}

/**
 * FT-1: adds the special tab first in the strip along the bottom, unselected, so no room tab
 * changes. Not in a tabset: a narrow tabset's strip scrolls, and a tab added there is often out
 * of sight behind the overflow button, badge and all; the strip along the bottom is as wide as
 * the workspace and holds only short panel tabs, so the tab and its badge stay in view. The
 * player can drag it into a tabset like a room.
 */
function addSpecial(model: Model, spec: TabSpec, ids: TabIds): void {
  const border = panelBorder(model)
  if (border === undefined) {
    addDocked(model, spec, ids)
    return
  }
  act(model, Actions.addTab(tabJson(spec, ids), border.getId(), DockLocation.CENTER, 0, false))
}

/**
 * PLY-5: whether the model holds exactly the spec's rooms, wherever the player put them. When it
 * does not, the workspace replaces it with the default (`defaultModel`): rooms gained or lost
 * reset the layout, they are never fitted into it (PLY-6 and PLY-41 are retired).
 */
export function fitsRooms(model: Model, spec: LayoutSpec, ids: TabIds): boolean {
  const rooms = [...tabsById(model, ids).keys()].filter((id) => parseTabId(id)?.kind === 'room')
  return sameRooms(
    rooms,
    spec.rooms.map((r) => r.id),
  )
}

/**
 * Brings everything but the set of rooms in line with the spec, in place, through the public
 * API only: renamed tabs are relabelled; panels and the special tab (FT-1) the spec no longer
 * has are removed, and missing ones added (panels at the end of the strip, the special tab first
 * in it). Room tabs are neither added nor removed: a layout that does not fit the rooms is
 * replaced (`fitsRooms`).
 */
export function syncTabs(model: Model, spec: LayoutSpec, ids: TabIds): void {
  const present = tabsById(model, ids)
  const others = [...spec.panels, ...(spec.special === undefined ? [] : [spec.special])]
  const wanted = new Set(others.map((t) => t.id))
  for (const id of present.keys()) {
    if (parseTabId(id)?.kind !== 'room' && !wanted.has(id)) {
      act(model, Actions.deleteTab(ids.toModel(id)))
    }
  }
  for (const t of [...spec.rooms, ...others]) {
    const tab = present.get(t.id)
    if (tab !== undefined && tab.getName() !== t.name) {
      act(model, Actions.renameTab(tab.getId(), t.name))
    }
  }
  const border = panelBorder(model)
  for (const panel of spec.panels) {
    if (present.has(panel.id)) continue
    if (border === undefined) addDocked(model, panel, ids)
    else
      act(
        model,
        Actions.addTab(tabJson(panel, ids), border.getId(), DockLocation.CENTER, -1, false),
      )
  }
  const special = spec.special
  if (special !== undefined && !present.has(special.id)) addSpecial(model, special, ids)
}

/** The special tab's node, if the model holds it (FT-1). */
export function specialTab(model: Model, spec: LayoutSpec, ids: TabIds): TabNode | undefined {
  if (spec.special === undefined) return undefined
  const node = model.getNodeById(ids.toModel(spec.special.id))
  return node instanceof TabNode ? node : undefined
}

/**
 * Docks tabs back from popouts and floating panels (layout-library.md, weakness 2): FlexLayout
 * turns a closed popout window into a floating panel; this moves its tabs to the end of the
 * first docked tabset instead, unselected. With a layout id, only that popout's tabs move.
 */
export function dockDetached(model: Model, layoutId?: string): void {
  for (const tab of allTabs(model)) {
    const from = tab.getLayoutId()
    if (from === Model.MAIN_LAYOUT_ID) continue
    if (layoutId !== undefined && from !== layoutId) continue
    const target = firstTabset(model)
    if (target === undefined) continue
    act(model, Actions.moveNode(tab.getId(), target.getId(), DockLocation.CENTER, -1, false))
  }
}

/** The layout id a CLOSE_POPOUT action closed, or undefined for any other action. */
export function closedPopout(action: Action): string | undefined {
  if (action.type !== Actions.CLOSE_POPOUT) return undefined
  const layoutId: unknown = action.data.layoutId
  return typeof layoutId === 'string' ? layoutId : undefined
}

export interface KeyboardMove {
  /** The tab's logical id. */
  readonly tabId: string
  /** The 1-based position of its tabset after the move, left to right. */
  readonly tabset: number
  readonly tabsets: number
}

/**
 * NFR-14: moves a docked tab to the neighbouring tabset (FlexLayout has no keyboard move). At
 * the outer edge, a tab that shares its tabset splits off into a new column there. Returns
 * undefined when nothing moved.
 */
export function moveTab(
  model: Model,
  logicalId: string,
  direction: -1 | 1,
  ids: TabIds,
): KeyboardMove | undefined {
  const tab = model.getNodeById(ids.toModel(logicalId))
  if (!(tab instanceof TabNode)) return undefined
  const from = tab.getParent()
  if (!(from instanceof TabSetNode) || tab.getLayoutId() !== Model.MAIN_LAYOUT_ID) return undefined
  const tabsets = mainTabsets(model)
  const target = tabsets[tabsets.indexOf(from) + direction]
  if (target !== undefined) {
    act(model, Actions.moveNode(tab.getId(), target.getId(), DockLocation.CENTER, -1, true))
  } else if (from.getTabNodes().length > 1) {
    const side = direction > 0 ? DockLocation.RIGHT : DockLocation.LEFT
    act(model, Actions.moveNode(tab.getId(), from.getId(), side, -1, true))
  } else {
    return undefined
  }
  const after = mainTabsets(model)
  const index = after.findIndex((ts) => ts.getTabNodes().some((t) => t.getId() === tab.getId()))
  return { tabId: logicalId, tabset: index + 1, tabsets: after.length }
}

// ---- Saving and restoring (PLY-5, D6) ----------------------------------------------------

/** Maps a stored tab id to its logical id and the id to write, or undefined to drop it. */
type Rename = (id: string) => { readonly logical: string; readonly id: string } | undefined

/** A tab to keep; `special` for a special tab, which is never saved or restored (FT-1). */
function mapTab(tab: unknown, rename: Rename): IJsonTabNode | 'special' | undefined {
  if (!isRecord(tab) || tab.type !== 'tab') return undefined
  const ids = typeof tab.id === 'string' ? rename(tab.id) : undefined
  const name = tab.name
  if (ids === undefined || typeof name !== 'string') return undefined
  const kind = parseTabId(ids.logical)?.kind
  if (kind === 'special') return 'special'
  if (kind === undefined) return undefined
  const out: IJsonTabNode = { type: 'tab', id: ids.id, name, component: kind }
  // A room tab's own state (PLY-54), known fields only.
  const config = kind === 'room' ? parseRoomTabState(tab.config) : undefined
  if (config !== undefined) out.config = config
  return out
}

interface MappedTabs {
  readonly tabs: IJsonTabNode[]
  /** Where the stored selection is among the kept tabs; undefined if that tab was dropped. */
  readonly selected: number | undefined
  /** Whether a dropped special tab was the selected one. */
  readonly specialSelected: boolean
  /** Only special tabs were there: a tabset made for the special tab, which goes with it. */
  readonly onlySpecial: boolean
}

/** A tabset's or border's tabs; any tab groups are flattened (groups are turned off). */
function mapTabs(
  children: unknown,
  selected: unknown,
  rename: Rename,
  seen: Set<string>,
): MappedTabs {
  const flat: unknown[] = []
  for (const child of Array.isArray(children) ? (children as unknown[]) : []) {
    if (isRecord(child) && child.type === 'tabgroup' && Array.isArray(child.children)) {
      flat.push(...(child.children as unknown[]))
    } else {
      flat.push(child)
    }
  }
  const out: IJsonTabNode[] = []
  let specials = 0
  let kept: number | undefined
  let specialSelected = false
  for (const [index, t] of flat.entries()) {
    const tab = mapTab(t, rename)
    if (tab === 'special') {
      specials++
      if (index === selected) specialSelected = true
      continue
    }
    if (tab?.id === undefined || seen.has(tab.id)) continue
    seen.add(tab.id)
    if (index === selected) kept = out.length
    out.push(tab)
  }
  return {
    tabs: out,
    selected: kept,
    specialSelected,
    onlySpecial: specials > 0 && out.length === 0,
  }
}

function weight(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function selectedIndex(value: unknown, count: number, none: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count
    ? value
    : none
}

function mapRow(row: unknown, rename: Rename, seen: Set<string>, depth: number): IJsonRowNode {
  const out: IJsonRowNode = { type: 'row' }
  if (!isRecord(row) || depth > 32) return out
  const w = weight(row.weight)
  if (w !== undefined) out.weight = w
  const children: (IJsonRowNode | IJsonTabSetNode)[] = []
  for (const child of Array.isArray(row.children) ? (row.children as unknown[]) : []) {
    if (!isRecord(child)) continue
    if (child.type === 'row') {
      const inner = mapRow(child, rename, seen, depth + 1)
      // A row emptied by dropping a special tab's own tabset goes too.
      if (inner.children?.length !== 0 || !hadChildren(child)) children.push(inner)
    } else if (child.type === 'tabset') {
      const mapped = mapTabs(child.children, child.selected, rename, seen)
      // FT-1: a tabset that held only the special tab was made for it; saving it would leave an
      // empty column behind once the tab goes.
      if (mapped.onlySpecial) continue
      const { tabs } = mapped
      const tabset: IJsonTabSetNode = { type: 'tabset', children: tabs }
      const tw = weight(child.weight)
      if (tw !== undefined) tabset.weight = tw
      const selected =
        mapped.selected ?? (mapped.specialSelected ? tabs.length - 1 : child.selected)
      tabset.selected = selectedIndex(selected, tabs.length, tabs.length === 0 ? -1 : 0)
      if (child.active === true) tabset.active = true
      children.push(tabset)
    }
  }
  out.children = children
  return out
}

function hadChildren(row: Readonly<Record<string, unknown>>): boolean {
  return Array.isArray(row.children) && row.children.length > 0
}

/** Whether a row holds a tabset anywhere. */
function hasTabset(row: IJsonRowNode): boolean {
  return (row.children ?? []).some((c) => c.type === 'tabset' || (c.type === 'row' && hasTabset(c)))
}

function mapBorders(borders: unknown, rename: Rename, seen: Set<string>): IJsonBorderNode[] {
  const out: IJsonBorderNode[] = []
  const list: unknown[] = Array.isArray(borders) ? borders : []
  for (const border of list) {
    if (!isRecord(border)) continue
    const location = border.location
    if (location !== 'top' && location !== 'bottom' && location !== 'left' && location !== 'right')
      continue
    if (out.some((b) => b.location === location)) continue
    const kept = mapTabs(border.children, border.selected, rename, seen)
    const tabs = kept.tabs
    const mapped: IJsonBorderNode = {
      type: 'border',
      location,
      children: tabs,
      // An open border showing the special tab is saved closed.
      selected: selectedIndex(
        kept.selected ?? (kept.specialSelected ? -1 : border.selected),
        tabs.length,
        -1,
      ),
    }
    const size = weight(border.size)
    if (size !== undefined) mapped.size = size
    out.push(mapped)
  }
  if (!out.some((b) => b.location === PANEL_BORDER)) {
    out.push({ type: 'border', location: PANEL_BORDER, selected: -1, children: [] })
  }
  return out
}

/**
 * Rebuilds a layout from untrusted JSON, keeping only its shape: rows, tabsets, borders, weights,
 * sizes and selection, and tabs with ids we understand. Popouts and floating panels are dropped
 * (`restoreLayout` docks their room tabs back from `detached`), and the global settings are
 * ours. Tab ids go through `rename`, which returns undefined to drop a tab. Undefined if it is
 * not a layout.
 */
function rebuild(json: unknown, rename: Rename): IJsonModel | undefined {
  if (!isRecord(json) || !isRecord(json.layout)) return undefined
  const seen = new Set<string>()
  const layout = mapRow(json.layout, rename, seen, 0)
  // Dropping the special tab's own tabset can leave no tabset at all: keep one for the rooms.
  if (!hasTabset(layout)) {
    layout.children = [...(layout.children ?? []), { type: 'tabset', weight: 1, children: [] }]
  }
  const borders = mapBorders(json.borders, rename, seen)
  return { global: { ...GLOBAL }, borders, layout }
}

/**
 * PLY-5: the layout to save, with this instance's prefix stripped, as JSON text. Popouts are not
 * saved, but their room tabs are, with their own state (PLY-54), under `detached` by logical id,
 * so a room popped out comes back docked with its state after a reload.
 */
export function serialiseLayout(model: Model, ids: TabIds): string {
  const json = rebuild(model.toJson(), (id) => {
    const logical = ids.toLogical(id)
    return logical === undefined ? undefined : { logical, id: logical }
  })
  const { global: _global, ...rest } = json ?? defaultLayoutJson({ rooms: [], panels: [] }, ids)
  const detached: Record<string, RoomTabState> = {}
  for (const tab of allTabs(model)) {
    if (tab.getLayoutId() === Model.MAIN_LAYOUT_ID) continue
    const logical = ids.toLogical(tab.getId())
    if (logical === undefined || parseTabId(logical)?.kind !== 'room') continue
    // Every popped-out room, with or without state: a layout missing one would not fit (PLY-5).
    detached[logical] = parseRoomTabState(tab.getConfig()) ?? {}
  }
  return JSON.stringify(Object.keys(detached).length === 0 ? rest : { ...rest, detached })
}

/**
 * PLY-5: a saved layout, if it holds exactly the role's rooms; panels and the special tab are
 * brought in line (`syncTabs`). Rooms that were popped out come back docked at the end of the
 * first tabset, with their state. Passing the model on screen keeps matching tabs mounted.
 * Undefined when the text is not a usable layout or its rooms are not the role's rooms: the
 * caller then uses the default (a layout is never fitted to other rooms).
 */
export function restoreLayout(
  text: string,
  spec: LayoutSpec,
  ids: TabIds,
  previous?: Model,
): Model | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const json = rebuild(parsed, (id) => ({ logical: id, id: ids.toModel(id) }))
  if (json === undefined) return undefined
  dockSaved(json, isRecord(parsed) && isRecord(parsed.detached) ? parsed.detached : {}, ids)
  let model: Model
  try {
    model = Model.fromJson(json, previous)
  } catch {
    return undefined
  }
  if (!fitsRooms(model, spec, ids)) return undefined
  syncTabs(model, spec, ids)
  return model
}

/**
 * Puts the room tabs saved as popped out (`detached`, by logical id, each with its state) at the
 * end of the first tabset of a rebuilt layout, unless the layout has them already.
 */
function dockSaved(json: IJsonModel, detached: Readonly<Record<string, unknown>>, ids: TabIds) {
  const present = new Set<string>()
  const add = (tabs: readonly { readonly id?: string | undefined }[] | undefined) => {
    for (const tab of tabs ?? []) if (tab.id !== undefined) present.add(tab.id)
  }
  const visit = (row: IJsonRowNode) => {
    for (const child of row.children ?? []) {
      if (child.type === 'row') visit(child)
      else add(child.children)
    }
  }
  visit(json.layout)
  for (const border of json.borders ?? []) add(border.children)
  const tabs: IJsonTabNode[] = []
  for (const [logical, value] of Object.entries(detached)) {
    const ref = parseTabId(logical)
    const id = ids.toModel(logical)
    if (ref?.kind !== 'room' || present.has(id)) continue
    present.add(id)
    const tab: IJsonTabNode = { type: 'tab', id, name: logical, component: 'room' }
    const config = parseRoomTabState(value)
    if (config !== undefined) tab.config = config
    tabs.push(tab)
  }
  if (tabs.length === 0) return
  const first = firstTabsetJson(json.layout)
  if (first === undefined) {
    json.layout.children = [...(json.layout.children ?? []), { type: 'tabset', children: tabs }]
  } else {
    first.children = [...(first.children ?? []), ...tabs]
  }
}

/** The first tabset of a layout's row, depth first (left to right). */
function firstTabsetJson(row: IJsonRowNode): IJsonTabSetNode | undefined {
  for (const child of row.children ?? []) {
    if (child.type === 'tabset') return child
    const inner = firstTabsetJson(child)
    if (inner !== undefined) return inner
  }
  return undefined
}

// ---- A room tab's own state (PLY-54) -----------------------------------------------------

/** What the room's tab remembers; empty when it remembers nothing or there is no such tab. */
export function roomTabState(model: Model, ids: TabIds, roomId: string): RoomTabState {
  const node = model.getNodeById(ids.toModel(roomTabId(roomId)))
  if (!(node instanceof TabNode)) return NO_TAB_STATE
  // The config object is replaced on every update, so this is stable between updates.
  const config: unknown = node.getConfig()
  return isRecord(config) ? config : NO_TAB_STATE
}

const NO_TAB_STATE: RoomTabState = Object.freeze({})

/** Merges `patch` into the room tab's state; nothing happens without the tab. */
export function updateRoomTabState(
  model: Model,
  ids: TabIds,
  roomId: string,
  patch: RoomTabState,
): void {
  const node = model.getNodeById(ids.toModel(roomTabId(roomId)))
  if (!(node instanceof TabNode)) return
  const config = { ...(parseRoomTabState(node.getConfig()) ?? {}), ...patch }
  act(model, Actions.updateNodeAttributes(node.getId(), { config }))
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
