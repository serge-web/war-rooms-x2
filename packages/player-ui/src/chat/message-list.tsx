// The message list (PLY-9, PLY-43, PLY-45, NFR-11): a virtualised feed, so a room of 10,000
// messages renders only the rows in view. It sticks to the newest message while the reader is at
// the bottom, keeps the reader's place when an older page arrives above, and asks for that page
// when the reader scrolls near the top (PLY-49). Message text is React text, never HTML (PLY-14).
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Spinner } from '@wrx/ui'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { chatClock, linkify } from './format.ts'
import type { ChatRow, TimeFormat } from './format.ts'

export interface MessageListCoreProps {
  /** From `chatRows`, oldest first. */
  readonly rows: readonly ChatRow[]
  /** The list's accessible name. */
  readonly label: string
  /** Older messages exist on the server (PLY-49). */
  readonly hasOlder: boolean
  readonly loadingOlder: boolean
  /** The first history query is still running: show it is loading, not empty. */
  readonly loading?: boolean
  /** Why the last page of older messages failed; stops automatic paging until retried. */
  readonly olderError?: string | undefined
  /** Asks for the next page of older messages. */
  readonly onLoadOlder?: () => void
  readonly timeFormat?: TimeFormat | undefined
  /** The scrolling element, e.g. to watch whether the panel is on screen. */
  readonly scrollRef?: RefObject<HTMLDivElement | null>
}

/** Within this many pixels of the bottom counts as at the bottom. */
const BOTTOM_SLACK = 48
/** Within this many pixels of the top asks for older messages. */
const TOP_SLACK = 400

function estimate(row: ChatRow | undefined): number {
  if (row === undefined) return 40
  return 28 + (row.header ? 30 : 0) + (row.divider === undefined ? 0 : 40) + (row.last ? 8 : 0)
}

