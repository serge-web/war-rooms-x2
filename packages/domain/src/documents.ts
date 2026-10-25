// Which document kind each PubSub node holds, and validating its items (ARC-6, NFR-5).
import { nodeName, parseDocument, parseNodeName } from '@wrx/schemas'
import type {
  Announcement,
  Asset,
  Force,
  GameSetup,
  GameState,
  Objectives,
  ParseError,
  Result,
  Role,
  Room,
} from '@wrx/schemas'

/** The value type of each document kind the store holds. */
export interface DocumentValues {
  readonly 'game-setup': GameSetup
  readonly 'game-state': GameState
  readonly announcement: Announcement
  readonly force: Force
  readonly role: Role
  readonly room: Room
  readonly objectives: Objectives
  readonly asset: Asset
}

/** A validated document, tagged with its kind. */
export type LiveDocument = {
  readonly [K in keyof DocumentValues]: { readonly kind: K; readonly value: DocumentValues[K] }
}[keyof DocumentValues]

/** The document's value if it is of `kind`. */
export function documentValue<K extends keyof DocumentValues>(
  doc: LiveDocument | undefined,
  kind: K,
): DocumentValues[K] | undefined {
  // Validated data: `kind` and `value` were set together by `parseItem`, so a matching kind
  // means a matching value. TypeScript cannot narrow a mapped union by a generic key.
  return doc?.kind === kind ? (doc.value as DocumentValues[K]) : undefined
}

export type LiveDocumentKind = LiveDocument['kind']

/**
 * The item id used for single-document nodes. Readers accept any id and take the newest item;
 * writers in this package use this one, so republishing replaces the item.
 */
export const DOCUMENT_ITEM_ID = 'current'

export interface NodeSpec {
  readonly kind: LiveDocumentKind
  /** For per-entity nodes, the id the document must carry. */
  readonly id: string | undefined
}

/** What a node holds, or `undefined` for nodes WRX1 does not use. */
export function nodeSpec(node: string): NodeSpec | undefined {
  const ref = parseNodeName(node)
  if (ref === undefined) return undefined
  if (ref.kind === 'singleton') {
    const kind =
      ref.node === 'game-setup'
        ? 'game-setup'
        : ref.node === 'game-state'
          ? 'game-state'
          : 'announcement'
    return { kind, id: undefined }
  }
  const kinds = {
    forces: 'force',
    roles: 'role',
    rooms: 'room',
    objectives: 'objectives',
    assets: 'asset',
  } as const
  return { kind: kinds[ref.kind], id: ref.id }
}

/**
 * Validates one item's JSON for its node. Also checks that a per-entity document names its own
 * node, so `forces:blue` cannot carry the Red force.
 */
export function parseItem(spec: NodeSpec, payload: string): Result<LiveDocument> {
  const parsed = parseAs(spec.kind, payload)
  if (!parsed.ok || spec.id === undefined) return parsed
  const doc = parsed.value
  const ownId = doc.kind === 'objectives' ? doc.value.forceId : idOf(doc)
  if (ownId !== spec.id) {
    return {
      ok: false,
      error: { code: 'invalid', message: `document id "${String(ownId)}" does not match node` },
    }
  }
  return parsed
}

function idOf(doc: LiveDocument): string | undefined {
  switch (doc.kind) {
    case 'force':
    case 'role':
    case 'room':
    case 'asset':
      return doc.value.id
    default:
      return undefined
  }
}

function parseAs(kind: LiveDocumentKind, payload: string): Result<LiveDocument> {
  const fail = (error: ParseError): Result<never> => ({ ok: false, error })
  const done = (doc: LiveDocument): Result<LiveDocument> => ({ ok: true, value: doc })
  switch (kind) {
    case 'game-setup': {
      const r = parseDocument('game-setup', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'game-state': {
      const r = parseDocument('game-state', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'announcement': {
      const r = parseDocument('announcement', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'force': {
      const r = parseDocument('force', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'role': {
      const r = parseDocument('role', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'room': {
      const r = parseDocument('room', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'objectives': {
      const r = parseDocument('objectives', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
    case 'asset': {
      const r = parseDocument('asset', payload)
      return r.ok ? done({ kind, value: r.value }) : fail(r.error)
    }
  }
}

/** `nodeName` that returns `undefined` instead of throwing for an invalid id. */
export function safeNodeName(kind: keyof typeof nodeName, id: string): string | undefined {
  try {
    return nodeName[kind](id)
  } catch {
    return undefined
  }
}
