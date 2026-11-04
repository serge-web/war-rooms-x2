// The admin's world-state draft in React (ADM-44, ADM-45, R25; WP 5.6): the host's storage for
// it (`WorldDraftProvider`, under the deployment's namespace, DOC-10), the game's map room, and
// `useAdminWorldDraft`, which joins the stored draft to the published state the map room holds:
// what the map shows, the change summary, and the edits. Publishing goes through the store's
// `sendWorldState` (on its own) or `advancePhase` (with a phase change), checked against the
// 500 KB map-room cap first (PLY-53).
import {
  diffWorldStates,
  emptyWorldState,
  isEmptyDiff,
  parseWorldDraft,
  serialiseWorldDraft,
  worldDraftKey,
  worldStateSize,
} from '@wrx/domain'
import type {
  DomainError,
  SessionStore,
  WorldDraft,
  WorldEditResult,
  WorldStateDiff,
  WorldStateView,
} from '@wrx/domain'
import { useRooms, useSessionStore } from '@wrx/hooks'
import { MAP_ROOM_TYPE } from '@wrx/schemas'
import type { WorldState } from '@wrx/schemas'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { DraftSnapshot, WorldDraftStorage } from './draft-storage.ts'

const WorldDraftContext = createContext<WorldDraftStorage | undefined>(undefined)

/** Gives the admin's views the world-state draft storage; without it, nothing is editable. */
export function WorldDraftProvider({
  storage,
  children,
}: {
  readonly storage: WorldDraftStorage | undefined
  readonly children?: ReactNode
}) {
  return <WorldDraftContext.Provider value={storage}>{children}</WorldDraftContext.Provider>
}

/** The host's draft storage, if it gave one. */
export function useWorldDraftStorage(): WorldDraftStorage | undefined {
  return useContext(WorldDraftContext)
}

/** The game's one map room (§3 rule 18), from the rooms this session can read. */
export function useMapRoomId(): string | undefined {
  const rooms = useRooms().data
  return rooms.find((r) => r.roomType === MAP_ROOM_TYPE)?.id
}

const NO_SNAPSHOT: DraftSnapshot = Object.freeze({ text: undefined, published: undefined })
const noSubscribe = () => () => undefined

/** What the storage holds under `key`, live; nothing when either is missing. */
export function useDraftSnapshot(
  storage: WorldDraftStorage | undefined,
  key: string | undefined,
): DraftSnapshot {
  const subscribe = useMemo(
    () =>
      storage === undefined || key === undefined
        ? noSubscribe
        : (listener: () => void) => storage.subscribe(key, listener),
    [storage, key],
  )
  return useSyncExternalStore(subscribe, () =>
    storage === undefined || key === undefined ? NO_SNAPSHOT : storage.snapshot(key),
  )
}

/** The stored draft read from its text, once per text. */
function useParsedDraft(text: string | undefined): {
  readonly draft: WorldDraft | undefined
  readonly problem: string | undefined
} {
  return useMemo(() => {
    if (text === undefined) return { draft: undefined, problem: undefined }
    const parsed = parseWorldDraft(text)
    return parsed.ok
      ? { draft: parsed.value, problem: undefined }
      : { draft: undefined, problem: parsed.error }
  }, [text])
}

export interface AdminWorldDraft {
  /** The storage key: per server and map room. */
  readonly key: string
  /** The latest published state the map room holds, if any. */
  readonly published: WorldState | undefined
  readonly publishedStanzaId: string | undefined
  /** Still looking for the published state: nothing can be edited yet. */
  readonly searching: boolean
  /** The draft this browser holds, if any. */
  readonly draft: WorldDraft | undefined
  /** The stored text the draft was read from, to clear exactly it after a publish. */
  readonly text: string | undefined
  /** A stored draft that could not be read; editing starts again from the published state. */
  readonly unreadable: string | undefined
  /** What the map shows: the draft, else the published state, else an empty state. */
  readonly working: WorldState | undefined
  /** From the published state to the draft (ADM-46). */
  readonly diff: WorldStateDiff
  /** The draft differs from the published state (ADM-45): there are unpublished edits. */
  readonly dirty: boolean
  /** A newer state was published since the draft started (another admin tab). */
  readonly stale: boolean
  /** Why the browser did not keep the last edit, if it did not. */
  readonly saveProblem: string | undefined
  /** Applies an edit to what the map shows and saves it; returns why it was refused. */
  readonly edit: (change: (state: WorldState) => WorldEditResult) => string | undefined
  /** Removes the draft (after the admin confirmed). */
  readonly discard: () => void
}

const NO_DIFF: WorldStateDiff = Object.freeze({ added: [], removed: [], changed: [] })

/**
 * The admin's draft of the world state of `roomId`, over `view`, the map room's accepted world
 * state (`useWorldState`). `turn` is the current turn, for the empty state a game starts from.
 * Undefined without draft storage, or without a room (pass none for anyone but the admin).
 */
