// The admin panel of the out-of-game column (PLY-37, PLY-38, ADM-29): the admin's announcements,
// oldest first with the newest at the bottom like a chat, a newly arrived one briefly
// highlighted, and, for the admin only, a text box at the bottom for posting. The server limits
// publishing to the admin (§3 rule 15); the box is only offered to the admin so others are not
// shown a control that would be refused.
import type { DomainResult } from '@wrx/domain'
import { useAnnouncements, useMe, useSessionStore } from '@wrx/hooks'
import { LIMITS } from '@wrx/schemas'
import { Button, Spinner } from '@wrx/ui'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { errorText } from './errors.ts'

export interface AnnouncementItem {
  readonly id: string
  readonly text: string
  /** ISO time the admin posted it; display only. */
  readonly postedAt: string
  /** Arrived while this client was open, rather than in the first load (PLY-38). */
  readonly live: boolean
}

export interface AnnouncementsPanelCoreProps {
  /** Oldest first (PLY-38). */
  readonly items: readonly AnnouncementItem[]
  readonly loading?: boolean
  /** Why the announcements could not be read, if they could not. */
  readonly problem?: string | undefined
  /**
   * Offered to the admin only (ADM-29). Resolves with an error message, or undefined when
   * posted, so the text box is cleared only when the post went through.
   */
  readonly onPost?: ((text: string) => Promise<string | undefined>) | undefined
  /** How long a new announcement stays highlighted (ms). Default 6000. */
  readonly highlightMs?: number
}

/** Local wall-clock time, hours and minutes. */
function timeOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function AnnouncementEntry({
  item,
  highlight,
  highlightMs,
}: {
  readonly item: AnnouncementItem
  readonly highlight: boolean
  readonly highlightMs: number
}) {
  // Highlighted from arrival until the timer runs out, or until a newer one arrives.
  const [fresh, setFresh] = useState(highlight)
  useEffect(() => {
    if (!highlight) {
      setFresh(false)
      return undefined
    }
    setFresh(true)
    const timer = setTimeout(() => {
      setFresh(false)
    }, highlightMs)
    return () => {
      clearTimeout(timer)
    }
  }, [highlight, highlightMs])
  return (
    <li
      className={['wrx-announcement', fresh ? 'wrx-announcement--new' : null]
        .filter(Boolean)
        .join(' ')}
      data-new={fresh || undefined}
    >
      <time className="wrx-announcement__time" dateTime={item.postedAt}>
        {timeOf(item.postedAt)}
      </time>
      {fresh ? <span className="wrx-visually-hidden">New: </span> : null}
      <p className="wrx-announcement__text">{item.text}</p>
    </li>
  )
}

function PostBox({ onPost }: { readonly onPost: (text: string) => Promise<string | undefined> }) {
  const id = useId()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const post = async () => {
    const trimmed = text.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    setError(undefined)
    const problem = await onPost(trimmed)
    if (!mounted.current) return
    setBusy(false)
    if (problem === undefined) setText('')
    else setError(problem)
  }
  return (
    <form
      className="wrx-announcements__post"
      onSubmit={(event) => {
        event.preventDefault()
        void post()
      }}
    >
      <label className="wrx-field__label" htmlFor={`${id}-text`}>
        New announcement
      </label>
      <textarea
        id={`${id}-text`}
        className="wrx-field__input wrx-announcements__input"
        rows={2}
        maxLength={LIMITS.announcementTextChars}
        value={text}
        aria-describedby={error === undefined ? `${id}-hint` : `${id}-hint ${id}-error`}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void post()
          }
        }}
      />
      <p id={`${id}-hint`} className="wrx-field__hint">
        Every role sees it. Enter posts; Shift+Enter starts a new line.
      </p>
      {error === undefined ? null : (
        <p id={`${id}-error`} className="wrx-field__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="small" variant="primary" busy={busy}>
        Post announcement
      </Button>
    </form>
  )
}

/** The announcements list and, for the admin, the post box (PLY-37, PLY-38, ADM-29). */
export function AnnouncementsPanelCore({
  items,
  loading = false,
  problem,
  onPost,
  highlightMs = 6000,
}: AnnouncementsPanelCoreProps) {
  const headingId = useId()
  const list = useRef<HTMLOListElement>(null)
  const last = items.at(-1)
  // Keep the newest in view, as a chat does (PLY-38).
  useLayoutEffect(() => {
    const element = list.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [last?.id])
  return (
    <section className="wrx-column__section wrx-announcements" aria-labelledby={headingId}>
      <h2 id={headingId} className="wrx-column__heading">
        Announcements
      </h2>
      {loading ? (
        <Spinner label="Loading announcements" />
      ) : problem !== undefined ? (
        <p className="wrx-empty">Announcements cannot be shown: {problem}</p>
      ) : items.length === 0 ? (
        <p className="wrx-empty">None yet. Announcements from the admin appear here.</p>
      ) : null}
      {/* Always rendered, so the live region exists before the first announcement arrives. */}
      <ol
        ref={list}
        className="wrx-announcements__list"
        role="log"
        aria-labelledby={headingId}
        aria-live="polite"
        hidden={items.length === 0}
        tabIndex={items.length === 0 ? undefined : 0}
      >
        {items.map((item) => (
          <AnnouncementEntry
            key={item.id}
            item={item}
            highlight={item.live && item.id === last?.id}
            highlightMs={highlightMs}
          />
        ))}
      </ol>
      {onPost === undefined ? null : <PostBox onPost={onPost} />}
    </section>
  )
}

/** The admin panel over the pane's store (PLY-37); needs a SessionStoreProvider. */
export function AnnouncementsPanel({ highlightMs }: { readonly highlightMs?: number }) {
  const store = useSessionStore()
  const snapshot = useAnnouncements()
  const isAdmin = useMe().data.identity.isAdmin
  const items = snapshot.data.map((entry) => ({
    id: entry.id,
    text: entry.announcement.text,
    postedAt: entry.announcement.postedAt,
    live: entry.live,
  }))
  const onPost = isAdmin
    ? async (text: string) => postResult(await store.postAnnouncement(text))
    : undefined
  return (
    <AnnouncementsPanelCore
      items={items}
      loading={snapshot.status === 'loading' && items.length === 0}
      problem={
        snapshot.status === 'error' && items.length === 0 ? errorText(snapshot.error) : undefined
      }
      onPost={onPost}
      {...(highlightMs === undefined ? {} : { highlightMs })}
    />
  )
}

function postResult(result: DomainResult<void>): string | undefined {
  return result.ok ? undefined : `Not posted: ${errorText(result.error)}`
}
