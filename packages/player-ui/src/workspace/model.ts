// The FlexLayout adapter (ARC-9): the only code that touches the library's model. Every change
// goes through `Model.doAction` with `Actions.*`, the library's public API, and runs without a
// DOM, so the layout rules are unit-tested in Node. FlexLayout's `any` (doAction's result,
// `Action.data`) stops here: callers see typed functions only.
import {
  Actions,
  BorderNode,
  DockLocation,
  Model,
  RowNode,
  TabNode,
  TabSetNode,
} from 'flexlayout-react'
import type {
  Action,
  IGlobalAttributes,
  IJsonBorderNode,
  IJsonModel,
  IJsonRowNode,
  IJsonTabNode,
  IJsonTabSetNode,
} from 'flexlayout-react'
import { parseTabId } from './ids.ts'
import type { TabIds, TabKind } from './ids.ts'
import { defaultColumns, pickFewest, reconcilePlan } from './rules.ts'

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
}

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
  return { type: 'tab', id: ids.toModel(spec.id), name: spec.name, component: kind }
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

/** The first docked tabset with the fewest tabs (PLY-41), creating one if there is none. */
function fewestTabset(model: Model): TabSetNode | undefined {
  const tabsets = mainTabsets(model)
  return tabsets[pickFewest(tabsets.map((ts) => ts.getTabNodes().length))]
}

/** PLY-41: adds a tab to the tabset with the fewest tabs, without selecting it. */
export function addToFewest(model: Model, spec: TabSpec, ids: TabIds): void {
  const target = fewestTabset(model)
  if (target !== undefined) {
    act(model, Actions.addTab(tabJson(spec, ids), target.getId(), DockLocation.CENTER, -1, false))
    return
  }
  // No docked tabset left (everything was dragged to the strip): start a column.
  const root = model.getRootRow()
  if (root instanceof RowNode) {
    act(model, Actions.addTab(tabJson(spec, ids), root.getId(), DockLocation.CENTER, -1, false))
  }
}

/** Moves a tab, wherever it is, into the tabset with the fewest tabs. */
function moveToFewest(model: Model, tab: TabNode): void {
  const target = fewestTabset(model)
  if (target === undefined) return
  act(model, Actions.moveNode(tab.getId(), target.getId(), DockLocation.CENTER, -1, false))
}

/**
 * D6, PLY-6: makes the model hold exactly the spec's tabs, through the public API only. Lost
 * rooms close; new rooms go to the tabset with the fewest tabs (PLY-41); missing panels go back
 * to the strip; renamed rooms are relabelled. Everything else stays where the user put it.
 */
export function reconcile(model: Model, spec: LayoutSpec, ids: TabIds): void {
  const present = tabsById(model, ids)
  const wanted = [...spec.rooms, ...spec.panels]
  const plan = reconcilePlan(
    [...present.keys()],
    wanted.map((t) => t.id),
  )
  for (const id of plan.remove) act(model, Actions.deleteTab(ids.toModel(id)))
  for (const t of wanted) {
    const tab = present.get(t.id)
    if (tab !== undefined && tab.getName() !== t.name) {
      act(model, Actions.renameTab(tab.getId(), t.name))
    }
  }
  const adding = new Set(plan.add)
  for (const room of spec.rooms) if (adding.has(room.id)) addToFewest(model, room, ids)
  const border = panelBorder(model)
  for (const panel of spec.panels) {
    if (!adding.has(panel.id)) continue
    if (border === undefined) addToFewest(model, panel, ids)
    else
      act(
        model,
        Actions.addTab(tabJson(panel, ids), border.getId(), DockLocation.CENTER, -1, false),
      )
  }
}

/**
 * Docks tabs back from popouts and floating panels (layout-library.md, weakness 2): FlexLayout
 * turns a closed popout window into a floating panel; this moves its tabs into the tabset with
 * the fewest tabs instead. With a layout id, only that popout's tabs move.
 */
export function dockDetached(model: Model, layoutId?: string): void {
  for (const tab of allTabs(model)) {
    const from = tab.getLayoutId()
    if (from === Model.MAIN_LAYOUT_ID) continue
    if (layoutId !== undefined && from !== layoutId) continue
    moveToFewest(model, tab)
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

function mapTab(tab: unknown, rename: Rename): IJsonTabNode | undefined {
  if (!isRecord(tab) || tab.type !== 'tab') return undefined
  const ids = typeof tab.id === 'string' ? rename(tab.id) : undefined
  const name = tab.name
  if (ids === undefined || typeof name !== 'string') return undefined
  const kind = parseTabId(ids.logical)?.kind
  return kind === undefined ? undefined : { type: 'tab', id: ids.id, name, component: kind }
}

/** A tabset's or border's tabs; any tab groups are flattened (groups are turned off). */
function mapTabs(children: unknown, rename: Rename, seen: Set<string>): IJsonTabNode[] {
  if (!Array.isArray(children)) return []
  const out: IJsonTabNode[] = []
  for (const child of children) {
    const flat: unknown[] =
      isRecord(child) && child.type === 'tabgroup' && Array.isArray(child.children)
        ? child.children
        : [child]
    for (const t of flat) {
      const tab = mapTab(t, rename)
      if (tab?.id === undefined || seen.has(tab.id)) continue
      seen.add(tab.id)
      out.push(tab)
    }
  }
  return out
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
      children.push(mapRow(child, rename, seen, depth + 1))
    } else if (child.type === 'tabset') {
      const tabs = mapTabs(child.children, rename, seen)
      const tabset: IJsonTabSetNode = { type: 'tabset', children: tabs }
      const tw = weight(child.weight)
      if (tw !== undefined) tabset.weight = tw
      tabset.selected = selectedIndex(child.selected, tabs.length, tabs.length === 0 ? -1 : 0)
      if (child.active === true) tabset.active = true
      children.push(tabset)
    }
  }
  out.children = children
  return out
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
    const tabs = mapTabs(border.children, rename, seen)
    const mapped: IJsonBorderNode = {
      type: 'border',
      location,
      children: tabs,
      selected: selectedIndex(border.selected, tabs.length, -1),
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
 * (their tabs come back by reconciliation, docked), and the global settings are ours. Tab ids go
 * through `rename`, which returns undefined to drop a tab. Undefined if it is not a layout.
 */
function rebuild(json: unknown, rename: Rename): IJsonModel | undefined {
  if (!isRecord(json) || !isRecord(json.layout)) return undefined
  const seen = new Set<string>()
  const layout = mapRow(json.layout, rename, seen, 0)
  const borders = mapBorders(json.borders, rename, seen)
  return { global: { ...GLOBAL }, borders, layout }
}

/** PLY-5: the layout to save, with this instance's prefix stripped, as JSON text. */
export function serialiseLayout(model: Model, ids: TabIds): string {
  const json = rebuild(model.toJson(), (id) => {
    const logical = ids.toLogical(id)
    return logical === undefined ? undefined : { logical, id: logical }
  })
  const { global: _global, ...rest } = json ?? defaultLayoutJson({ rooms: [], panels: [] }, ids)
  return JSON.stringify(rest)
}

/**
 * D6, PLY-6: a saved layout, reconciled with the current tabs before anything renders. Passing
 * the model on screen keeps matching tabs mounted. Undefined when the text is not a usable
 * layout; the caller then uses the default.
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
  let model: Model
  try {
    model = Model.fromJson(json, previous)
  } catch {
    return undefined
  }
  reconcile(model, spec, ids)
  return model
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