export function useAdminWorldDraft(
  roomId: string | undefined,
  view: WorldStateView | undefined,
  turn: number | undefined,
): AdminWorldDraft | undefined {
  const storage = useWorldDraftStorage()
  const store = useSessionStore()
  const key =
    storage === undefined || roomId === undefined
      ? undefined
      : worldDraftKey(store.identity.domain, roomId)
  const snapshot = useDraftSnapshot(storage, key)
  const { draft, problem } = useParsedDraft(snapshot.text)
  const [saveProblem, setSaveProblem] = useState<string | undefined>(undefined)

  const published = view?.state
  const publishedStanzaId = view?.stanzaId
  const searching = view === undefined || (published === undefined && !view.none)
  const recent = snapshot.published
  const working =
    draft?.state ??
    (recent !== undefined && publishedStanzaId === recent.replacing ? recent.state : undefined) ??
    published ??
    (searching ? undefined : emptyWorldState(turn ?? 1))
  const diff = useMemo(
    () => (draft === undefined ? NO_DIFF : diffWorldStates(published, draft.state)),
    [draft, published],
  )

  const edit = useCallback(
    (change: (state: WorldState) => WorldEditResult): string | undefined => {
      if (storage === undefined || key === undefined) return 'drafts cannot be kept here'
      if (working === undefined) return 'the world state is still loading'
      const result = change(working)
      if (!result.ok) return result.error
      const next: WorldDraft = {
        state: result.value,
        // The draft remembers where it started: the published state, the first time.
        baseStanzaId: draft === undefined ? publishedStanzaId : draft.baseStanzaId,
        savedAt: new Date().toISOString(),
      }
      setSaveProblem(storage.save(key, serialiseWorldDraft(next)))
      return undefined
    },
    [storage, key, working, draft, publishedStanzaId],
  )
  const discard = useCallback(() => {
    if (storage === undefined || key === undefined) return
    storage.remove(key)
    setSaveProblem(undefined)
  }, [storage, key])

  if (storage === undefined || key === undefined) return undefined
  return {
    key,
    published,
    publishedStanzaId,
    searching,
    draft,
    text: snapshot.text,
    unreadable: problem,
    working,
    diff,
    dirty: draft !== undefined && !isEmptyDiff(diff),
    stale:
      draft !== undefined &&
      publishedStanzaId !== undefined &&
      draft.baseStanzaId !== publishedStanzaId,
    saveProblem,
    edit,
    discard,
  }
}

/** The draft as it would be published: its turn set to `turn` (the current or the next one). */
export function draftForTurn(draft: WorldDraft, turn: number | undefined): WorldState {
  return turn === undefined ? draft.state : { ...draft.state, turn }
}

/** Why a world state cannot be published as one message (PLY-53), in words; undefined if it can. */
export function sizeRefusal(state: WorldState): string | undefined {
  const size = worldStateSize(state)
  if (size.ok) return undefined
  return `The world state is ${size.bytes.toLocaleString('en-GB')} bytes as a message; the map room takes at most ${size.limitBytes.toLocaleString('en-GB')} (500 KB). Remove assets, or shorten their titles and labels, then publish.`
}

/**
 * The latest published world state of a map room, for export (ADM-16): joins it, waits for the
 * search to end, and leaves again. Undefined when none is published, the room cannot be read, or
 * it takes longer than `timeoutMs`.
 */
export function readPublishedWorldState(
  store: SessionStore,
  roomId: string,
  timeoutMs = 20_000,
): Promise<WorldState | undefined> {
  return new Promise((resolve) => {
    let done = false
    const unsubscribers: (() => void)[] = []
    const release = store.acquireWorldState(roomId)
    const finish = (state: WorldState | undefined) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const unsubscribe of unsubscribers) unsubscribe()
      release()
      resolve(state)
    }
    const check = () => {
      const snapshot = store.worldState(roomId)
      if (snapshot.status === 'error') {
        finish(undefined)
        return
      }
      const view = snapshot.data
      if (view?.state !== undefined) finish(view.state)
      else if (view?.none === true) finish(undefined)
    }
    const timer = setTimeout(() => {
      finish(store.worldState(roomId).data?.state)
    }, timeoutMs)
    unsubscribers.push(store.subscribe(check))
    check()
  })
}

/** Why a world-state publish failed, in words (the error's `message` is for developers). */
export function worldPublishErrorText(error: DomainError): string {
  switch (error.code) {
    case 'too-large':
      return 'the world state is over the 500 KB limit for one message.'
    case 'invalid':
      return 'the world state is not valid.'
    case 'not-joined':
      return 'the map room is not joined. Wait for it to reconnect, then try again.'
    case 'access-withdrawn':
    case 'not-permitted':
      return 'only the admin publishes the world state.'
    case 'stale':
      return 'the game moved on since this was opened. Cancel and check the turn panel.'
    case 'session-ended':
      return 'the session has ended.'
    case 'not-found':
      return 'there is no turn state yet.'
    case 'paused':
    case 'transport':
      return 'the server did not answer. Try again.'
  }
}
