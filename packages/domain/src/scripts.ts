// The account's scripts (SRD Annex C PD4, PD5, PY-6, PY-7; WP 6.3): who may run them, the form
// they are kept in, the edits, the size limit, the export bundle and import, and the version
// check that lets every session of one role's login share them.
//
// Scripts live in the account's own XEP-0049 private storage, under one key, so they follow the
// account and not the game, and every session of a role's login sees the same ones (PD5). One
// key, not one per script: XEP-0049 cannot list keys, so a key per script would need an index
// that two sessions could each rewrite. Each write carries the revision it was based on; a write
// whose base is no longer the stored revision is not made (`saveScripts` returns `conflict`).
// The check is a read before the write, not an atomic compare-and-set, which XEP-0049 lacks:
// two writes inside that window (one round trip) still end last-writer-wins.
//
// Not in the package's index: its schemas are built when the module loads, so it is imported as
// `@wrx/domain/scripts` by the script panel's lazy chunk alone, and the start-up chunk does not
// carry it. `scriptRoleOf`, which the workspace needs at start-up, is in store.ts.
import { LIMITS, isoDateTimeSchema, newEntityId } from '@wrx/schemas'
import type { Result } from '@wrx/schemas'
import type { AdminApi } from '@wrx/transport'
import { z } from 'zod'
import { textEscapedByteLength } from './size.ts'

// ---- The stored form (PY-7) -------------------------------------------------------------------

/** The private-storage key (XEP-0049, a namespace suffix: `[a-z0-9.-]`). */
export const SCRIPTS_STORAGE_KEY = 'wrx-scripts'
export const SCRIPTS_FORMAT = 'wrx-scripts'
export const SCRIPTS_VERSION = 1

export const SCRIPT_LIMITS = Object.freeze({
  scripts: 100,
  nameChars: LIMITS.nameChars,
  /** One script's code, in characters; the whole store's cap usually binds first. */
  codeChars: 150_000,
  defaultSeconds: LIMITS.scriptRunDefaultSeconds,
  maxSeconds: LIMITS.scriptRunMaxSeconds,
  /** The stored value, as UTF-8 after XML escaping: the transports' private-storage cap. */
  storeBytes: LIMITS.privateValueBytes,
})

export const scriptSettingsSchema = z
  .object({
    /** The run's time limit (PY-10). */
    timeLimitSeconds: z.number().int().min(1).max(SCRIPT_LIMITS.maxSeconds),
    /**
     * Reserved for WP 6.4 (PD7, PY-9): publish this script's world state without review. Kept
     * as stored, never acted on yet, and off for every new or imported script (PR2).
     */
    autoPublish: z.boolean(),
  })
  .strict()
export type ScriptSettings = z.infer<typeof scriptSettingsSchema>

const nameSchema = z.string().trim().min(1).max(SCRIPT_LIMITS.nameChars)

export const storedScriptSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: nameSchema,
    code: z.string().max(SCRIPT_LIMITS.codeChars),
    settings: scriptSettingsSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
export type StoredScript = z.infer<typeof storedScriptSchema>

export const storedScriptsSchema = z
  .object({
    format: z.literal(SCRIPTS_FORMAT),
    version: z.literal(SCRIPTS_VERSION),
    /** Bumped by every write: the version check's token. 0 before the first write. */
    revision: z.number().int().min(0),
    updatedAt: isoDateTimeSchema.optional(),
    scripts: z.array(storedScriptSchema).max(SCRIPT_LIMITS.scripts),
  })
  .strict()
export type StoredScripts = z.infer<typeof storedScriptsSchema>

export const DEFAULT_SCRIPT_SETTINGS: ScriptSettings = Object.freeze({
  timeLimitSeconds: SCRIPT_LIMITS.defaultSeconds,
  autoPublish: false,
})

/** An account that has never saved a script. */
export const EMPTY_SCRIPTS: StoredScripts = Object.freeze({
  format: SCRIPTS_FORMAT,
  version: SCRIPTS_VERSION,
  revision: 0,
  scripts: [],
})

/** Reads the stored text; nothing stored is the empty store. */
export function parseStoredScripts(text: string | undefined): Result<StoredScripts, string> {
  if (text === undefined || text === '') return { ok: true, value: EMPTY_SCRIPTS }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the stored scripts are not JSON' }
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    typeof data.version === 'number' &&
    data.version > SCRIPTS_VERSION
  ) {
    return {
      ok: false,
      error: `the scripts were saved by a newer version of the client (format ${data.version})`,
    }
  }
  const parsed = storedScriptsSchema.safeParse(data)
  if (!parsed.success) {
    return {
      ok: false,
      error: `the stored scripts are not valid: ${z.prettifyError(parsed.error)}`,
    }
  }
  return { ok: true, value: parsed.data }
}

