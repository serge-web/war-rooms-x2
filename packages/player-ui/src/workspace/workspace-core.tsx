// The dockable workspace over plain props (NFR-18): FlexLayout's <Layout> with the model rules of
// `model.ts`. It holds one model per instance (D15), restores and saves it through the host's
// LayoutStorage (PLY-5), resets it to the default when the rooms change or the host says the
// design changed (PLY-5; PLY-6's in-place reconciliation is retired), docks popouts back when
// their window closes, and adds the Alt+Shift+Arrow keyboard move with focus kept on the moved
// tab (NFR-14). `Workspace` (workspace.tsx) wires it to the pane's store.
import { Layout, OverflowIcon, TabNode } from 'flexlayout-react'
import type { IIcons, ITabRenderValues, TabSetNode } from 'flexlayout-react'
import { Button } from '@wrx/ui'
import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { panelTabId, parseTabId, roomTabId, specialTabId, tabIds } from './ids.ts'
import type { TabIds } from './ids.ts'
import {
  Model,
  closedPopout,
  defaultModel,
  dockDetached,
  fitsRooms,
  moveTab,
  restoreLayout,
  roomTabState,
  serialiseLayout,
  specialTab,
  syncTabs,
  updateRoomTabState,
} from './model.ts'
import type { Action, LayoutSpec } from './model.ts'
import { WorkspaceSpecialContext } from './special.tsx'
import type { WorkspaceSpecialTab } from './special.tsx'
import type { LayoutStorage } from './storage.ts'
import { RoomTabStateContext } from './tab-state.ts'
import type { RoomTabStateStore } from './tab-state.ts'
import { TabLabel } from './tabs.tsx'
import type { RoomTabBadge } from './tabs.tsx'

export interface WorkspaceRoom {
  readonly id: string
  readonly name: string
}

/** A dockable panel that is not a room (PLY-8), e.g. game info. */
export interface WorkspacePanel {
  /** A slug, unique among the panels. */
  readonly id: string
  readonly name: string
  readonly content: ReactNode
}

export interface WorkspaceCoreProps {
  /** The rooms to show, one tab each, in display order (PLY-4). */
  readonly rooms: readonly WorkspaceRoom[]
  /** A room's panel. */
  readonly renderRoom: (roomId: string) => ReactNode
  /** Non-room panels; they start in the strip along the bottom. */
  readonly panels?: readonly WorkspacePanel[]
  /** Where layouts are saved. Without it (or a key) the layout lasts until unmount. */
  readonly storage?: LayoutStorage | undefined
  /**
   * The saved layout's key (see `layoutKey`). A new key restores that key's layout, if one is
   * saved and it fits the rooms; otherwise the layout on screen is kept, and saved under it.
   */
  readonly layoutKey?: string | undefined
  /**
   * PLY-5: when this changes after the first render (the game's design version), the layout is
   * reset to the default for the current rooms and saved under the current key, whatever is
   * saved there; `onReset` is told. Undefined means not known yet: becoming known resets
   * nothing.
   */
  readonly resetKey?: string | number | undefined
  /** Called after the layout was reset because `resetKey` changed. */
  readonly onReset?: (() => void) | undefined
  /** The unread-count slot on room tabs (PLY-11). */
  readonly tabBadge?: RoomTabBadge | undefined
  /** Shown in the docked area when it has no tabs, e.g. the no-rooms empty state. */
  readonly emptyState?: ReactNode
  /** Pop-out page next to index.html (relative, so any base path works: DOC-11). */
  readonly popoutUrl?: string
}

function specOf(
  rooms: readonly WorkspaceRoom[],
  panels: readonly WorkspacePanel[],
  special: WorkspaceSpecialTab | undefined,
): LayoutSpec {
  return {
    rooms: rooms.map((r) => ({ id: roomTabId(r.id), name: r.name })),
    panels: panels.map((p) => ({ id: panelTabId(p.id), name: p.name })),
    special:
      special === undefined ? undefined : { id: specialTabId(special.id), name: special.name },
  }
}

function initialModel(
  spec: LayoutSpec,
  ids: TabIds,
  storage: LayoutStorage | undefined,
  key: string | undefined,
  previous?: Model,
): Model | undefined {
  const saved = key === undefined ? undefined : storage?.load(key)
  return saved === undefined ? undefined : restoreLayout(saved, spec, ids, previous)
}

const EMPTY_PANELS: readonly WorkspacePanel[] = Object.freeze([])

/**
 * The hidden-tabs button as the library draws it, but with the count drawn by CSS (workspace.css)
 * instead of as text (NFR-14, WCAG 2.5.3): the button is named "Hidden tabs" and its menu lists
 * them, so a bare number as its visible text only made the name disagree with what is shown.
 */
const ICONS: IIcons = Object.freeze({
  more: (_node: unknown, hidden: readonly unknown[]) => (
    <>
      <OverflowIcon />
      <span
        className="flexlayout__tab_button_overflow_count wrx-overflow-count"
        data-count={hidden.length > 0 ? hidden.length : ''}
        aria-hidden="true"
      />
    </>
  ),
})