export function MessageListCore({
  rows,
  label,
  hasOlder,
  loadingOlder,
  loading = false,
  olderError,
  onLoadOlder,
  timeFormat,
  scrollRef,
}: MessageListCoreProps) {
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = scrollRef ?? ownRef
  const innerRef = useRef<HTMLDivElement>(null)
  const clock = useMemo(
    () => chatClock(timeFormat),
    [timeFormat?.locale, timeFormat?.timeZone], // a new object with the same values is the same
  )
  const atBottom = useRef(true)
  const previous = useRef<{ firstKey: string | undefined; count: number; fromBottom: number }>({
    firstKey: undefined,
    count: 0,
    fromBottom: 0,
  })

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => ref.current,
    estimateSize: (index) => estimate(rows[index]),
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 8,
    // Until the element is measured (and in tests without layout), assume a panel-sized view.
    initialRect: { width: 640, height: 640 },
    useFlushSync: false,
  })

  // While pinned to the newest, the bottom is followed below; the virtualiser's own correction for
  // rows measured shorter than estimated would move the view up and read as the reader leaving.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) =>
    !atBottom.current && item.start < (instance.scrollOffset ?? 0)

  const canAutoLoad = hasOlder && !loadingOlder && !loading && olderError === undefined

  // The last scroll position seen, to tell the reader scrolling up from rows growing under them.
  const lastTop = useRef(0)

  const onScroll = () => {
    const el = ref.current
    if (el === null) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
    const movedUp = el.scrollTop < lastTop.current - 1
    lastTop.current = el.scrollTop
    // Only the reader moving up leaves the bottom. Rows measured taller than estimated push the
    // bottom away without the reader doing anything; stay pinned and follow it.
    if (nearBottom) atBottom.current = true
    else if (movedUp) atBottom.current = false
    else if (atBottom.current) {
      el.scrollTop = el.scrollHeight
      lastTop.current = el.scrollTop
    }
    previous.current.fromBottom = el.scrollHeight - el.scrollTop
    if (el.scrollTop <= TOP_SLACK && canAutoLoad) onLoadOlder?.()
  }

  // After the rows change: keep the reader's place under a prepended page, or stay at the newest.
  useLayoutEffect(() => {
    const el = ref.current
    const before = previous.current
    const firstKey = rows[0]?.key
    if (el !== null) {
      const prepended =
        before.firstKey !== undefined &&
        firstKey !== before.firstKey &&
        rows.length > before.count &&
        rows.some((r) => r.key === before.firstKey)
      if (prepended && !atBottom.current) {
        el.scrollTop = virtualizer.getTotalSize() - before.fromBottom
      } else if (atBottom.current && rows.length > 0) {
        el.scrollTop = el.scrollHeight
      }
      before.fromBottom = el.scrollHeight - el.scrollTop
    }
    before.firstKey = firstKey
    before.count = rows.length
  }, [rows, virtualizer, ref])

  // Rows are measured after they render; while at the bottom, follow the content as it grows.
  useEffect(() => {
    const el = ref.current
    const inner = innerRef.current
    const view = el?.ownerDocument.defaultView
    if (el === null || inner === null || view?.ResizeObserver === undefined) return
    const observer = new view.ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
      previous.current.fromBottom = el.scrollHeight - el.scrollTop
    })
    observer.observe(inner)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [ref])

  // When the rows do not fill the view there is nothing to scroll, so fetch the next page now.
  useEffect(() => {
    const el = ref.current
    if (el === null || !canAutoLoad) return
    if (el.scrollHeight <= el.clientHeight + TOP_SLACK || el.scrollTop <= TOP_SLACK) {
      onLoadOlder?.()
    }
  }, [rows, canAutoLoad, onLoadOlder, ref])

  const items = virtualizer.getVirtualItems()
  const complete = !hasOlder && !loading

  let top: ReactNode = null
  if (olderError !== undefined) {
    top = (
      <div className="wrx-chat__older" role="alert">
        <span>Older messages could not be loaded: {olderError}</span>
        <Button size="small" onClick={onLoadOlder}>
          Try again
        </Button>
      </div>
    )
  } else if (loadingOlder || loading) {
    top = (
      <div className="wrx-chat__older">
        <Spinner label={loading ? 'Loading messages' : 'Loading older messages'} />
      </div>
    )
  } else if (complete && rows.length > 0) {
    top = <p className="wrx-chat__older wrx-chat__start">Start of the room’s history.</p>
  }

  return (
    <div
      ref={ref}
      className="wrx-chat__scroller"
      onScroll={onScroll}
      // Keyboard users scroll the history with the arrow and page keys (NFR-14).
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {top}
      {rows.length === 0 && !loading ? (
        <p className="wrx-empty wrx-chat__empty">No messages yet.</p>
      ) : null}
      <div
        ref={innerRef}
        role="feed"
        aria-busy={loadingOlder || loading}
        className="wrx-chat__feed"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((item) => {
          const row = rows[item.index]
          if (row === undefined) return null
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="wrx-chat__row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <MessageRow
                row={row}
                clock={clock}
                position={item.index + 1}
                setSize={hasOlder ? -1 : rows.length}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MessageRow({
  row,
  clock,
  position,
  setSize,
}: {
  readonly row: ChatRow
  readonly clock: ReturnType<typeof chatClock>
  readonly position: number
  readonly setSize: number
}) {
  const { message } = row
  const ms = Date.parse(message.timestamp)
  const time = Number.isNaN(ms) ? '' : clock.time(ms)
  const className = [
    'wrx-chat__message',
    row.header ? 'wrx-chat__message--first' : 'wrx-chat__message--more',
    row.last ? 'wrx-chat__message--last' : '',
    message.self ? 'wrx-chat__message--self' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const accent = message.colour === undefined ? undefined : { borderLeftColor: message.colour }
  return (
    <>
      {row.divider === undefined ? null : (
        <div className="wrx-chat__divider" role="separator" aria-label={row.divider}>
          <span aria-hidden="true">{row.divider}</span>
        </div>
      )}
      <article
        className={className}
        style={accent}
        aria-posinset={position}
        aria-setsize={setSize}
        aria-label={`${message.senderName}, ${time}`}
        data-sender={message.senderKey}
      >
        {row.header ? (
          <header className="wrx-chat__header">
            <span
              className="wrx-chat__swatch"
              aria-hidden="true"
              style={message.colour === undefined ? undefined : { background: message.colour }}
            />
            <span className="wrx-chat__sender">{message.senderName}</span>
            {message.forceName === undefined ? null : (
              <span className="wrx-chat__force">{message.forceName}</span>
            )}
            {message.self ? <span className="wrx-chat__you">(you)</span> : null}
            <time className="wrx-chat__time" dateTime={message.timestamp}>
              {time}
            </time>
          </header>
        ) : (
          <time className="wrx-chat__time wrx-chat__time--more" dateTime={message.timestamp}>
            {time}
          </time>
        )}
        {message.text === undefined ? (
          <p className="wrx-chat__text wrx-chat__text--unreadable">
            This message could not be read.
          </p>
        ) : (
          <p className="wrx-chat__text">
            <MessageText text={message.text} />
          </p>
        )}
      </article>
    </>
  )
}

/** Plain text with http(s) links (PLY-14). React escapes every part; nothing is parsed as HTML. */
function MessageText({ text }: { readonly text: string }) {
  const parts = linkify(text)
  return (
    <>
      {parts.map((part, i) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow">
            {part.text}
          </a>
        ),
      )}
    </>
  )
}
