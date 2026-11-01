// Tab labels (PLY-11). FlexLayout's onRenderTab callback puts a <TabLabel> in each tab button; no
// code ever edits the tab's DOM. A room tab carries the host's badge component, which subscribes
// to its own data, so an unread count change re-renders one badge and never the layout. The
// label's `data-wrx-tab` attribute is how the workspace finds a tab button again (focus after a
// keyboard move) without depending on the library's DOM ids.
import { useId, useLayoutEffect, useRef } from 'react'
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

/**
 * The standard unread badge: nothing at zero, `99+` above 99. Screen readers hear the count as
 * the tab's description, "Blue HQ, tab, 3 unread messages" (NFR-14). The library names the tab
 * button with `aria-label`, which hides its content, and has no prop for a description, so while
 * it is shown the badge points the button's `aria-describedby` at itself. That one attribute is
 * the only change to the library's DOM, and the tab's name stays the room's name.
 */
export function UnreadBadge({ count }: UnreadBadgeProps) {
  if (!(count > 0)) return null
  const shown = count > 99 ? '99+' : String(Math.floor(count))
  return <Badge text={shown} description={`${shown} unread message${shown === '1' ? '' : 's'}`} />
}

const tokens = (value: string | null, without: string): string[] =>
  (value ?? '').split(/\s+/).filter((t) => t !== '' && t !== without)

function Badge({ text, description }: { readonly text: string; readonly description: string }) {
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const tab = ref.current?.closest('[role="tab"]')
    if (tab === null || tab === undefined) return
    tab.setAttribute(
      'aria-describedby',
      [...tokens(tab.getAttribute('aria-describedby'), id), id].join(' '),
    )
    return () => {
      const rest = tokens(tab.getAttribute('aria-describedby'), id)
      if (rest.length === 0) tab.removeAttribute('aria-describedby')
      else tab.setAttribute('aria-describedby', rest.join(' '))
    }
  }, [id])
  return (
    <span ref={ref} id={id} className="wrx-unread" role="img" aria-label={description}>
      {text}
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
