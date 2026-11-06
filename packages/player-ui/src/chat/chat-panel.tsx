// The chat room panel (WP 2.6): the `chat` type's player component. ChatPanelCore lays out the
// room over plain props (NFR-18): who is online (PLY-13), the message list (PLY-9, PLY-43,
// PLY-45) and the composer (PLY-44, PLY-12, PLY-33). ChatPanel wires it to the pane's store: it
// joins the room, pages MAM history back on scroll (PLY-49), sends, and marks the room read while
// the panel is on screen (PLY-11). The workspace wraps it in the room's theme (PLY-24). The
// composer collapses to a bar (PLY-54), remembered in the room's tab; it stays mounted while
// collapsed, so nothing typed is lost.
import { ADMIN_AUTHOR_ID, UMPIRE_NAME, participantsOf } from '@wrx/domain'
import type {
  Author,
  DomainError,
  RoomView,
  SessionStore,
  TemplateSendError,
  TimelineEntry,
} from '@wrx/domain'
import {
  useAuthors,
  useEffectiveAccess,
  useForces,
  useMe,
  useOccupants,
  usePostingPaused,
  useRetired,
  useRoles,
  useRoomMessages,
  useRoomTemplates,
  useSessionStore,
  useTemplates,
} from '@wrx/hooks'
import type { PlayerPanelProps } from '@wrx/hooks'
import type { Template } from '@wrx/schemas'
import { templatePlainText } from '@wrx/templates'
import type { FormValues } from '@wrx/templates'
import { Banner, Button } from '@wrx/ui'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
// The panels file, not the workspace module's index: that loads the layout library, which the
// standalone `@wrx/player-ui/chat` entry must not.
import { onlineRoles } from '../workspace/panels.tsx'
import type { OnlineRole } from '../workspace/panels.tsx'
import { useComposerCollapsed } from '../workspace/tab-state.ts'
import { templateCard } from '../templates/card.ts'
import { entityLabel } from '../templates/pickers.ts'
import type { PickerSource } from '../templates/pickers.ts'
import { ChatComposerCore } from './chat-composer.tsx'
import type { TemplateSendOutcome, UnsentTemplate } from './chat-composer.tsx'
import type { DraftState, SendOutcome } from './composer.tsx'
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
  /** Why this role cannot post here (PLY-12, PLY-56); the composer is disabled with it. */
  readonly disabledReason?: string | undefined
  /** Posting is paused by the phase (PLY-56): the collapsed bar says so too. */
  readonly paused?: boolean
  /** A post refused earlier, with why (PLY-33). */
  readonly unsent?: { readonly text: string; readonly reason: string } | undefined
  /** The templates this role may use here (TD4); with none, the plain composer. */
  readonly templates?: readonly Template[]
  /** Free text is allowed here (TD3). Default true. */
  readonly freeText?: boolean
  readonly onSendTemplate?: (templateId: string, values: FormValues) => Promise<TemplateSendOutcome>
  /** Live forces and roles for template pickers (TPL-8). */
  readonly pickers?: PickerSource
  /** A templated message refused earlier, with why (PLY-33). */
  readonly unsentTemplate?: UnsentTemplate | undefined
  /** Shown above the list when the room is unavailable, e.g. closed by the server. */
  readonly problem?:
    { readonly title: string; readonly text: string; readonly onRetry?: () => void } | undefined
  /** Read out politely: the newest message, as it arrives. */
  readonly announcement?: string
  readonly timeFormat?: TimeFormat | undefined
  readonly scrollRef?: RefObject<HTMLDivElement | null>
  /**
   * The role may only read this room (an observer or a read-only participant): the composer
   * starts collapsed (PLY-54).
   */
  readonly readOnly?: boolean
  /**
   * The composer is collapsed to a bar (PLY-54); undefined for the default, collapsed only when
   * `readOnly`. With `onComposerCollapsedChange` the caller keeps it; without, the panel does.
   */
  readonly composerCollapsed?: boolean | undefined
  readonly onComposerCollapsedChange?: ((collapsed: boolean) => void) | undefined
  /** The admin's, in the umpire room: "Load into draft…" on proposals (PY-8, WP 6.4). */
  readonly onLoadProposal?: ((message: ChatMessage) => void) | undefined
  /** Shown above the message list: the proposal being loaded, with its summary (ADM-46). */
  readonly aside?: ReactNode
}