export function WorkspaceCore({
  rooms,
  renderRoom,
  panels = EMPTY_PANELS,
  storage,
  layoutKey,
  tabBadge,
  emptyState,
  popoutUrl = 'popout.html',
  resetKey,
  onReset,
}: WorkspaceCoreProps) {
  const instance = useId()
  const ids = useMemo(() => tabIds(instance), [instance])
  // A stable spec, new only when a tab id or name changes: `rooms` and `panels` are usually new
  // arrays on every render, so their text stands in for them.
  // FT-1: the host's special tab, if it offers one.
  const slot = useContext(WorkspaceSpecialContext)
  const special = slot?.tab
  const specText = JSON.stringify(specOf(rooms, panels, special))
  const spec = useMemo(() => specOf(rooms, panels, special), [specText])

  const [model, setModel] = useState(
    () => initialModel(spec, ids, storage, layoutKey) ?? defaultModel(spec, ids),
  )
  const [announcement, setAnnouncement] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const loadedKey = useRef(layoutKey)
  const seenReset = useRef(resetKey)
  /** A model was set by an effect in this commit: the next effect leaves it to the next one. */
  const replaced = useRef(false)
  const onResetRef = useRef(onReset)
  onResetRef.current = onReset

  // Kept current for the listeners below, which outlive a render.
  const saveRef = useRef<(m: Model) => void>(() => undefined)
  saveRef.current = (m: Model) => {
    if (layoutKey !== undefined) storage?.save(layoutKey, serialiseLayout(m, ids))
  }

  // PLY-54: each room tab's own state, in its tab node's config, for the panels to read and
  // change. One store for the workspace's life; it follows the model on screen, so a reset or
  // a restored layout reaches the panels without remounting them. Popouts render through
  // portals, so their panels find it too.
  const modelRef = useRef(model)
  modelRef.current = model
  const tabState = useMemo(() => tabStateStore(modelRef, ids), [ids])
  useLayoutEffect(() => {
    tabState.changed()
    const listener = {
      onAfterAction() {
        tabState.changed()
      },
    }
    model.addChangeListener(listener)
    return () => {
      model.removeChangeListener(listener)
    }
  }, [model, tabState])

  // PLY-5: a structural design change (a new `resetKey`) resets the layout to the default, with
  // the host's notice; it is saved under the new key, replacing whatever is there. Any other new
  // key (another role) restores that key's layout, or keeps this one.
  useLayoutEffect(() => {
    const reset = seenReset.current !== undefined && resetKey !== seenReset.current
    if (resetKey !== undefined) seenReset.current = resetKey
    if (!reset && loadedKey.current === layoutKey) return
    loadedKey.current = layoutKey
    if (reset) {
      const next = defaultModel(spec, ids, model)
      replaced.current = true
      setModel(next)
      saveRef.current(next)
      setAnnouncement('The game changed: layout reset to the default.')
      onResetRef.current?.()
      return
    }
    const next = initialModel(spec, ids, storage, layoutKey, model)
    if (next === undefined) saveRef.current(model)
    else setModel(next)
  }, [layoutKey, resetKey, storage, spec, ids, model])

  // PLY-5: a layout that no longer holds exactly the current rooms (rooms gained or lost, as a
  // publish grants and revokes access) is replaced by the default, before paint; panels, the
  // special tab and names are brought in line in place.
  useLayoutEffect(() => {
    if (replaced.current) {
      replaced.current = false
      return
    }
    if (fitsRooms(model, spec, ids)) {
      syncTabs(model, spec, ids)
      return
    }
    const next = defaultModel(spec, ids, model)
    setModel(next)
    saveRef.current(next)
    setAnnouncement('Your rooms changed: layout reset to the default.')
  }, [model, spec, ids])

  // FT-1: tell the host this workspace can show its special tab, and whether the tab is on
  // screen. FlexLayout reports a tab's visibility as it positions the tab panels.
  const claim = slot?.claim
  useLayoutEffect(() => claim?.(), [claim])
  const onShownRef = useRef(slot?.onShownChange)
  onShownRef.current = slot?.onShownChange
  useLayoutEffect(() => {
    const node = specialTab(model, spec, ids)
    if (node === undefined) return undefined
    const report = (shown: boolean) => {
      onShownRef.current?.(shown)
    }
    report(node.isVisible())
    node.setEventListener('visibility', (params: { readonly visible?: unknown }) => {
      report(params.visible === true)
    })
    return () => {
      node.removeEventListener('visibility')
      report(false)
    }
  }, [model, spec, ids])

  // Save after every change, and dock a closed popout's tabs back (CLOSE_POPOUT leaves them in
  // a floating panel). Deferred: the model is mid-action when the listener runs.
  useEffect(() => {
    const listener = {
      onAfterAction(action: Action) {
        const closed = closedPopout(action)
        if (closed !== undefined) {
          queueMicrotask(() => {
            dockDetached(model, closed)
          })
        }
        saveRef.current(model)
      },
    }
    model.addChangeListener(listener)
    return () => {
      model.removeChangeListener(listener)
    }
  }, [model])

  const reset = () => {
    // PLY-42: the default for the current rooms. Passing the old model keeps panels mounted.
    const next = defaultModel(spec, ids, model)
    setModel(next)
    saveRef.current(next)
    setAnnouncement('Layout reset.')
  }

  const factory = (node: TabNode): ReactNode => {
    const logical = ids.toLogical(node.getId())
    const ref = logical === undefined ? undefined : parseTabId(logical)
    if (ref?.kind === 'room') return renderRoom(ref.roomId)
    if (ref?.kind === 'panel') return panels.find((p) => p.id === ref.panelId)?.content ?? null
    if (ref?.kind === 'special' && ref.specialId === special?.id) return special.content
    return null
  }

  // PLY-11: tab content through the render callback, never the DOM.
  const onRenderTab = (node: TabNode, values: ITabRenderValues) => {
    const logical = ids.toLogical(node.getId())
    if (logical === undefined) return
    const own = parseTabId(logical)?.kind === 'special' ? special : undefined
    values.content = (
      <TabLabel
        tabId={logical}
        name={node.getName()}
        badge={tabBadge}
        icon={own?.icon}
        after={own?.badge}
      />
    )
  }

  const onTabSetPlaceHolder = (_node: TabSetNode): ReactNode => (
    <div className="wrx-workspace__empty">
      {emptyState ?? <p className="wrx-empty">Drag a tab here.</p>}
    </div>
  )

  // NFR-14: FlexLayout has no keyboard tab move. Alt+Shift+Left/Right on a tab moves it to the
  // neighbouring tabset (or splits it off at the edge), then puts focus back on it.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (direction === 0) return
    const button = tabButtonOf(event.target, rootRef.current)
    const tabId = button?.querySelector('[data-wrx-tab]')?.getAttribute('data-wrx-tab')
    if (button === undefined || tabId === null || tabId === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const node = model.getNodeById(ids.toModel(tabId))
    const name = node instanceof TabNode ? node.getName() : tabId
    const moved = moveTab(model, tabId, direction, ids)
    if (moved === undefined) {
      setAnnouncement(`${name} cannot move further ${direction < 0 ? 'left' : 'right'}.`)
      return
    }
    setAnnouncement(`${name} moved to column ${moved.tabset} of ${moved.tabsets}.`)
    focusTab(rootRef.current, tabId, button)
  }

  return (
    <div className="wrx-workspace">
      <div className="wrx-workspace__toolbar">
        <Button size="small" onClick={reset}>
          Reset layout
        </Button>
        <span className="wrx-workspace__hint">Alt+Shift+Arrow moves the focused tab.</span>
      </div>
      <p className="wrx-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="wrx-workspace__layout" ref={rootRef} onKeyDownCapture={onKeyDownCapture}>
        <RoomTabStateContext.Provider value={tabState}>
          <Layout
            model={model}
            factory={factory}
            onRenderTab={onRenderTab}
            onTabSetPlaceHolder={onTabSetPlaceHolder}
            popoutURL={popoutUrl}
            icons={ICONS}
          />
        </RoomTabStateContext.Provider>
      </div>
    </div>
  )
}

