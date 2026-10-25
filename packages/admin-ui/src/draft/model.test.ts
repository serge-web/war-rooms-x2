import { createRoomTypeRegistry, chatRoomType, defaultRoomTypes } from '@wrx/domain'
import { LIMITS } from '@wrx/schemas'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { sampleDesign } from '../../../schemas/src/fixtures.ts'
import {
  addForce,
  addRoom,
  createDraft,
  deleteRoom,
  draftFromDesign,
  updateForce,
} from './draft.ts'
import { isSlug, slugify, uniqueSlug } from './slug.ts'
import {
  DRAFT_FORMAT,
  browserDraftPersistence,
  memoryDraftPersistence,
  parseStoredDraft,
  serialiseDraft,
} from './storage.ts'
import type { DraftPersistence, StorageLike } from './storage.ts'
import { createBrowserDraftStore, createDraftStore } from './store.ts'
import { formatPath, validateDraft } from './validate.ts'

describe('slugify', () => {
  it.each([
    ['Blue Force', 'blue-force'],
    ['  Red -- HQ  ', 'red-hq'],
    ['Crème brûlée', 'creme-brulee'],
    ['ÅLAND 2', 'aland-2'],
    ['--', 'x'],
    ['日本', 'x'],
  ])('%j → %j', (name, slug) => {
    expect(slugify(name, 'x')).toBe(slug)
  })

  it('fits the slug limit without a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(63)} b`, 'x')
    expect(slug).toBe('a'.repeat(63))
    expect(isSlug(slug)).toBe(true)
    expect(slugify('a'.repeat(100), 'x')).toHaveLength(LIMITS.slugChars)
  })
})

describe('uniqueSlug', () => {
  it('suffixes until free', () => {
    expect(uniqueSlug('a', new Set())).toBe('a')
    expect(uniqueSlug('a', new Set(['a', 'a-2']))).toBe('a-3')
  })

  it('shortens long bases to fit the suffix', () => {
    const base = 'b'.repeat(LIMITS.slugChars)
    const id = uniqueSlug(base, new Set([base]))
    expect(id).toBe(`${'b'.repeat(LIMITS.slugChars - 2)}-2`)
    expect(isSlug(id)).toBe(true)
  })
})

describe('validateDraft', () => {
  it('passes the sample design', () => {
    const result = validateDraft(sampleDesign(), { registry: defaultRoomTypes() })
    expect(result).toMatchObject({ issues: [], errorCount: 0, warningCount: 0, publishable: true })
  })

  it('reports schema errors by path', () => {
    let draft = draftFromDesign(sampleDesign())
    draft = updateForce(draft, 'red', { name: '  ', colour: '#12' })
    const result = validateDraft(draft.design)
    expect(result.publishable).toBe(false)
    expect(result.at('forces[1]').map((i) => i.path)).toEqual([
      'forces[1].name',
      'forces[1].colour',
    ])
    expect(result.at('forces[1].name')).toHaveLength(1)
    expect(result.at('forces[10]')).toEqual([])
    expect(result.at('forces')).toHaveLength(2)
  })

  it('includes checkDesign issues, as warnings or errors', () => {
    const design = sampleDesign()
    const result = validateDraft({
      ...design,
      forces: design.forces.map((f) => ({ ...f, isUmpire: true })),
      rooms: [
        ...design.rooms,
        {
          ...design.rooms[0]!,
          id: 'lost',
          order: 9,
          participants: [{ kind: 'role', id: 'ghost', access: 'write' }],
        },
      ],
    })
    expect(result.issues).toContainEqual({
      severity: 'warning',
      path: 'forces',
      message: '3 umpire forces; at most one is expected (ADM-4)',
    })
    expect(result.at('rooms[3]')).toEqual([
      { severity: 'error', path: 'rooms[3].participants[0]', message: 'unknown role "ghost"' },
    ])
    expect(result.warningCount).toBe(1)
    expect(result.errorCount).toBe(1)
  })

  it('reports each issue once', () => {
    const design = sampleDesign()
    const dup = { ...design.forces[0]! }
    const result = validateDraft({ ...design, forces: [...design.forces, dup] })
    expect(result.issues.filter((i) => i.path === 'forces[3].id')).toHaveLength(1)
  })

  it('checks room types and their config against the registry (ARC-5)', () => {
    const strict = createRoomTypeRegistry([
      { ...chatRoomType, configSchema: z.object({ slow: z.boolean() }) },
    ])
    let draft = draftFromDesign(sampleDesign())
    draft = addRoom(draft, 'Map', 'map').draft
    const result = validateDraft(draft.design, { registry: strict })
    expect(result.at('rooms[3]')).toEqual([
      { severity: 'error', path: 'rooms[3].roomType', message: 'room type "map" is not supported' },
    ])
    expect(result.at('rooms[0].config')).toHaveLength(1)
    // Without a registry, room types are not checked.
    expect(validateDraft(draft.design).issues).toEqual([])
  })
})

describe('formatPath', () => {
  it('formats like checkDesign', () => {
    expect(formatPath(['rooms', 2, 'participants', 0])).toBe('rooms[2].participants[0]')
    expect(formatPath(['game', 'name'])).toBe('game.name')
    expect(formatPath([])).toBe('')
    expect(formatPath([Symbol.for('s')])).toBe('Symbol(s)')
  })
})