/** The collapsed composer bar's note when something is waiting to be sent (PLY-54). */
export const DRAFT_NOTES: Readonly<Record<Exclude<DraftState, 'none'>, string>> = Object.freeze({
  draft: 'Draft not sent',
  unsent: 'Message not sent',
})

/** The collapsed composer bar's note while posting is paused (PLY-56). */
export const PAUSED_NOTE = 'Posting paused for adjudication'

/** Why the composer is disabled during adjudication for a role outside the White Force. */
export const PAUSED_REASON =
  'The game is in adjudication, so posting is paused for your role until the next turn’s planning starts. Anything you have written is kept.'

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
  paused = false,
  unsent,
  templates,
  freeText,
  onSendTemplate,
  pickers,
  unsentTemplate,
  problem,
  announcement = '',
  timeFormat,
  scrollRef,
  readOnly = false,
  composerCollapsed,
  onComposerCollapsedChange,
  onLoadProposal,
  aside,
}: ChatPanelCoreProps) {
  const clock = useMemo(() => chatClock(timeFormat), [timeFormat?.locale, timeFormat?.timeZone])
  const rows = useMemo(() => chatRows(messages, clock), [messages, clock])
  const [ownCollapsed, setOwnCollapsed] = useState<boolean | undefined>(undefined)
  const controlled = onComposerCollapsedChange !== undefined
  const collapsed = (controlled ? composerCollapsed : ownCollapsed) ?? readOnly
  const [draft, setDraft] = useState<DraftState>('none')
  const entryId = useId()
  const noteId = useId()
  const toggle = () => {
    if (controlled) onComposerCollapsedChange(!collapsed)
    else setOwnCollapsed(!collapsed)
  }
  const note = collapsed
    ? [draft === 'none' ? undefined : DRAFT_NOTES[draft], paused ? PAUSED_NOTE : undefined]
        .filter((n) => n !== undefined)
        .join('. ') || undefined
    : undefined
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
      {aside}
      <MessageListCore
        rows={rows}
        onLoadProposal={onLoadProposal}
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
      {/* PLY-54: a disclosure button (the WAI-ARIA pattern: focus stays on it). */}
      <div
        className={
          collapsed ? 'wrx-chat__entry-bar wrx-chat__entry-bar--collapsed' : 'wrx-chat__entry-bar'
        }
      >
        {note === undefined ? null : (
          <span id={noteId} className="wrx-chat__entry-note">
            {note}
          </span>
        )}
        <Button
          size="small"
          variant="ghost"
          className="wrx-chat__entry-toggle"
          aria-expanded={!collapsed}
          aria-controls={entryId}
          aria-describedby={note === undefined ? undefined : noteId}
          onClick={toggle}
        >
          {collapsed ? (readOnly ? 'Show message entry' : 'Write a message') : 'Hide message entry'}
        </Button>
      </div>
      {/* Hidden, not unmounted, so typed text, form values and a refused post survive. */}
      <div id={entryId} className="wrx-chat__entry" hidden={collapsed}>
        <ChatComposerCore
          onSend={onSend}
          disabledReason={disabledReason}
          initialText={unsent?.text}
          initialError={unsent?.reason}
          label={`Message ${roomName}`}
          templates={templates}
          freeText={freeText}
          onSendTemplate={onSendTemplate}
          pickers={pickers}
          unsentTemplate={unsentTemplate}
          onDraftChange={setDraft}
        />
      </div>
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
    case 'paused':
      return 'posting is paused for your role during adjudication.'
    case 'stale':
      return 'the room changed. Try again.'
  }
}

