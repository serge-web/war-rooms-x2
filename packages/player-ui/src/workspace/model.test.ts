// The layout model and its rules, headless in Node (NFR-15): FlexLayout's Model and Actions run
// without a DOM, so PLY-40/41/42, D6/PLY-6 reconciliation, saving and restoring, popout dock-back
// and the keyboard move are all checked here.
import { Actions, DockLocation, Model } from 'flexlayout-react'
import { describe, expect, it } from 'vitest'
import { panelTabId, parseTabId, roomTabId, tabIds } from './ids.ts'
import {
  addToFewest,
  borderTabs,
  closedPopout,
  defaultModel,
  detachedTabs,
  dockDetached,
  mainTabsets,
  moveTab,
  reconcile,
  restoreLayout,
  serialiseLayout,
  structure,
  tabIdsIn,
} from './model.ts'
import type { LayoutSpec, TabSpec } from './model.ts'
import { defaultColumns, pickFewest, reconcilePlan } from './rules.ts'
import { layoutKey, memoryLayoutStorage, webLayoutStorage } from './storage.ts'

const ids = tabIds('ws0')

const room = (n: number): TabSpec => ({ id: roomTabId(`r${n}`), name: `Room ${n}` })
const rooms = (...ns: number[]) => ns.map(room)
const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1)
const PANELS: readonly TabSpec[] = [
  { id: panelTabId('game-info'), name: 'Game info' },
  { id: panelTabId('online'), name: 'Online' },
]
const spec = (...ns: number[]): LayoutSpec => ({ rooms: rooms(...ns), panels: PANELS })

const tabsOf = (model: Model, i = ids) => structure(model, i).map((t) => t.tabs)
const selectedOf = (model: Model) => structure(model, ids).map((t) => t.selected)
const r = (...ns: number[]) => ns.map((n) => `room:r${n}`)

function move(model: Model, logical: string, toTabset: number): void {
  const target = model.getRootRow()?.getChildren()[toTabset]
  if (target === undefined) throw new Error(`no tabset ${toTabset}`)
  model.doAction(
    Actions.moveNode(ids.toModel(logical), target.getId(), DockLocation.CENTER, -1, true),
  )
}

describe('rules', () => {
  it('PLY-40: spreads items over up to three columns, larger first, in order', () => {
    expect(defaultColumns([])).toEqual([])
    expect(defaultColumns([1])).toEqual([[1]])
    expect(defaultColumns([1, 2])).toEqual([[1], [2]])
    expect(defaultColumns([1, 2, 3])).toEqual([[1], [2], [3]])
    expect(defaultColumns([1, 2, 3, 4])).toEqual([[1, 2], [3], [4]])
    expect(defaultColumns(range(7))).toEqual([
      [1, 2, 3],
      [4, 5],
      [6, 7],
    ])
    expect(defaultColumns(range(30)).map((c) => c.length)).toEqual([10, 10, 10])
  })

  it('PLY-41: picks the first of the smallest counts', () => {
    expect(pickFewest([])).toBe(-1)
    expect(pickFewest([2, 1, 1])).toBe(1)
    expect(pickFewest([0, 0])).toBe(0)
  })

  it('PLY-6: plans removals and additions', () => {
    expect(reconcilePlan(['a', 'b', 'c'], ['c', 'd', 'a'])).toEqual({ remove: ['b'], add: ['d'] })
  })
})

describe('tab ids (D15, D22)', () => {
  it('parses logical ids and refuses anything else', () => {
    expect(parseTabId('room:blue-hq')).toEqual({ kind: 'room', roomId: 'blue-hq' })
    expect(parseTabId('panel:online')).toEqual({ kind: 'panel', panelId: 'online' })
    for (const bad of ['blue-hq', 'room:', 'room:Blue', 'other:x', 'room:a:b', '#1234']) {
      expect(parseTabId(bad)).toBeUndefined()
    }
  })

  it('prefixes per instance and ignores other instances’ nodes', () => {
    const a = tabIds(':r1:')
    const b = tabIds(':r2:')
    expect(a.toModel('room:x')).not.toBe(b.toModel('room:x'))
    expect(a.toLogical(a.toModel('room:x'))).toBe('room:x')
    expect(a.toLogical(b.toModel('room:x'))).toBeUndefined()
  })
})

