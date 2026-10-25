// Tab labels (PLY-11). FlexLayout's onRenderTab callback puts a <TabLabel> in each tab button; no
// code ever edits the tab's DOM. A room tab carries the host's badge component, which subscribes
// to its own data, so an unread count change re-renders one badge and never the layout. The
// label's `data-wrx-tab` attribute is how the workspace finds a tab button again (focus after a
// keyboard move) without depending on the library's DOM ids.
import type { ComponentType } from 'react'
import { parseTabId } from './ids.ts'

export interface RoomTabBadgeProps {
  readonly roomId: string
}

/**
 * The unread-count slot on a room tab (PLY-11), filled by WP 2.6. It renders inside the tab
 * button, in the main window or a popout, under the pane's SessionStoreProvider, so it may use
 * `@wrx/hooks`. Render {@link UnreadBadge} for the standard look.
 */
export type RoomTabBadge = ComponentType<RoomTabBadgeProps>

export interface UnreadBadgeProps {
  readonly count: number
}

/** The standard unread badge: nothing at zero, `99+` above 99. */
export function UnreadBadge({ count }: UnreadBadgeProps) {
  if (!(count > 0)) return null
  const shown = count > 99 ? '99+' : String(Math.floor(count))
  return (
    <span className="wrx-unread" aria-label={`${shown} unread`}>
      {shown}
    </span>
  )
}

export interface TabLabelProps {
  /** The tab's logical id. */
  readonly tabId: string
  readonly name: string
  readonly badge?: RoomTabBadge | undefined
}

export function TabLabel({ tabId, name, badge: Badge }: TabLabelProps) {
  const ref = parseTabId(tabId)
  return (
    <span className="wrx-tab" data-wrx-tab={tabId}>
      <span className="wrx-tab__name">{name}</span>
      {ref?.kind === 'room' && Badge !== undefined ? <Badge roomId={ref.roomId} /> : null}
    </span>
  )
}