export function serialiseStoredScripts(scripts: StoredScripts): string {
  return JSON.stringify(scripts)
}

/** The stored value's size against the private-storage cap. */
export function scriptsSize(scripts: StoredScripts): {
  readonly ok: boolean
  readonly bytes: number
  readonly limitBytes: number
} {
  const bytes = textEscapedByteLength(serialiseStoredScripts(scripts))
  return { ok: bytes <= SCRIPT_LIMITS.storeBytes, bytes, limitBytes: SCRIPT_LIMITS.storeBytes }
}

/** Why the scripts cannot be saved for their size, in words; undefined if they can. */
export function scriptsSizeRefusal(scripts: StoredScripts): string | undefined {
  const size = scriptsSize(scripts)
  if (size.ok) return undefined
  return `The scripts would take ${size.bytes.toLocaleString('en-GB')} bytes of this login’s private storage, which holds at most ${size.limitBytes.toLocaleString('en-GB')}. Shorten or delete a script (export it first to keep a copy), then save again.`
}

// ---- Edits ---------------------------------------------------------------------------------------

export type ScriptsEdit = Result<StoredScripts, string>

/** `base`, or `base (2)`, `base (3)`… : the first name no script has (case-insensitive). */
export function uniqueScriptName(scripts: readonly StoredScript[], base: string): string {
  const taken = new Set(scripts.map((s) => s.name.toLowerCase()))
  const trimmed = base.trim().slice(0, SCRIPT_LIMITS.nameChars - 5) || 'Script'
  if (!taken.has(trimmed.toLowerCase())) return trimmed
  for (let n = 2; ; n++) {
    const name = `${trimmed} (${n})`
    if (!taken.has(name.toLowerCase())) return name
  }
}

function checkName(
  scripts: readonly StoredScript[],
  name: string,
  except?: string,
): Result<string, string> {
  const parsed = nameSchema.safeParse(name)
  if (!parsed.success) {
    return {
      ok: false,
      error:
        name.trim() === ''
          ? 'A script needs a name.'
          : `A name has at most ${SCRIPT_LIMITS.nameChars} characters.`,
    }
  }
  const clash = scripts.find(
    (s) => s.id !== except && s.name.toLowerCase() === parsed.data.toLowerCase(),
  )
  if (clash !== undefined) return { ok: false, error: `A script is already called ${clash.name}.` }
  return { ok: true, value: parsed.data }
}

function withScripts(doc: StoredScripts, scripts: StoredScript[]): ScriptsEdit {
  if (scripts.length > SCRIPT_LIMITS.scripts) {
    return { ok: false, error: `A login keeps at most ${SCRIPT_LIMITS.scripts} scripts.` }
  }
  return { ok: true, value: { ...doc, scripts } }
}

export interface NewScript {
  readonly name?: string
  readonly code?: string
  readonly settings?: ScriptSettings
}

/** Adds a script at the end; a missing name becomes "Untitled script" (made unique). */
export function addScript(
  doc: StoredScripts,
  script: NewScript,
  now: string,
  id: string = newEntityId(),
): ScriptsEdit {
  const named: Result<string, string> =
    script.name === undefined
      ? { ok: true, value: uniqueScriptName(doc.scripts, 'Untitled script') }
      : checkName(doc.scripts, script.name)
  if (!named.ok) return named
  if ((script.code ?? '').length > SCRIPT_LIMITS.codeChars) {
    return { ok: false, error: `A script has at most ${SCRIPT_LIMITS.codeChars} characters.` }
  }
  return withScripts(doc, [
    ...doc.scripts,
    {
      id,
      name: named.value,
      code: script.code ?? '',
      settings: script.settings ?? DEFAULT_SCRIPT_SETTINGS,
      updatedAt: now,
    },
  ])
}

function findScript(doc: StoredScripts, id: string): Result<StoredScript, string> {
  const script = doc.scripts.find((s) => s.id === id)
  return script === undefined
    ? { ok: false, error: 'That script is no longer here: another session may have deleted it.' }
    : { ok: true, value: script }
}

function replaceScript(doc: StoredScripts, next: StoredScript): ScriptsEdit {
  return withScripts(
    doc,
    doc.scripts.map((s) => (s.id === next.id ? next : s)),
  )
}

export function renameScript(
  doc: StoredScripts,
  id: string,
  name: string,
  now: string,
): ScriptsEdit {
  const found = findScript(doc, id)
  if (!found.ok) return found
  const checked = checkName(doc.scripts, name, id)
  if (!checked.ok) return checked
  return replaceScript(doc, { ...found.value, name: checked.value, updatedAt: now })
}