describe('the default layout (PLY-40, PLY-8)', () => {
  it.each([
    [1, [r(1)]],
    [2, [r(1), r(2)]],
    [3, [r(1), r(2), r(3)]],
    [7, [r(1, 2, 3), r(4, 5), r(6, 7)]],
  ])('%i rooms make the expected columns, each showing its first room', (count, columns) => {
    const model = defaultModel(spec(...range(count)), ids)
    expect(tabsOf(model)).toEqual(columns)
    expect(selectedOf(model)).toEqual(columns.map((c) => c[0]))
    const weights = mainTabsets(model).map((ts) => ts.getWeight())
    expect(new Set(weights).size).toBe(1)
    expect(borderTabs(model, ids)).toEqual(['panel:game-info', 'panel:online'])
  })

  it('no rooms leaves one empty tabset for the empty state', () => {
    expect(tabsOf(defaultModel(spec(), ids))).toEqual([[]])
  })

  it('model ids carry the instance prefix', () => {
    const model = defaultModel(spec(1), ids)
    expect(model.getNodeById(`${ids.prefix}room:r1`)).toBeDefined()
    expect(model.getNodeById('room:r1')).toBeUndefined()
  })
})

describe('rooms added during play (PLY-41)', () => {
  it('go to the first tabset with the fewest tabs, without changing the selection', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    addToFewest(model, room(5), ids)
    expect(tabsOf(model)).toEqual([r(1, 2), r(3, 5), r(4)])
    addToFewest(model, room(6), ids)
    expect(tabsOf(model)).toEqual([r(1, 2), r(3, 5), r(4, 6)])
    addToFewest(model, room(7), ids)
    expect(tabsOf(model)).toEqual([r(1, 2, 7), r(3, 5), r(4, 6)])
    expect(selectedOf(model)).toEqual(r(1, 3, 4))
  })

  it('follow the user’s arrangement', () => {
    const model = defaultModel(spec(1, 2, 3), ids)
    move(model, 'room:r1', 2)
    expect(tabsOf(model)).toEqual([r(2), r(3, 1)])
    addToFewest(model, room(4), ids)
    expect(tabsOf(model)).toEqual([r(2, 4), r(3, 1)])
  })

  it('start a column when every tab was dragged to the strip', () => {
    const model = defaultModel(spec(1), ids)
    const border = model.getNodeById('border_bottom')
    expect(border).toBeDefined()
    model.doAction(
      Actions.moveNode(ids.toModel('room:r1'), 'border_bottom', DockLocation.CENTER, -1),
    )
    expect(tabsOf(model)).toEqual([[]])
    addToFewest(model, room(2), ids)
    expect(tabsOf(model)).toEqual([r(2)])
  })
})

describe('reconciliation (D6, PLY-6)', () => {
  it('closes lost rooms, adds new ones by PLY-41 and relabels renamed ones, keeping the rest', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    move(model, 'room:r4', 0)
    model.doAction(Actions.selectTab(ids.toModel('room:r2')))
    expect(tabsOf(model)).toEqual([r(1, 2, 4), r(3)])
    reconcile(
      model,
      {
        rooms: [{ id: 'room:r1', name: 'Renamed' }, ...rooms(2, 4, 5)],
        panels: PANELS,
      },
      ids,
    )
    // r3's tabset closed when it emptied; r5 joined the smaller one.
    expect(tabsOf(model)).toEqual([r(1, 2, 4, 5)])
    expect(selectedOf(model)).toEqual(r(2))
    expect(model.getNodeById(ids.toModel('room:r1'))?.toJson()).toMatchObject({ name: 'Renamed' })
    reconcile(model, spec(2, 4, 5, 6), ids)
    expect(tabsOf(model)).toEqual([r(2, 4, 5, 6)])
  })

  it('is a no-op when nothing changed', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    const before = JSON.stringify(model.toJson())
    reconcile(model, spec(1, 2, 3, 4), ids)
    expect(JSON.stringify(model.toJson())).toBe(before)
  })

  it('puts a missing panel back in the strip', () => {
    const model = defaultModel({ rooms: rooms(1), panels: PANELS.slice(0, 1) }, ids)
    reconcile(model, spec(1), ids)
    expect(borderTabs(model, ids)).toEqual(['panel:game-info', 'panel:online'])
  })
})