/** The room tabs' state over whichever model is on screen (PLY-54). */
function tabStateStore(
  modelRef: { readonly current: Model },
  ids: TabIds,
): RoomTabStateStore & { changed(): void } {
  const listeners = new Set<() => void>()
  return {
    get: (roomId) => roomTabState(modelRef.current, ids, roomId),
    update(roomId, patch) {
      updateRoomTabState(modelRef.current, ids, roomId, patch)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    changed() {
      for (const listener of listeners) listener()
    },
  }
}

/** The tab button (role=tab) an event came from, if it is inside this workspace. */
function tabButtonOf(target: EventTarget, root: HTMLElement | null): HTMLElement | undefined {
  if (root === null || !(target instanceof Element)) return undefined
  const button = target.closest('[role="tab"]')
  return button instanceof HTMLElement && root.contains(button) ? button : undefined
}

/**
 * Focuses a tab's button once the layout has re-rendered it in its new place. The library
 * re-creates the button, so wait (a few frames at most) for one that is not the old element.
 */
function focusTab(root: HTMLElement | null, tabId: string, old: HTMLElement): void {
  if (root === null) return
  const view = root.ownerDocument.defaultView
  if (view === null) return
  let frames = 0
  const attempt = () => {
    frames++
    const label = [...root.querySelectorAll('[data-wrx-tab]')].find(
      (e) => e.getAttribute('data-wrx-tab') === tabId,
    )
    const button = label?.closest('[role="tab"]')
    if (button instanceof HTMLElement && (button !== old || frames > 10)) {
      button.focus()
      return
    }
    if (frames < 30) view.requestAnimationFrame(attempt)
  }
  view.requestAnimationFrame(attempt)
}
