// The chat room panel (WP 2.6): the `chat` type's player component. ChatPanelCore lays out the
// room over plain props (NFR-18): who is online (PLY-13), the message list (PLY-9, PLY-43,
// PLY-45) and the composer (PLY-44, PLY-12, PLY-33). ChatPanel wires it to the pane's store: it
// joins the room, pages MAM history back on scroll (PLY-49), sends, and marks the room read while
// the panel is on screen (PLY-11). The workspace wraps it in the room's theme (PLY-24).
import type { Author, DomainError, RoomView, TimelineEntry } from '@wrx/domain'
import { useAuthors, useOccupants, useRoomMessages, useSessionStore } from '@wrx/hooks'
import type { PlayerPanelProps } from '@wrx/hooks'
import { Banner, Button } from '@wrx/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
// The panels file, not the workspace module's index: that loads the layout library, which the
// standalone `@wrx/player-ui/chat` entry must not.
import { onlineRoles } from '../workspace/panels.tsx'
import type { OnlineRole } from '../workspace/panels.tsx'
import { ComposerCore } from './composer.tsx'
import type { SendOutcome } from './composer.tsx'
import { chatClock, chatRows } from './format.ts'
import type { ChatMessage, TimeFormat } from './format.ts'
import { MessageListCore } from './message-list.tsx'
import { useIsOwn, useMarkRead } from './unread.tsx'

// ---- Core -------------------------------------------------------------------------------------

export interface ChatPanelCoreProps {
  readonly roomName: string
  /** Oldest first. */
  readonly messages: readonly ChatMessage[]
  /** Roles in the room now (PLY-13). */
  readonly online: readonly OnlineRole[]
  readonly hasOlder: boolean
  readonly loadingOlder: boolean
  /** The first history query is running. */
  readonly loading?: boolean
  readonly olderError?: string | undefined
  readonly onLoadOlder?: () => void
  readonly onSend: (text: string) => Promise<SendOutcome>
  /** Why this role cannot post here (PLY-12); the composer is disabled with it. */
  readonly disabledReason?: string | undefined
  /** A post refused earlier, with why (PLY-33). */
  readonly unsent?: { readonly text: string; readonly reason: string } | undefined
  /** Shown above the list when the room is unavailable, e.g. closed by the server. */
  readonly problem?:
    { readonly title: string; readonly text: string; readonly onRetry?: () => void } | undefined
  /** Read out politely: the newest message, as it arrives. */
  readonly announcement?: string
  readonly timeFormat?: TimeFormat | undefined
  readonly scrollRef?: RefObject<HTMLDivElement | null>
}

export function ChatPanelCore({
  roomName,
  messages,
  online,
  hasOlder,
  loadingOlder,
  loading = false,
  olderError,
  onLoadOlder,
  onSend,
  disabledReason,
  unsent,
  problem,
  announcement = '',
  timeFormat,
  scrollRef,
}: ChatPanelCoreProps) {
  const clock = useMemo(() => chatClock(timeFormat), [timeFormat?.locale, timeFormat?.timeZone])
  const rows = useMemo(() => chatRows(messages, clock), [messages, clock])
  return (
    <div className="wrx-chat">
      <OnlineStrip online={online} />
      {problem === undefined ? null : (
        <Banner
          tone="warning"
          title={problem.title}
          className="wrx-chat__problem"
          actions={
            problem.onRetry === undefined ? undefined : (
              <Button size="small" onClick={problem.onRetry}>
                Try again
              </Button>
            )
          }
        >
          {problem.text}
        </Banner>
      )}
      <MessageListCore
        rows={rows}
        label={`Messages in ${roomName}`}
        hasOlder={hasOlder}
        loadingOlder={loadingOlder}
        loading={loading}
        olderError={olderError}
        onLoadOlder={onLoadOlder}
        timeFormat={timeFormat}
        scrollRef={scrollRef}
      />
      <p className="wrx-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      <ComposerCore
        onSend={onSend}
        disabledReason={disabledReason}
        initialText={unsent?.text}
        initialError={unsent?.reason}
        label={`Message ${roomName}`}
      />
    </div>
  )
}