describe('saving and restoring (PLY-5, D6)', () => {
  it('saves without the instance prefix, and restores into another instance', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    move(model, 'room:r2', 2)
    move(model, 'panel:online', 0)
    const saved = serialiseLayout(model, ids)
    expect(saved).not.toContain(ids.prefix)
    expect(saved).toContain('"room:r2"')
    expect(saved).not.toContain('"global"')

    const other = tabIds('ws1')
    const restored = restoreLayout(saved, spec(1, 2, 3, 4), other)
    expect(restored).toBeDefined()
    if (restored === undefined) return
    expect(tabsOf(restored, other)).toEqual([[...r(1), 'panel:online'], r(3), r(4, 2)])
    expect(borderTabs(restored, other)).toEqual(['panel:game-info'])
    expect(restored.getNodeById(other.toModel('room:r1'))).toBeDefined()
    // A plain round trip is stable.
    expect(serialiseLayout(restored, other)).toBe(saved)
  })

  it('reconciles a saved layout with the rooms of today before it is used', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    move(model, 'room:r3', 0)
    const saved = serialiseLayout(model, ids)
    const restored = restoreLayout(saved, spec(1, 3, 4, 5), ids)
    if (restored === undefined) throw new Error('not restored')
    expect(tabsOf(restored)).toEqual([r(1, 3), r(4, 5)])
  })

  it('passing the model on screen keeps matching tabs (and their panels) in place', () => {
    const model = defaultModel(spec(1, 2), ids)
    const saved = serialiseLayout(model, ids)
    const restored = restoreLayout(saved, spec(1, 2), ids, model)
    expect(restored?.getNodeById(ids.toModel('room:r1'))).toBeDefined()
  })

  it('refuses text that is not a layout', () => {
    for (const bad of ['', 'not json', 'null', '[]', '{"layout": 3}', '{"borders": []}']) {
      expect(restoreLayout(bad, spec(1), ids)).toBeUndefined()
    }
  })

  it('keeps only the shape of untrusted JSON: known tabs, once each, our settings', () => {
    const hostile = JSON.stringify({
      global: { tabEnableClose: true, tabEnableRename: true },
      borders: [
        { type: 'border', location: 'nowhere', children: [{ type: 'tab', id: 'room:r9' }] },
        { type: 'border', location: 'bottom', selected: 7, children: [] },
      ],
      popouts: {
        w1: { layout: { type: 'row', children: [{ type: 'tabset', children: [] }] } },
      },
      layout: {
        type: 'row',
        weight: 'heavy',
        children: [
          {
            type: 'tabset',
            selected: 99,
            children: [
              { type: 'tab', id: 'room:r1', name: 'Room 1', component: 'evil', config: { x: 1 } },
              { type: 'tab', id: 'room:r1', name: 'Again' },
              { type: 'tab', id: 'Not An Id', name: 'Junk' },
              { type: 'tab', id: 'room:r2' },
              { type: 'tabgroup', children: [{ type: 'tab', id: 'room:r3', name: 'Room 3' }] },
              'text',
            ],
          },
          { type: 'mystery', children: [] },
        ],
      },
    })
    const restored = restoreLayout(hostile, spec(1, 2, 3), ids)
    if (restored === undefined) throw new Error('not restored')
    expect(tabsOf(restored)).toEqual([r(1, 3, 2)])
    expect(selectedOf(restored)).toEqual(r(1))
    const json = restored.toJson()
    expect(json.global?.tabEnableClose).toBe(false)
    expect(json.subLayouts ?? {}).toEqual({})
    const tab = restored.getNodeById(ids.toModel('room:r1'))?.toJson()
    expect(tab).toMatchObject({ component: 'room' })
    expect(tab).not.toHaveProperty('config')
  })
})