/**
 * Why a templated message was refused, for the composer: the receiver's own check says which
 * fields do not fit (TPL-6); anything else reads as a refused post does (PLY-33).
 */
export function templateRefusal(error: TemplateSendError): {
  readonly ok: false
  readonly reason: string
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>
} {
  const check = error.check
  if (check === undefined) return { ok: false, reason: refusalText(error) }
  if (check.status === 'valid') return { ok: false, reason: refusalText(error) }
  if (check.status === 'not-permitted') return { ok: false, reason: check.message }
  const fieldErrors: Record<string, string[]> = {}
  for (const e of check.errors) {
    if (e.field === undefined) continue
    ;(fieldErrors[e.field] ??= []).push(e.message)
  }
  return { ok: false, reason: check.message, fieldErrors }
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

/** The live documents pickers and cards read, and the roles in this room (`x-wrx-scope`). */
function usePickerSource(roomId: string): PickerSource {
  const forces = useForces().data
  const roles = useRoles().data
  const retired = useRetired().data
  const matrix = useEffectiveAccess().data
  return useMemo(() => {
    const inRoom = participantsOf(matrix, roomId)
    return {
      forces,
      roles,
      retired,
      roomRoleIds: matrix.roomIds.includes(roomId)
        ? new Set(inRoom.map((p) => p.roleId))
        : undefined,
    }
  }, [forces, roles, retired, matrix, roomId])
}

/**
 * The display form of the store's messages, resolved against the live documents: authors by
 * login name, and each templated message checked (TPL-6) and shown as a card or plain text.
 */
function useChatMessages(
  entries: readonly TimelineEntry[] | undefined,
  roomId: string,
  pickers: PickerSource,
): readonly ChatMessage[] {
  const store = useSessionStore()
  const authors = useAuthors().data
  const isOwn = useIsOwn()
  // The check reads the templates and the room's config; these say when to run it again.
  const templates = useTemplates().data
  const config = useRoomTemplates(roomId).data.config
  return useMemo(
    () =>
      (entries ?? []).map((entry) => toChatMessage(entry, authors, isOwn(entry), store, pickers)),
    [entries, authors, isOwn, store, pickers, templates, config],
  )
}

/** A templated message's display: a card, plain text, and a warning when it needs one. */
function templatedDisplay(
  entry: TimelineEntry,
  store: SessionStore,
  pickers: PickerSource,
): Pick<ChatMessage, 'text' | 'card' | 'warning'> {
  if (entry.kind !== 'message' || entry.body.type !== 'template') return { text: undefined }
  const body = entry.body
  const check = store.checkTemplate(entry)
  const nameOf = (kind: 'force' | 'role', id: string) => entityLabel(kind, id, pickers)
  if (check === undefined || check.status === 'invalid') {
    return {
      text: templatePlainText(body, check?.template, nameOf),
      warning:
        check === undefined
          ? 'This message could not be checked against its template.'
          : check.message,
    }
  }
  return {
    text: templatePlainText(body, check.template, nameOf),
    card: templateCard(body, check.template, pickers),
    warning: check.status === 'not-permitted' ? check.message : undefined,
  }
}

function toChatMessage(
  entry: TimelineEntry,
  authors: ReadonlyMap<string, Author>,
  self: boolean,
  store: SessionStore,
  pickers: PickerSource,
): ChatMessage {
  const { sender } = entry
  // The admin is the umpire, labelled in the White Force's colour (SC-5); identity comes from
  // the occupant JID only (§3 rule 3), so no role can post as the umpire.
  // Authors are found by login name, the occupant JID's local part (§3 rule 6); a deleted role's
  // last name comes from its `retired` record, marked deleted (§3 rule 1, ADM-14).
  const author = sender.isAdmin
    ? authors.get(ADMIN_AUTHOR_ID)
    : sender.loginName === undefined
      ? undefined
      : authors.get(sender.loginName)
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    senderKey: sender.isAdmin ? 'admin' : (sender.loginName ?? `nick:${sender.nick}`),
    senderName: sender.isAdmin ? UMPIRE_NAME : (author?.name ?? sender.nick),
    deleted: author?.deleted === true,
    forceName: author?.forceName,
    colour: author?.colour,
    self,
    // A new message type makes this a type error, as it should.
    ...(entry.kind !== 'message'
      ? { text: undefined }
      : entry.body.type === 'chat'
        ? { text: entry.body.content.text }
        : entry.body.type === 'world-proposal'
          ? {
              // PY-8: a card; the store accepted it only in the umpire room, from the umpires.
              text: `Proposed world state: ${entry.body.content.summary}`,
              proposal: {
                summary: entry.body.content.summary,
                state: entry.body.content.state,
              },
            }
          : templatedDisplay(entry, store, pickers)),
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

/** What the umpire room's panel adds to the chat panel (PY-8, WP 6.4). */
export interface ProposalActions {
  readonly onLoad: (message: ChatMessage) => void
  /** The load being confirmed, shown above the list. */
  readonly aside?: ReactNode
}

/** The chat room panel over the pane's store. Register it with `withSlots` for `chat`. */
export function ChatPanel({
  roomId,
  room,
  access,
  proposals,
}: PlayerPanelProps & { readonly proposals?: ProposalActions | undefined }) {
  const store = useSessionStore()
  const snapshot = useRoomMessages(roomId)
  const view = snapshot.data
  const occupants = useOccupants(roomId).data
  const authors = useAuthors().data
  const pickers = usePickerSource(roomId)
  const messages = useChatMessages(view?.messages, roomId, pickers)
  const offer = useRoomTemplates(roomId).data
  const online = useMemo(() => onlineRoles(occupants, authors), [occupants, authors])
  const scrollRef = useRef<HTMLDivElement>(null)
  const onScreen = useOnScreen(scrollRef)
  const loaded = view?.historyLoaded === true
  useMarkRead(roomId, view?.messages, loaded, onScreen)
  const announcement = useArrivalAnnouncement(messages, loaded)
  const [olderError, setOlderError] = useState<string | undefined>(undefined)
  // PLY-54: known from the role before the room is joined, so the default never flips.
  const observer = useMe().data.isObserver
  // PLY-56: advisory, from the turn state; the read-only reasons come first.
  const paused = usePostingPaused()
  const [composerCollapsed, setComposerCollapsed] = useComposerCollapsed(roomId)

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

  const onSendTemplate = useCallback(
    async (templateId: string, values: FormValues): Promise<TemplateSendOutcome> => {
      const clean = Object.fromEntries(
        Object.entries(values).filter(
          (e): e is [string, NonNullable<(typeof e)[1]>] => e[1] !== undefined,
        ),
      )
      const sent = await store.sendTemplateMessage(roomId, templateId, clean)
      return sent.ok ? { ok: true } : templateRefusal(sent.error)
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
      disabledReason={readOnlyExplanation(view, access) ?? (paused ? PAUSED_REASON : undefined)}
      paused={paused}
      unsent={
        view?.unsent === undefined
          ? undefined
          : { text: view.unsent.text, reason: refusalText(view.unsent.error) }
      }
      templates={offer.templates}
      freeText={offer.freeText}
      onSendTemplate={onSendTemplate}
      pickers={pickers}
      unsentTemplate={
        view?.unsentTemplate === undefined
          ? undefined
          : {
              templateId: view.unsentTemplate.templateId,
              values: view.unsentTemplate.values,
              ...templateRefusal(view.unsentTemplate.error),
            }
      }
      problem={roomProblem(view, snapshot.error, onRetry)}
      announcement={announcement}
      scrollRef={scrollRef}
      readOnly={observer || access === 'read' || view?.readOnlyReason !== undefined}
      composerCollapsed={composerCollapsed}
      onComposerCollapsedChange={setComposerCollapsed}
      onLoadProposal={proposals?.onLoad}
      aside={proposals?.aside}
    />
  )
}
