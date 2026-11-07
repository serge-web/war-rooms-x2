// The account's scripts (WP 6.3): the stored form, the edits, the size limit, export and import,
// the version check, and who may run scripts (PD4, PD5, PY-6, PY-7).
import type { Result } from '@wrx/schemas'
import type { TransportError } from '@wrx/transport'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCRIPTS,
  SCRIPTS_STORAGE_KEY,
  SCRIPT_LIMITS,
  addScript,
  deleteScript,
  duplicateScript,
  exportScripts,
  importScripts,
  loadScripts,
  parseScriptFiles,
  parseStoredScripts,
  renameScript,
  saveScripts,
  scriptsSize,
  serialiseStoredScripts,
  uniqueScriptName,
  updateScript,
} from './scripts.ts'
import type { PrivateStore, StoredScripts } from './scripts.ts'
import { role as makeRole } from './fixtures.ts'
import { scriptRoleOf } from './store.ts'

const NOW = '2026-11-06T10:00:00.000Z'

function value<T>(result: Result<T, string>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function ids() {
  let n = 0
  return () => `id-${++n}`
}

/** One account's private storage, shared by the sessions made from it. */
function account() {
  const stored = new Map<string, string>()
  const session = (): PrivateStore & { writes: number } => {
    const s = {
      writes: 0,
      getPrivate: (key: string) => Promise.resolve({ ok: true as const, value: stored.get(key) }),
      setPrivate: (key: string, text: string) => {
        s.writes++
        stored.set(key, text)
        return Promise.resolve({ ok: true as const, value: undefined })
      },
    }
    return s
  }
  return { stored, session }
}

const failing = (condition: TransportError['condition']): PrivateStore => ({
  getPrivate: () => Promise.resolve({ ok: false, error: { condition } }),
  setPrivate: () => Promise.resolve({ ok: false, error: { condition } }),
})

describe('scriptRoleOf (PD4)', () => {
  const me = (over: Partial<Parameters<typeof scriptRoleOf>[0]> = {}) => ({
    identity: {
      jid: 'x/r',
      bareJid: 'x',
      domain: 'd',
      loginName: 'x',
      isAdmin: false,
      anonymous: false,
    },
    isUmpire: false,
    isObserver: false,
    role: undefined,
    ...over,
  })
  const role = makeRole('white-1', 'white')

  it('gives the admin and White Force roles that are not observers', () => {
    expect(scriptRoleOf(me({ identity: { ...me().identity, isAdmin: true } }))).toBe('admin')
    expect(scriptRoleOf(me({ isUmpire: true, role }))).toBe('white-force')
  })

  it('gives no one else: players, White Force observers, anonymous sessions', () => {
    expect(scriptRoleOf(me({ role }))).toBeUndefined()
    expect(scriptRoleOf(me({ isUmpire: true, isObserver: true, role }))).toBeUndefined()
    expect(scriptRoleOf(me({ isUmpire: true }))).toBeUndefined()
    expect(
      scriptRoleOf(me({ identity: { ...me().identity, anonymous: true }, isUmpire: true, role })),
    ).toBeUndefined()
  })
})

describe('the stored form (PY-7)', () => {
  it('reads nothing stored as the empty store, and round-trips', () => {
    expect(value(parseStoredScripts(undefined))).toEqual(EMPTY_SCRIPTS)
    expect(value(parseStoredScripts(''))).toEqual(EMPTY_SCRIPTS)
    const doc = value(addScript(EMPTY_SCRIPTS, { name: 'Moves', code: 'print(1)' }, NOW, 'a'))
    expect(value(parseStoredScripts(serialiseStoredScripts(doc)))).toEqual(doc)
    expect(doc.scripts[0]).toEqual({
      id: 'a',
      name: 'Moves',
      code: 'print(1)',
      settings: { timeLimitSeconds: 30, autoPublish: false },
      updatedAt: NOW,
    })
  })

  it('refuses text it cannot read, and a newer format, without guessing', () => {
    expect(parseStoredScripts('{').ok).toBe(false)
    expect(parseStoredScripts('{"format":"wrx-scripts"}').ok).toBe(false)
    const newer = parseStoredScripts(JSON.stringify({ format: 'wrx-scripts', version: 2 }))
    expect(newer.ok || newer.error).toMatch(/newer version/)
  })

  it('measures the value as the transports send it: escaped UTF-8', () => {
    const plain = value(addScript(EMPTY_SCRIPTS, { name: 'a', code: 'x'.repeat(1000) }, NOW, 'a'))
    const escaped = value(addScript(EMPTY_SCRIPTS, { name: 'a', code: '<'.repeat(1000) }, NOW, 'a'))
    expect(scriptsSize(escaped).bytes - scriptsSize(plain).bytes).toBe(3000)
    expect(scriptsSize(plain).limitBytes).toBe(200_000)
  })
})

describe('edits', () => {
  const two = () => {
    const id = ids()
    let doc = value(addScript(EMPTY_SCRIPTS, { name: 'One', code: 'a' }, NOW, id()))
    doc = value(addScript(doc, { name: 'Two', code: 'b' }, NOW, id()))
    return doc
  }

  it('creates with a unique default name', () => {
    let doc = value(addScript(EMPTY_SCRIPTS, {}, NOW, 'a'))
    doc = value(addScript(doc, {}, NOW, 'b'))
    expect(doc.scripts.map((s) => s.name)).toEqual(['Untitled script', 'Untitled script (2)'])
    expect(uniqueScriptName(doc.scripts, 'untitled SCRIPT')).toBe('untitled SCRIPT (3)')
  })

  it('renames, refusing an empty name, a long one and one in use', () => {
    const doc = two()
    expect(value(renameScript(doc, 'id-1', '  Uno ', NOW)).scripts[0]?.name).toBe('Uno')
    expect(renameScript(doc, 'id-1', ' ', NOW)).toEqual({
      ok: false,
      error: 'A script needs a name.',
    })
    expect(renameScript(doc, 'id-1', 'x'.repeat(121), NOW).ok).toBe(false)
    expect(renameScript(doc, 'id-1', 'two', NOW)).toEqual({
      ok: false,
      error: 'A script is already called Two.',
    })
    expect(value(renameScript(doc, 'id-1', 'ONE', NOW)).scripts[0]?.name).toBe('ONE')
  })

  it('duplicates after the original, and deletes', () => {
    const doc = value(duplicateScript(two(), 'id-1', NOW, 'copy'))
    expect(doc.scripts.map((s) => [s.id, s.name, s.code])).toEqual([
      ['id-1', 'One', 'a'],
      ['copy', 'One (copy)', 'a'],
      ['id-2', 'Two', 'b'],
    ])
    expect(value(deleteScript(doc, 'copy')).scripts).toHaveLength(2)
    expect(deleteScript(doc, 'gone').ok).toBe(false)
  })

  it('saves code and settings, checking the time limit', () => {
    const doc = two()
    const saved = value(
      updateScript(
        doc,
        'id-2',
        { code: 'c', settings: { timeLimitSeconds: 5, autoPublish: false } },
        NOW,
      ),
    )
    expect(saved.scripts[1]).toMatchObject({ code: 'c', settings: { timeLimitSeconds: 5 } })
    const over = { timeLimitSeconds: SCRIPT_LIMITS.maxSeconds + 1, autoPublish: false }
    expect(updateScript(doc, 'id-2', { settings: over }, NOW).ok).toBe(false)
    expect(updateScript(doc, 'id-2', { settings: { ...over, timeLimitSeconds: 0 } }, NOW).ok).toBe(
      false,
    )
  })

  it('keeps at most 100 scripts', () => {
    let doc: StoredScripts = EMPTY_SCRIPTS
    for (let i = 0; i < 100; i++) doc = value(addScript(doc, {}, NOW, `s${i}`))
    expect(addScript(doc, {}, NOW, 'x')).toEqual({
      ok: false,
      error: 'A login keeps at most 100 scripts.',
    })
  })
})

describe('export and import (PY-7, PR1)', () => {
  it('round-trips a bundle, as new scripts with unique names and autoPublish off', () => {
    let doc = value(addScript(EMPTY_SCRIPTS, { name: 'Moves', code: 'print("<hi>")' }, NOW, 'a'))
    doc = value(
      updateScript(doc, 'a', { settings: { timeLimitSeconds: 12, autoPublish: true } }, NOW),
    )
    const text = exportScripts(doc, NOW)
    expect(JSON.parse(text)).toMatchObject({ format: 'wrx-script-bundle', version: 1 })
    const read = value(parseScriptFiles([{ name: 'scripts.json', text }]))
    expect(read).toEqual([{ name: 'Moves', code: 'print("<hi>")', timeLimitSeconds: 12 }])
    const next = value(importScripts(doc, read, NOW, ids()))
    expect(next.scripts.map((s) => [s.id, s.name, s.settings])).toEqual([
      ['a', 'Moves', { timeLimitSeconds: 12, autoPublish: true }],
      ['id-1', 'Moves (2)', { timeLimitSeconds: 12, autoPublish: false }],
    ])
  })

  it('reads .py files by their name, with the default time limit', () => {
    const read = value(parseScriptFiles([{ name: 'Adjudicate.PY', text: 'x = 1\r\nprint(x)\r\n' }]))
    expect(read).toEqual([{ name: 'Adjudicate', code: 'x = 1\nprint(x)\n', timeLimitSeconds: 30 }])
  })

  it('refuses what is not a bundle or Python, and says which file', () => {
    expect(parseScriptFiles([{ name: 'notes.txt', text: 'hello' }])).toEqual({
      ok: false,
      error: 'notes.txt is neither a script bundle (.json) nor a Python file (.py).',
    })
    const wrong = parseScriptFiles([{ name: 'design.json', text: '{"format":"wrx-design"}' }])
    expect(wrong.ok || wrong.error).toMatch(/^design\.json is not a script bundle/)
    const extra = JSON.stringify({
      format: 'wrx-script-bundle',
      version: 1,
      scripts: [{ name: 'a', code: '', run: true }],
    })
    expect(parseScriptFiles([{ name: 'x.json', text: extra }]).ok).toBe(false)
    expect(parseScriptFiles([{ name: 'bin.py', text: 'a\u0000b' }]).ok).toBe(false)
    expect(parseScriptFiles([]).ok).toBe(false)
  })
})

describe('load and save with the version check (PD5)', () => {
  it('saves as the next revision, and another session reads it', async () => {
    const acct = account()
    const one = acct.session()
    const two = acct.session()
    const base = value(await loadScripts(one))
    const next = value(addScript(base, { name: 'A' }, NOW, 'a'))
    const saved = await saveScripts(one, next, base.revision, { now: NOW })
    expect(saved).toMatchObject({ status: 'saved', scripts: { revision: 1, updatedAt: NOW } })
    expect(value(await loadScripts(two)).scripts.map((s) => s.name)).toEqual(['A'])
    expect([...acct.stored.keys()]).toEqual([SCRIPTS_STORAGE_KEY])
  })

  it('does not write over another session’s save, unless told to', async () => {
    const acct = account()
    const one = acct.session()
    const two = acct.session()
    const start = value(await loadScripts(one))
    const theirs = value(addScript(start, { name: 'Theirs' }, NOW, 't'))
    expect((await saveScripts(two, theirs, start.revision)).status).toBe('saved')
    const mine = value(addScript(start, { name: 'Mine' }, NOW, 'm'))
    const conflict = await saveScripts(one, mine, start.revision)
    expect(conflict.status).toBe('conflict')
    expect(conflict.status === 'conflict' && conflict.current.scripts[0]?.name).toBe('Theirs')
    expect(one.writes).toBe(0)
    const forced = await saveScripts(one, mine, start.revision, { force: true })
    expect(forced).toMatchObject({ status: 'saved', scripts: { revision: 2 } })
    expect(value(await loadScripts(two)).scripts.map((s) => s.name)).toEqual(['Mine'])
  })

  it('refuses an over-size store before writing, with the sizes', async () => {
    const acct = account()
    const one = acct.session()
    const big = value(addScript(EMPTY_SCRIPTS, { name: 'Big', code: '<'.repeat(60_000) }, NOW, 'b'))
    const saved = await saveScripts(one, big, 0)
    expect(saved.status).toBe('failed')
    expect(saved.status === 'failed' && saved.error).toMatch(
      /would take 240,\d{3} bytes .* holds at most 200,000/,
    )
    expect(one.writes).toBe(0)
  })

  it('never overwrites a store it cannot read, and reports the server failing', async () => {
    const acct = account()
    acct.stored.set(SCRIPTS_STORAGE_KEY, JSON.stringify({ format: 'wrx-scripts', version: 9 }))
    const one = acct.session()
    expect((await loadScripts(one)).ok).toBe(false)
    const saved = await saveScripts(one, EMPTY_SCRIPTS, 0)
    expect(saved.status).toBe('failed')
    expect(one.writes).toBe(0)
    expect(await loadScripts(failing('service-unavailable'))).toEqual({
      ok: false,
      error: 'the server did not give this login’s scripts (service-unavailable)',
    })
    expect((await saveScripts(failing('forbidden'), EMPTY_SCRIPTS, 0)).status).toBe('failed')
  })

  it('reports the transport refusing the value as too large', async () => {
    const store: PrivateStore = {
      getPrivate: () => Promise.resolve({ ok: true, value: undefined }),
      setPrivate: () => Promise.resolve({ ok: false, error: { condition: 'too-large' } }),
    }
    const saved = await saveScripts(store, EMPTY_SCRIPTS, 0)
    expect(saved.status === 'failed' && saved.error).toMatch(/private-storage limit/)
  })
})