describe('popouts (layout-library.md, weakness 2)', () => {
  it('a closed popout’s tabs dock back into the tabset with the fewest tabs', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    let closed: string | undefined
    model.addChangeListener({
      onAfterAction(action) {
        closed ??= closedPopout(action)
      },
    })
    model.doAction(Actions.popoutTab(ids.toModel('room:r4')))
    expect(detachedTabs(model, ids)).toEqual(r(4))
    const layoutId = model.getNodeById(ids.toModel('room:r4'))?.getLayoutId()
    if (layoutId === undefined) throw new Error('no popout')
    model.doAction(Actions.closePopout(layoutId))
    expect(closed).toBe(layoutId)
    // FlexLayout leaves the tab in a floating panel...
    expect(detachedTabs(model, ids)).toEqual(r(4))
    // ...so the workspace docks it back.
    dockDetached(model, closed)
    expect(detachedTabs(model, ids)).toEqual([])
    // Its own tabset closed when it popped out, so it joins the smaller of the two left.
    expect(tabsOf(model)).toEqual([r(1, 2), r(3, 4)])
  })

  it('a saved layout never reopens popouts: their tabs come back docked', () => {
    const model = defaultModel(spec(1, 2, 3), ids)
    model.doAction(Actions.popoutTab(ids.toModel('room:r2')))
    const restored = restoreLayout(serialiseLayout(model, ids), spec(1, 2, 3), ids)
    if (restored === undefined) throw new Error('not restored')
    expect(detachedTabs(restored, ids)).toEqual([])
    expect(tabIdsIn(restored, ids).sort()).toEqual(
      [...r(1, 2, 3), 'panel:game-info', 'panel:online'].sort(),
    )
  })

  it('ignores other actions', () => {
    expect(closedPopout(Actions.selectTab('x'))).toBeUndefined()
  })
})

describe('keyboard moves (NFR-14)', () => {
  it('move a tab to the neighbouring tabset, and split it off at the edge', () => {
    const model = defaultModel(spec(1, 2, 3, 4), ids)
    expect(moveTab(model, 'room:r2', 1, ids)).toEqual({ tabId: 'room:r2', tabset: 2, tabsets: 3 })
    expect(tabsOf(model)).toEqual([r(1), r(3, 2), r(4)])
    expect(selectedOf(model)).toEqual(r(1, 2, 4))
    expect(moveTab(model, 'room:r2', 1, ids)).toEqual({ tabId: 'room:r2', tabset: 3, tabsets: 3 })
    expect(tabsOf(model)).toEqual([r(1), r(3), r(4, 2)])
    // At the right edge, sharing a tabset: a new column.
    expect(moveTab(model, 'room:r2', 1, ids)).toEqual({ tabId: 'room:r2', tabset: 4, tabsets: 4 })
    expect(tabsOf(model)).toEqual([r(1), r(3), r(4), r(2)])
    // Alone at the edge: nothing to do.
    expect(moveTab(model, 'room:r2', 1, ids)).toBeUndefined()
    expect(moveTab(model, 'room:r1', -1, ids)).toBeUndefined()
    expect(moveTab(model, 'room:r2', -1, ids)).toEqual({ tabId: 'room:r2', tabset: 3, tabsets: 3 })
    expect(tabsOf(model)).toEqual([r(1), r(3), r(4, 2)])
  })

  it('leave tabs in the strip, and unknown tabs, alone', () => {
    const model = defaultModel(spec(1, 2), ids)
    expect(moveTab(model, 'panel:online', 1, ids)).toBeUndefined()
    expect(moveTab(model, 'room:nope', 1, ids)).toBeUndefined()
  })
})

describe('layout storage (PLY-5, DOC-10)', () => {
  it('keys by server, role and design version', () => {
    expect(layoutKey({ server: 'wrx.mock', role: 'umpire-1', designVersion: 3 })).toBe(
      'layout:v1:wrx.mock:umpire-1:3',
    )
  })

  it('stores under the host’s key function, and swallows storage failures', () => {
    const items = new Map<string, string>()
    const store = webLayoutStorage(
      () => ({
        getItem: (k) => items.get(k) ?? null,
        setItem: (k, v) => {
          items.set(k, v)
        },
      }),
      (k) => `wrx1-mock:/demo/:${k}`,
    )
    store.save('layout:v1:a:b:1', '{}')
    expect([...items.keys()]).toEqual(['wrx1-mock:/demo/:layout:v1:a:b:1'])
    expect(store.load('layout:v1:a:b:1')).toBe('{}')
    expect(store.load('other')).toBeUndefined()

    const blocked = webLayoutStorage(() => {
      throw new Error('SecurityError')
    })
    expect(blocked.load('k')).toBeUndefined()
    expect(() => {
      blocked.save('k', 'v')
    }).not.toThrow()
  })

  it('has an in-memory store', () => {
    const store = memoryLayoutStorage([['a', '1']])
    store.save('b', '2')
    expect(store.load('a')).toBe('1')
    expect([...store.entries.keys()]).toEqual(['a', 'b'])
  })
})