function OnlineStrip({ online }: { readonly online: readonly OnlineRole[] }) {
  return (
    <div className="wrx-chat__online">
      <span className="wrx-chat__online-label">Online ({online.length})</span>
      {online.length === 0 ? null : (
        <ul className="wrx-chat__online-list" aria-label="Online in this room">
          {online.map((role) => (
            <li key={role.id} className="wrx-chat__online-role">
              <span
                className="wrx-chat__swatch"
                aria-hidden="true"
                style={role.colour === undefined ? undefined : { background: role.colour }}
              />
              {role.name}
              {role.self ? <span className="wrx-chat__you"> (you)</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- Wording ----------------------------------------------------------------------------------

/** Why the composer is disabled (PLY-12), or `undefined` when this session may post. */
export function readOnlyExplanation(
  view: RoomView | undefined,
  access: 'write' | 'read',
): string | undefined {
  if (view?.readOnlyReason === 'observer') {
    return 'You are observing this game: you can read this room but not post in it.'
  }
  if (view?.readOnlyReason === 'read-only' || access === 'read') {
    return 'Your role can read this room but not post in it.'
  }
  if (view === undefined || view.status === 'joining') return 'Joining the room…'
  if (view.status !== 'joined') return 'You are not in this room now, so you cannot post.'
  if (!view.canPost) return 'The server has not given you a voice in this room, so you cannot post.'
  return undefined
}

/** Why a post was refused, in words for the player (PLY-33). */
export function refusalText(error: DomainError): string {
  switch (error.code) {
    case 'too-large':
      return 'the message is over the size limit.'
    case 'not-permitted':
    case 'access-withdrawn':
      return 'you can no longer post in this room.'
    case 'not-joined':
      return 'you are not in this room now.'
    case 'session-ended':
      return 'your session has ended.'
    case 'invalid':
      return 'the message is empty or not valid.'
    case 'not-found':
      return 'the room no longer exists.'
    case 'transport':
      return 'the server did not accept it. Check your connection and try again.'
  }
}

/** What to show when the room is unavailable, or `undefined` while it is fine. */
function roomProblem(
  view: RoomView | undefined,
  error: DomainError | undefined,
  onRetry: () => void,
): ChatPanelCoreProps['problem'] {
  if (view === undefined) return undefined
  switch (view.status) {
    case 'closed':
      return {
        title: 'You were removed from this room',
        text:
          view.closeReason === 'membership-removed'
            ? 'Your role no longer has access to this room.'
            : view.closeReason === 'shutdown'
              ? 'The server is shutting down.'
              : 'The server closed this room for you. The messages already shown stay here.',
        onRetry,
      }
    case 'withdrawn':
      return {
        title: 'This room is not available to your role',
        text: 'The server refused to let this session in.',
      }
    case 'error':
      return {
        title: 'Could not join this room',
        text: 'Check your connection, then try again.',
        onRetry,
      }
    case 'joining':
    case 'joined':
      return error === undefined || !view.historyLoaded
        ? undefined
        : { title: 'Some history could not be loaded', text: 'New messages still arrive.' }
  }
}

// ---- Wired ------------------------------------------------------------------------------------

const ADMIN_NAME = 'Admin'

/** The display form of the store's messages, resolved against the live role documents. */
function useChatMessages(entries: readonly TimelineEntry[] | undefined): readonly ChatMessage[] {
  const authors = useAuthors().data
  const isOwn = useIsOwn()
  return useMemo(
    () => (entries ?? []).map((entry) => toChatMessage(entry, authors, isOwn(entry))),
    [entries, authors, isOwn],
  )
}

function toChatMessage(
  entry: TimelineEntry,
  authors: ReadonlyMap<string, Author>,
  self: boolean,
): ChatMessage {
  const { sender } = entry
  const author = sender.roleId === undefined ? undefined : authors.get(sender.roleId)
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    senderKey: sender.isAdmin ? 'admin' : (sender.roleId ?? `nick:${sender.nick}`),
    senderName: sender.isAdmin ? ADMIN_NAME : (author?.name ?? sender.nick),
    forceName: author?.forceName,
    colour: author?.colour,
    self,
    // Chat is the only message type in v1; a new type makes this a type error, as it should.
    text: entry.kind === 'message' ? entry.body.content.text : undefined,
  }
}

/** Whether `ref`'s element is on screen: in a visible tab, in a visible window. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(false)
  useEffect(() => {
    const el = ref.current
    const doc = el?.ownerDocument
    const view = doc?.defaultView
    if (el === null || doc === undefined || view === null || view === undefined) return
    // Without IntersectionObserver (old browsers, tests) the panel counts as on screen.
    const supported = 'IntersectionObserver' in view
    let intersecting = !supported
    const update = () => {
      setOnScreen(intersecting && doc.visibilityState !== 'hidden')
    }
    const observer = !supported
      ? undefined
      : new view.IntersectionObserver((records) => {
          const last = records[records.length - 1]
          if (last !== undefined) intersecting = last.isIntersecting
          update()
        })
    observer?.observe(el)
    doc.addEventListener('visibilitychange', update)
    update()
    return () => {
      observer?.disconnect()
      doc.removeEventListener('visibilitychange', update)
    }
  }, [ref])
  return onScreen
}

/** The newest message, for the polite live region, once it arrives after the first load. */
function useArrivalAnnouncement(messages: readonly ChatMessage[], loaded: boolean): string {
  const [text, setText] = useState('')
  const newest = useRef<string | undefined>(undefined)
  const last = messages[messages.length - 1]
  useEffect(() => {
    if (!loaded) return
    if (newest.current !== undefined && last !== undefined && last.id !== newest.current) {
      if (!last.self) {
        const words = last.text === undefined ? 'an unreadable message' : last.text.slice(0, 200)
        setText(`${last.senderName}: ${words}`)
      }
    }
    newest.current = last?.id ?? ''
  }, [last, loaded])
  return text
}

/** The chat room panel over the pane's store. Register it with `withSlots` for `chat`. */
export function ChatPanel({ roomId, room, access }: PlayerPanelProps) {
  const store = useSessionStore()
  const snapshot = useRoomMessages(roomId)
  const view = snapshot.data
  const occupants = useOccupants(roomId).data
  const authors = useAuthors().data
  const messages = useChatMessages(view?.messages)
  const online = useMemo(() => onlineRoles(occupants, authors), [occupants, authors])
  const scrollRef = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(scrollRef)
  const loaded = view?.historyLoaded === true
  useMarkRead(roomId, view?.messages, loaded, onScreen)
  const announcement = useArrivalAnnouncement(messages, loaded)
  const [olderError, setOlderError] = useState<string | undefined>(undefined)

  const onLoadOlder = useCallback(() => {
    setOlderError(undefined)
    void store.loadOlder(roomId).then((result) => {
      if (!result.ok && result.error.code !== 'not-joined') {
        setOlderError(
          result.error.code === 'access-withdrawn'
            ? 'your role no longer has access.'
            : 'the server did not answer.',
        )
      }
    })
  }, [store, roomId])

  const onSend = useCallback(
    async (text: string): Promise<SendOutcome> => {
      const sent = await store.sendMessage(roomId, text)
      return sent.ok ? { ok: true } : { ok: false, reason: refusalText(sent.error) }
    },
    [store, roomId],
  )

  const onRetry = useCallback(() => {
    void store.rejoinRoom(roomId)
  }, [store, roomId])

  return (
    <ChatPanelCore
      roomName={room.name}
      messages={messages}
      online={online}
      hasOlder={view?.hasOlder ?? false}
      loadingOlder={view?.loadingOlder ?? false}
      loading={!loaded && view?.status !== 'error' && view?.status !== 'withdrawn'}
      olderError={olderError}
      onLoadOlder={onLoadOlder}
      onSend={onSend}
      disabledReason={readOnlyExplanation(view, access)}
      unsent={
        view?.unsent === undefined
          ? undefined
          : { text: view.unsent.text, reason: refusalText(view.unsent.error) }
      }
      problem={roomProblem(view, snapshot.error, onRetry)}
      announcement={announcement}
      scrollRef={scrollRef}
    />
  )
}