/** A copy after the original, named "<name> (copy)" (made unique). */
export function duplicateScript(
  doc: StoredScripts,
  id: string,
  now: string,
  newId: string = newEntityId(),
): ScriptsEdit {
  const found = findScript(doc, id)
  if (!found.ok) return found
  const copy: StoredScript = {
    ...found.value,
    id: newId,
    name: uniqueScriptName(doc.scripts, `${found.value.name} (copy)`),
    updatedAt: now,
  }
  const at = doc.scripts.indexOf(found.value) + 1
  return withScripts(doc, [...doc.scripts.slice(0, at), copy, ...doc.scripts.slice(at)])
}

export function deleteScript(doc: StoredScripts, id: string): ScriptsEdit {
  const found = findScript(doc, id)
  if (!found.ok) return found
  return withScripts(
    doc,
    doc.scripts.filter((s) => s.id !== id),
  )
}

/** Saves a script's code and settings. */
export function updateScript(
  doc: StoredScripts,
  id: string,
  change: { readonly code?: string; readonly settings?: ScriptSettings },
  now: string,
): ScriptsEdit {
  const found = findScript(doc, id)
  if (!found.ok) return found
  const code = change.code ?? found.value.code
  if (code.length > SCRIPT_LIMITS.codeChars) {
    return { ok: false, error: `A script has at most ${SCRIPT_LIMITS.codeChars} characters.` }
  }
  const settings = scriptSettingsSchema.safeParse(change.settings ?? found.value.settings)
  if (!settings.success) {
    return {
      ok: false,
      error: `The time limit is a whole number of seconds from 1 to ${SCRIPT_LIMITS.maxSeconds}.`,
    }
  }
  return replaceScript(doc, { ...found.value, code, settings: settings.data, updatedAt: now })
}

// ---- Export and import (PY-7, PR1) ------------------------------------------------------------

export const SCRIPT_BUNDLE_FORMAT = 'wrx-script-bundle'
export const SCRIPT_BUNDLE_VERSION = 1

const bundleScriptSchema = z
  .object({
    name: nameSchema,
    code: z.string().max(SCRIPT_LIMITS.codeChars),
    settings: scriptSettingsSchema.partial().strict().optional(),
  })
  .strict()

/** The export file: every script's name, code and settings, without ids or times. */
export const scriptBundleSchema = z
  .object({
    format: z.literal(SCRIPT_BUNDLE_FORMAT),
    version: z.literal(SCRIPT_BUNDLE_VERSION),
    exportedAt: isoDateTimeSchema.optional(),
    scripts: z.array(bundleScriptSchema).max(SCRIPT_LIMITS.scripts),
  })
  .strict()
export type ScriptBundle = z.infer<typeof scriptBundleSchema>

/** The export file's text (pretty, so it diffs and reads well). */
export function exportScripts(doc: StoredScripts, now: string): string {
  const bundle: ScriptBundle = {
    format: SCRIPT_BUNDLE_FORMAT,
    version: SCRIPT_BUNDLE_VERSION,
    exportedAt: now,
    scripts: doc.scripts.map((s) => ({ name: s.name, code: s.code, settings: s.settings })),
  }
  return `${JSON.stringify(bundle, null, 2)}\n`
}

/** A script read from a file, not yet stored. */
export interface ImportedScript {
  readonly name: string
  readonly code: string
  readonly timeLimitSeconds: number
}

/** The largest file import reads, in characters: the store could not hold more. */
export const SCRIPT_IMPORT_MAX_CHARS = 1_000_000

/**
 * Reads files to import (PY-7): a script bundle (`.json`) or Python files (`.py`, named after
 * the file). Validates everything and runs nothing (PR1). A `.py` file is taken as it is: its
 * code is not parsed, only checked to be text of a bounded size.
 */