describe('stored drafts', () => {
  it('round-trips a draft with its metadata', () => {
    let draft = draftFromDesign(sampleDesign(), { publishedRoleIds: ['blue-co'] })
    draft = deleteRoom(draft, 'red-hq')
    const text = serialiseDraft(draft)
    expect(JSON.parse(text)).toMatchObject({ format: DRAFT_FORMAT, schemaVersion: 1 })
    expect(parseStoredDraft(text)).toEqual({ ok: true, value: draft })
  })

  it('keeps drafts that would not yet publish', () => {
    const draft = updateForce(addForce(createDraft(), 'Blue').draft, 'blue', { name: '' })
    const parsed = parseStoredDraft(serialiseDraft(draft))
    expect(parsed).toEqual({ ok: true, value: draft })
  })

  it('refuses text that is not a draft', () => {
    expect(parseStoredDraft('{')).toEqual({
      ok: false,
      error: 'the saved draft is not valid JSON',
    })
    const wrong = parseStoredDraft(JSON.stringify({ format: 'other' }))
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) expect(wrong.error).toMatch(/^the saved draft is not readable/)
    // A password never comes back from storage (§3 rule 9).
    const draft = draftFromDesign(sampleDesign())
    const json: unknown = JSON.parse(serialiseDraft(draft))
    const withPassword = JSON.stringify(json).replace(
      '"name":"Blue CO"',
      '"name":"Blue CO","password":"x"',
    )
    expect(parseStoredDraft(withPassword).ok).toBe(false)
  })
})

function fakeStorage(): StorageLike & { readonly items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  }
}

describe('browserDraftPersistence', () => {
  it('reads and writes one key', () => {
    const storage = fakeStorage()
    const persistence = browserDraftPersistence('wrx:dep:admin-draft', storage)
    expect(persistence.load()).toBeUndefined()
    persistence.save('text')
    expect(storage.items.get('wrx:dep:admin-draft')).toBe('text')
    expect(persistence.load()).toBe('text')
    persistence.clear()
    expect(storage.items.size).toBe(0)
  })

  it('defaults to localStorage', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    try {
      browserDraftPersistence('k').save('v')
      expect(storage.items.get('k')).toBe('v')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createDraftStore', () => {
  it('starts from initial when nothing is saved, and saves each change', () => {
    const persistence = memoryDraftPersistence()
    const store = createDraftStore({ persistence, initial: () => createDraft({ name: 'G' }) })
    expect(store.getSnapshot()).toMatchObject({ loadError: undefined, saveError: undefined })
    expect(store.getSnapshot().draft.design.game.name).toBe('G')
    expect(persistence.load()).toBeUndefined()

    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const next = addForce(store.getSnapshot().draft, 'Blue').draft
    store.commit(next)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().draft).toBe(next)
    expect(parseStoredDraft(persistence.load() ?? '')).toEqual({ ok: true, value: next })

    // Committing the same draft is a no-op, and the snapshot keeps its identity.
    const snapshot = store.getSnapshot()
    store.commit(next)
    expect(store.getSnapshot()).toBe(snapshot)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.commit(addForce(next, 'Red').draft)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('loads a saved draft', () => {
    const draft = draftFromDesign(sampleDesign())
    const store = createDraftStore({ persistence: memoryDraftPersistence(serialiseDraft(draft)) })
    expect(store.getSnapshot().draft).toEqual(draft)
  })

  it('reports an unreadable draft and keeps it until the first change', () => {
    const persistence = memoryDraftPersistence('not json')
    const store = createDraftStore({ persistence })
    expect(store.getSnapshot().loadError).toBe('the saved draft is not valid JSON')
    expect(store.getSnapshot().draft.design.game.name).toBe('Untitled game')
    expect(persistence.load()).toBe('not json')
    store.commit(addForce(store.getSnapshot().draft, 'Blue').draft)
    expect(persistence.load()).not.toBe('not json')
  })

  it('reports storage errors without throwing', () => {
    const failing: DraftPersistence = {
      load: () => {
        throw new Error('storage is blocked')
      },
      save: () => {
        throw new Error('quota exceeded')
      },
      clear: () => {
        // A storage shim may throw a non-Error; the store still reports it.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'nope'
      },
    }
    const store = createDraftStore({ persistence: failing })
    expect(store.getSnapshot().loadError).toBe('storage is blocked')
    store.commit(addForce(store.getSnapshot().draft, 'Blue').draft)
    expect(store.getSnapshot().saveError).toBe('quota exceeded')
    store.reset()
    expect(store.getSnapshot()).toMatchObject({ loadError: undefined, saveError: 'nope' })
  })

  it('keeps a browser store under the host’s key', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    try {
      const store = createBrowserDraftStore('wrx1-mock:/demo/:admin-draft')
      store.commit(addForce(store.getSnapshot().draft, 'Blue').draft)
      expect([...storage.items.keys()]).toEqual(['wrx1-mock:/demo/:admin-draft'])
      const again = createBrowserDraftStore('wrx1-mock:/demo/:admin-draft')
      expect(again.getSnapshot().draft.design.forces.map((f) => f.id)).toEqual(['blue'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resets to a new draft or to a given one', () => {
    const persistence = memoryDraftPersistence()
    const store = createDraftStore({ persistence })
    store.commit(addForce(store.getSnapshot().draft, 'Blue').draft)
    store.reset()
    expect(persistence.load()).toBeUndefined()
    expect(store.getSnapshot().draft.design.forces).toEqual([])
    const given = draftFromDesign(sampleDesign())
    store.reset(given)
    expect(store.getSnapshot().draft).toBe(given)
    expect(persistence.load()).toBe(serialiseDraft(given))
  })
})