export function parseScriptFiles(
  files: readonly { readonly name: string; readonly text: string }[],
): Result<readonly ImportedScript[], string> {
  const out: ImportedScript[] = []
  for (const file of files) {
    if (file.text.length > SCRIPT_IMPORT_MAX_CHARS) {
      return { ok: false, error: `${file.name} is too large to import.` }
    }
    if (/\.py$/i.test(file.name)) {
      if (file.text.length > SCRIPT_LIMITS.codeChars) {
        return {
          ok: false,
          error: `${file.name} is over ${SCRIPT_LIMITS.codeChars.toLocaleString('en-GB')} characters.`,
        }
      }
      if (file.text.includes('\u0000')) {
        return { ok: false, error: `${file.name} is not a text file.` }
      }
      const base = file.name.replace(/\.py$/i, '').trim() || 'Imported script'
      out.push({
        name: base.slice(0, SCRIPT_LIMITS.nameChars),
        code: file.text.replace(/\r\n?/g, '\n'),
        timeLimitSeconds: SCRIPT_LIMITS.defaultSeconds,
      })
      continue
    }
    let data: unknown
    try {
      data = JSON.parse(file.text)
    } catch {
      return {
        ok: false,
        error: `${file.name} is neither a script bundle (.json) nor a Python file (.py).`,
      }
    }
    const parsed = scriptBundleSchema.safeParse(data)
    if (!parsed.success) {
      return {
        ok: false,
        error: `${file.name} is not a script bundle: ${z.prettifyError(parsed.error)}`,
      }
    }
    for (const script of parsed.data.scripts) {
      out.push({
        name: script.name,
        code: script.code,
        timeLimitSeconds: script.settings?.timeLimitSeconds ?? SCRIPT_LIMITS.defaultSeconds,
      })
    }
  }
  if (out.length === 0) return { ok: false, error: 'The files hold no scripts.' }
  return { ok: true, value: out }
}

/**
 * Adds imported scripts as new ones, after the others: names made unique, `autoPublish` off
 * whatever the file said (PR2). Refused whole if the store would hold too many.
 */
export function importScripts(
  doc: StoredScripts,
  imported: readonly ImportedScript[],
  now: string,
  newId: () => string = () => newEntityId(),
): ScriptsEdit {
  let next = doc
  for (const script of imported) {
    const added = addScript(
      next,
      {
        name: uniqueScriptName(next.scripts, script.name),
        code: script.code,
        settings: { timeLimitSeconds: script.timeLimitSeconds, autoPublish: false },
      },
      now,
      newId(),
    )
    if (!added.ok) return added
    next = added.value
  }
  return { ok: true, value: next }
}

// ---- Private storage: load and save with the version check (PD5) -----------------------------

/** What the script store needs of a session: its own private storage. */
export type PrivateStore = Pick<AdminApi, 'getPrivate' | 'setPrivate'>

/** Reads the account's scripts. */
export async function loadScripts(store: PrivateStore): Promise<Result<StoredScripts, string>> {
  const read = await store.getPrivate(SCRIPTS_STORAGE_KEY)
  if (!read.ok) {
    return {
      ok: false,
      error: `the server did not give this login’s scripts (${read.error.condition})`,
    }
  }
  return parseStoredScripts(read.value)
}

export type SaveScriptsOutcome =
  | { readonly status: 'saved'; readonly scripts: StoredScripts }
  /** Another session saved since `base`: nothing was written. `current` is what it saved. */
  | { readonly status: 'conflict'; readonly current: StoredScripts }
  | { readonly status: 'failed'; readonly error: string }

/**
 * Writes `next` if the stored revision is still `baseRevision` (or whatever it is, with
 * `force`), as revision + 1. The size is checked first, against the transports' cap.
 */
export async function saveScripts(
  store: PrivateStore,
  next: StoredScripts,
  baseRevision: number,
  options: { readonly force?: boolean; readonly now?: string } = {},
): Promise<SaveScriptsOutcome> {
  const tooLarge = scriptsSizeRefusal(next)
  if (tooLarge !== undefined) return { status: 'failed', error: tooLarge }
  const read = await store.getPrivate(SCRIPTS_STORAGE_KEY)
  if (!read.ok) {
    return {
      status: 'failed',
      error: `The scripts were not saved: the server did not answer (${read.error.condition}).`,
    }
  }
  const current = parseStoredScripts(read.value)
  // A store this client cannot read is never overwritten: it may be a newer client's.
  if (!current.ok)
    return { status: 'failed', error: `The scripts were not saved: ${current.error}.` }
  if (current.value.revision !== baseRevision && options.force !== true) {
    return { status: 'conflict', current: current.value }
  }
  const written: StoredScripts = {
    ...next,
    format: SCRIPTS_FORMAT,
    version: SCRIPTS_VERSION,
    revision: current.value.revision + 1,
    updatedAt: options.now ?? new Date().toISOString(),
  }
  const tooLargeNow = scriptsSizeRefusal(written)
  if (tooLargeNow !== undefined) return { status: 'failed', error: tooLargeNow }
  const saved = await store.setPrivate(SCRIPTS_STORAGE_KEY, serialiseStoredScripts(written))
  if (!saved.ok) {
    return {
      status: 'failed',
      error:
        saved.error.condition === 'too-large'
          ? (scriptsSizeRefusal(written) ??
            'The scripts are over this login’s private-storage limit. Shorten or delete a script, then save again.')
          : `The scripts were not saved: the server refused (${saved.error.condition}).`,
    }
  }
  return { status: 'saved', scripts: written }
}
