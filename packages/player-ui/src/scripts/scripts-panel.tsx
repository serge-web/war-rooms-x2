// The Scripts panel (SRD Annex C PD4, PD5, PD7, PD9, PY-6, PY-7, PY-10, PR1; WP 6.3), a lazy
// chunk: the login's scripts from its private storage, an editor, Run and Stop with a time limit,
// and the run's output and errors. The admin's scripts write the world-state draft on top of it
// (WP 6.4), which the map room's change summary shows before anything is published (ADM-45,
// ADM-46); only a script whose "Publish without review" the admin turned on, after a
// confirmation, publishes it at once (PD7, PY-9, PR2), and each such publish is recorded here.
// Every confirmation is inline, not a modal, so the panel works popped out (PLY-4).
import { SINGLETON_NODES } from '@wrx/schemas'
import type { WorldState } from '@wrx/schemas'
import { UMPIRE_NAME } from '@wrx/domain'
import type { ScriptRole, WorldStateDiff } from '@wrx/domain'
import {
  DEFAULT_SCRIPT_SETTINGS,
  SCRIPT_LIMITS,
  addScript,
  deleteScript,
  duplicateScript,
  exportScripts,
  importScripts,
  loadScriptPublishes,
  parseScriptFiles,
  publishTitles,
  recordScriptPublish,
  renameScript,
  updateScript,
} from '@wrx/domain/scripts'
import type { PrivateStore, ScriptPublishRecord, StoredScript } from '@wrx/domain/scripts'
import { useMe, useSessionStore } from '@wrx/hooks'
import type { DraftWrite as RunnerDraftWrite, RunOutcome } from '@wrx/py-runner'
import { Banner, Button, TextField } from '@wrx/ui'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, SyntheticEvent, MouseEvent } from 'react'
import { useMapRoomId, useWorldDraftStorage } from '../map/world-draft.tsx'
import { CodeEditor } from './code-editor.tsx'
import {
  RunnerUnavailable,
  currentScriptDraft,
  loadPanelRunner,
  publishScriptDraft,
  writeScriptDraft,
} from './runner-host.ts'
import type { AutoPublishOutcome, DraftWrite, PanelRunner, RunnerFactory } from './runner-host.ts'
import { useScriptLibrary } from './use-script-library.ts'

/** The code a new script starts with. */
export function starterCode(role: ScriptRole): string {
  const lines = [
    'import wrx',
    '',
    'game = wrx.Game()',
    'context = await game.context()',
    'print("Running as", "the admin" if context.isAdmin else context.roleId)',
    'for room in await game.rooms():',
    '    print(room.name)',
  ]
  if (role === 'admin') {
    lines.push(
      '',
      '# To change the world-state draft (shown in the map room before you publish):',
      '# state = await game.draft()',
      '# ...change assets in state.assets...',
      '# await game.write_draft(state)',
    )
  } else {
    lines.push(
      '',
      '# To propose a world state to the admin, in the umpire room:',
      '# state = await game.world_state()',
      '# await game.post_proposal(state, "What it changes")',
    )
  }
  return `${lines.join('\n')}\n`
}

/** One line of output, as printed. */
interface Line {
  readonly stream: 'stdout' | 'stderr'
  readonly text: string
}

const MAX_LINES = 2_000

type RunState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'running'
      readonly scriptId: string
      readonly name: string
      readonly limit: number
    }
  | {
      readonly phase: 'done'
      readonly scriptId: string
      readonly name: string
      readonly limit: number
      readonly outcome: RunOutcome
      readonly draft: DraftWrite | undefined
      /** With the script's "Publish without review" on (PD7): what publishing did. */
      readonly publish?: AutoPublishOutcome | undefined
    }

type PythonState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly ms: number }
  | { readonly phase: 'failed'; readonly error: string }
  /** This build has no runner (a PR preview without `py/`, owner Nov 6, 2026). */
  | { readonly phase: 'unavailable'; readonly reason: string }

/** Unsaved edits to one script. */
interface Buffer {
  readonly code: string
  /** As typed, so a half-typed number is kept. */
  readonly limit: string
}

type Pending =
  | { readonly kind: 'rename'; readonly id: string }
  | { readonly kind: 'delete'; readonly id: string }
  | { readonly kind: 'auto-publish'; readonly id: string }
  | undefined

export interface ScriptsPanelViewProps {
  readonly role: ScriptRole
  /** This login's private storage: `session.admin` (any account may use its own). */
  readonly privateStore: PrivateStore
  readonly runnerFactory: RunnerFactory
  /** The admin's: puts a clean run's change in the draft, on top of it (WP 6.4). */
  readonly writeDraft?: ((write: RunnerDraftWrite) => DraftWrite) | undefined
  /** The admin's: the draft held now, for `readDraft`. */
  readonly currentDraft?: (() => WorldState | undefined) | undefined
  /** The admin's: publishes the draft without review (PD7, PY-9). */
  readonly publishDraft?: (() => Promise<AutoPublishOutcome>) | undefined
  /** How often the stored scripts are re-read (ms); 0 turns it off. */
  readonly pollMs?: number
  /** Who the scripts run as, for the panel's lead. */
  readonly runsAs: string
}

function limitSeconds(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined
  const n = Number(text)
  return n >= 1 && n <= SCRIPT_LIMITS.maxSeconds ? n : undefined
}

function seconds(ms: number): string {
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1)} s`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function diffWords(
  diff: WorldStateDiff,
  none = 'no assets differ from the published state',
): string {
  const parts = [
    diff.added.length > 0 ? `${plural(diff.added.length, 'asset')} added` : undefined,
    diff.removed.length > 0 ? `${plural(diff.removed.length, 'asset')} removed` : undefined,
    diff.changed.length > 0 ? `${plural(diff.changed.length, 'asset')} changed` : undefined,
  ].filter((p): p is string => p !== undefined)
  return parts.length === 0 ? none : parts.join(', ')
}

/** "Tank Company, 1st Rifles and 2 more": the titles a record or summary names. */
function titleList(titles: readonly string[], count: number): string {
  const more = count - titles.length
  return more > 0 ? `${titles.join(', ')} and ${more} more` : titles.join(', ')
}

/** Saves a file from the page (or a popped-out panel's window). */
function download(event: MouseEvent<HTMLElement>, name: string, text: string): void {
  const doc = event.currentTarget.ownerDocument
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = doc.createElement('a')
  link.href = url
  link.download = name
  doc.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1_000)
}

export function ScriptsPanelView({
  role,
  privateStore,
  runnerFactory,
  writeDraft,
  currentDraft,
  publishDraft,
  pollMs,
  runsAs,
}: ScriptsPanelViewProps) {
  const headingId = useId()
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [buffers, setBuffers] = useState<ReadonlyMap<string, Buffer>>(new Map())
  const buffersRef = useRef(buffers)
  buffersRef.current = buffers
  const [pending, setPending] = useState<Pending>(undefined)
  const [importError, setImportError] = useState<string | undefined>(undefined)
  const [importNote, setImportNote] = useState<string | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)

  const library = useScriptLibrary(privateStore, {
    ...(pollMs === undefined ? {} : { pollMs }),
    hasUnsavedEdits: () => buffersRef.current.size > 0,
    onReplaced: () => {
      setBuffers(new Map())
    },
  })
  const scripts: readonly StoredScript[] = library.scripts?.scripts ?? []
  const current = scripts.find((s) => s.id === selected) ?? scripts[0]

  // An edit that is now what is stored (saved here, kept over another session's, or saved the
  // same elsewhere) is no longer unsaved; one whose script is gone is dropped.
  const stored = library.scripts
  useEffect(() => {
    if (stored === undefined) return
    setBuffers((before) => {
      let next: Map<string, Buffer> | undefined
      for (const [id, buffer] of before) {
        const script = stored.scripts.find((s) => s.id === id)
        if (
          script === undefined ||
          (script.code === buffer.code && String(script.settings.timeLimitSeconds) === buffer.limit)
        ) {
          next ??= new Map(before)
          next.delete(id)
        }
      }
      return next ?? before
    })
  }, [stored])

  const now = () => new Date().toISOString()

  // ---- Python ----------------------------------------------------------------------------------
  const runner = useRef<Promise<PanelRunner> | undefined>(undefined)
  const [python, setPython] = useState<PythonState>({ phase: 'loading' })
  const [run, setRun] = useState<RunState>({ phase: 'idle' })
  const [lines, setLines] = useState<readonly Line[]>([])
  const draftWrite = useRef<DraftWrite | undefined>(undefined)
  const writeDraftRef = useRef(writeDraft)
  writeDraftRef.current = writeDraft
  const currentDraftRef = useRef(currentDraft)
  currentDraftRef.current = currentDraft
  // The record of publishes without review (PD7, PY-9), the admin's; newest last.
  const [publishes, setPublishes] = useState<readonly ScriptPublishRecord[] | undefined>(undefined)
  const [publishesError, setPublishesError] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (role !== 'admin') return undefined
    let live = true
    void loadScriptPublishes(privateStore).then((read) => {
      if (!live) return
      if (read.ok) setPublishes(read.value)
      else setPublishesError(read.error)
    })
    return () => {
      live = false
    }
  }, [role, privateStore])

  const startPython = useCallback(() => {
    setPython({ phase: 'loading' })
    const made = runnerFactory({
      role,
      ...(role === 'admin'
        ? {
            draft: {
              current: () => currentDraftRef.current?.(),
              apply: (write) => {
                draftWrite.current = writeDraftRef.current?.(write) ?? {
                  ok: false,
                  error: 'this view keeps no world-state draft',
                }
              },
            },
          }
        : {}),
    })
    runner.current = made
    made.then(
      (r) =>
        r.start().then(
          (started) => {
            if (runner.current === made) setPython({ phase: 'ready', ms: started.totalMs })
          },
          (error: unknown) => {
            if (runner.current === made) setPython({ phase: 'failed', error: String(error) })
          },
        ),
      (error: unknown) => {
        if (runner.current !== made) return
        setPython(
          error instanceof RunnerUnavailable
            ? { phase: 'unavailable', reason: error.message }
            : { phase: 'failed', error: String(error) },
        )
      },
    )
  }, [role, runnerFactory])

  // PY-5: the runner loads, and Pyodide starts, when the panel is first shown.
  useEffect(() => {
    startPython()
    return () => {
      const made = runner.current
      runner.current = undefined
      void made?.then((r) => {
        r.dispose()
      })
    }
  }, [startPython])

  const running = run.phase === 'running'

  const onRun = async () => {
    if (current === undefined || running || python.phase === 'unavailable') return
    const buffer = buffers.get(current.id)
    const code = buffer?.code ?? current.code
    const limit = limitSeconds(buffer?.limit ?? String(current.settings.timeLimitSeconds))
    if (limit === undefined) return
    let made = runner.current
    if (made === undefined || python.phase === 'failed') {
      startPython()
      made = runner.current
    }
    if (made === undefined) return
    setLines([])
    draftWrite.current = undefined
    setRun({ phase: 'running', scriptId: current.id, name: current.name, limit })
    let outcome: RunOutcome
    try {
      const r = await made
      outcome = await r.run(code, {
        timeoutMs: limit * 1_000,
        onOutput: (line) => {
          setLines((before) =>
            before.length >= MAX_LINES ? [...before.slice(1), line] : [...before, line],
          )
        },
      })
    } catch (error) {
      outcome = { status: 'failed', error: String(error), output: '', ms: 0 }
    }
    // Set by the runner's `apply` during the run (TypeScript cannot see that).
    const written = draftWrite.current as DraftWrite | undefined
    const draft = outcome.status === 'finished' ? written : undefined
    // PD7, PY-9: a clean run that wrote the draft publishes it, if the admin turned it on.
    let publish: AutoPublishOutcome | undefined
    if (role === 'admin' && draft?.ok === true && current.settings.autoPublish) {
      publish = (await publishDraft?.()) ?? {
        status: 'failed',
        error: 'this view cannot publish the world state',
      }
      if (publish.status === 'published') {
        const recorded = await recordScriptPublish(privateStore, {
          at: now(),
          scriptId: current.id,
          scriptName: current.name,
          stanzaId: publish.stanzaId,
          turn: publish.turn,
          added: publishTitles(publish.diff.added),
          removed: publishTitles(publish.diff.removed),
          changed: publishTitles(publish.diff.changed.map((c) => c.after)),
        })
        if (recorded.ok) {
          setPublishes(recorded.value)
          setPublishesError(undefined)
        } else {
          setPublishesError(recorded.error)
        }
      }
    }
    setRun({
      phase: 'done',
      scriptId: current.id,
      name: current.name,
      limit,
      outcome,
      draft,
      publish,
    })
  }

  const setAutoPublish = async (id: string, on: boolean) => {
    const script = scripts.find((s) => s.id === id)
    if (script === undefined) return
    const saved = await library.commit((doc) =>
      updateScript(doc, id, { settings: { ...script.settings, autoPublish: on } }, now()),
    )
    if (saved) setPending(undefined)
  }

  const onStop = () => {
    void runner.current?.then((r) => {
      r.stop()
    })
  }

  // ---- Edits -----------------------------------------------------------------------------------
  const buffer = current === undefined ? undefined : buffers.get(current.id)
  const code = buffer?.code ?? current?.code ?? ''
  const limitText = buffer?.limit ?? String(current?.settings.timeLimitSeconds ?? '')
  const limitError =
    current === undefined || limitSeconds(limitText) !== undefined
      ? undefined
      : `A whole number of seconds from 1 to ${SCRIPT_LIMITS.maxSeconds}.`

  const setBuffer = (id: string, change: Partial<Buffer>) => {
    const script = scripts.find((s) => s.id === id)
    if (script === undefined) return
    setBuffers((before) => {
      const next = new Map(before)
      const was = before.get(id) ?? {
        code: script.code,
        limit: String(script.settings.timeLimitSeconds),
      }
      const merged = { ...was, ...change }
      if (
        merged.code === script.code &&
        merged.limit === String(script.settings.timeLimitSeconds)
      ) {
        next.delete(id)
      } else {
        next.set(id, merged)
      }
      return next
    })
  }

  const dropBuffer = (id: string) => {
    setBuffers((before) => {
      if (!before.has(id)) return before
      const next = new Map(before)
      next.delete(id)
      return next
    })
  }

  const onSave = async () => {
    if (current === undefined || buffer === undefined || library.saving) return
    const limit = limitSeconds(buffer.limit)
    if (limit === undefined) return
    const id = current.id
    const saved = await library.commit((doc) =>
      updateScript(
        doc,
        id,
        { code: buffer.code, settings: { ...current.settings, timeLimitSeconds: limit } },
        now(),
      ),
    )
    if (saved) dropBuffer(id)
  }

  const onNew = async () => {
    let id: string | undefined
    const saved = await library.commit((doc) => {
      const added = addScript(
        doc,
        { code: starterCode(role), settings: DEFAULT_SCRIPT_SETTINGS },
        now(),
      )
      if (added.ok) id = added.value.scripts.at(-1)?.id
      return added
    })
    if (saved && id !== undefined) setSelected(id)
  }

  const onDuplicate = async () => {
    if (current === undefined) return
    const from = current.id
    let id: string | undefined
    const saved = await library.commit((doc) => {
      const copied = duplicateScript(doc, from, now())
      if (copied.ok) {
        const at = copied.value.scripts.findIndex((s) => s.id === from)
        id = copied.value.scripts[at + 1]?.id
      }
      return copied
    })
    if (saved && id !== undefined) setSelected(id)
  }

  const onDelete = async (id: string) => {
    const at = scripts.findIndex((s) => s.id === id)
    const saved = await library.commit((doc) => deleteScript(doc, id))
    if (!saved) return
    dropBuffer(id)
    setPending(undefined)
    const rest = scripts.filter((s) => s.id !== id)
    setSelected(rest[Math.min(at, rest.length - 1)]?.id)
  }

  const onRename = async (id: string, name: string) => {
    const saved = await library.commit((doc) => renameScript(doc, id, name, now()))
    if (saved) setPending(undefined)
    return saved
  }

  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    setImportError(undefined)
    setImportNote(undefined)
    if (files.length === 0) return
    const read = parseScriptFiles(
      await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))),
    )
    if (!read.ok) {
      setImportError(read.error)
      return
    }
    const saved = await library.commit((doc) => importScripts(doc, read.value, now()))
    if (saved) {
      setImportNote(
        `Imported ${plural(read.value.length, 'script')}. Nothing was run; check each before you run it.`,
      )
    }
  }

  const onExport = (event: MouseEvent<HTMLButtonElement>) => {
    if (library.scripts === undefined) return
    const stamp = new Date().toISOString().slice(0, 10)
    download(event, `scripts-${stamp}.json`, exportScripts(library.scripts, now()))
  }

  // ---- Render ----------------------------------------------------------------------------------
  const disabled = library.status !== 'ready' || library.saving
  return (
    <section className="wrx-panel wrx-scripts" aria-labelledby={headingId}>
      <h2 id={headingId} className="wrx-panel__heading">
        Scripts
      </h2>
      <p className="wrx-panel__lead">
        Python scripts kept in this login’s private storage and shared by everyone who uses it. They
        run as {runsAs}.
      </p>
      <PythonStatus python={python} onRetry={startPython} />
      {library.status === 'error' ? (
        <Banner tone="danger" title="The scripts could not be read">
          {library.loadError}. Nothing can be saved until they can.
        </Banner>
      ) : null}
      {library.conflict ? (
        <Banner
          tone="warning"
          title="Changed in another session"
          actions={
            <>
              <Button size="small" onClick={() => void library.reload()}>
                Reload
              </Button>
              <Button size="small" onClick={() => void library.keepMine()}>
                Keep my change
              </Button>
            </>
          }
        >
          Another session of this login saved the scripts since you loaded them, so your change was
          not saved. Reload takes theirs and drops your unsaved edits; Keep my change applies yours
          to what they saved.
        </Banner>
      ) : library.elsewhere ? (
        <Banner
          tone="warning"
          title="Changed in another session"
          actions={
            <>
              <Button size="small" onClick={() => void library.reload()}>
                Reload
              </Button>
              <Button size="small" variant="ghost" onClick={library.dismissElsewhere}>
                Keep editing
              </Button>
            </>
          }
        >
          Another session of this login saved the scripts. Reload to see them; your unsaved edits
          here would be dropped.
        </Banner>
      ) : null}
      {library.saveError === undefined ? null : (
        <Banner tone="danger" title="Not saved">
          {library.saveError}
        </Banner>
      )}
      {importError === undefined ? null : (
        <Banner
          tone="danger"
          title="Not imported"
          onDismiss={() => {
            setImportError(undefined)
          }}
        >
          {importError}
        </Banner>
      )}
      <p className="wrx-visually-hidden" role="status">
        {library.note ?? (library.saving ? 'Saving…' : '')}
      </p>
      {importNote === undefined ? null : (
        <p className="wrx-scripts__note" role="status">
          {importNote}
        </p>
      )}

      <div className="wrx-scripts__layout">
        <div className="wrx-scripts__list">
          <div className="wrx-scripts__toolbar" role="group" aria-label="Script list actions">
            <Button size="small" variant="primary" disabled={disabled} onClick={() => void onNew()}>
              New script
            </Button>
            <Button
              size="small"
              disabled={disabled}
              onClick={() => {
                fileInput.current?.click()
              }}
            >
              Import…
            </Button>
            <input
              ref={fileInput}
              type="file"
              className="wrx-visually-hidden"
              tabIndex={-1}
              aria-label="Import scripts from files"
              accept=".json,.py,application/json,text/x-python"
              multiple
              onChange={(event) => void onImport(event)}
            />
            <Button
              size="small"
              disabled={library.status !== 'ready' || scripts.length === 0}
              onClick={onExport}
            >
              Export all
            </Button>
          </div>
          {library.status === 'loading' ? (
            <p className="wrx-empty" role="status">
              Loading the scripts…
            </p>
          ) : scripts.length === 0 ? (
            <p className="wrx-empty">No scripts yet. Create one, or import a file.</p>
          ) : (
            <ul className="wrx-scripts__items" aria-label="Your scripts">
              {scripts.map((script) => (
                <li key={script.id}>
                  <button
                    type="button"
                    className="wrx-scripts__item"
                    aria-current={script.id === current?.id ? 'true' : undefined}
                    onClick={() => {
                      setSelected(script.id)
                      setPending(undefined)
                    }}
                  >
                    {script.name}
                    {buffers.has(script.id) ? (
                      <span className="wrx-scripts__unsaved"> (unsaved)</span>
                    ) : null}
                    {run.phase === 'running' && run.scriptId === script.id ? (
                      <span className="wrx-scripts__running"> (running)</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {current === undefined ? null : (
          <div className="wrx-scripts__main">
            <div className="wrx-scripts__title">
              <h3 className="wrx-scripts__name">{current.name}</h3>
              <div
                className="wrx-scripts__actions"
                role="group"
                aria-label={`${current.name} actions`}
              >
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setPending({ kind: 'rename', id: current.id })
                  }}
                >
                  Rename…
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void onDuplicate()}
                >
                  Duplicate
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled || (running && run.scriptId === current.id)}
                  onClick={() => {
                    setPending({ kind: 'delete', id: current.id })
                  }}
                >
                  Delete…
                </Button>
              </div>
            </div>
            {pending?.kind === 'rename' && pending.id === current.id ? (
              <RenameForm
                name={current.name}
                busy={library.saving}
                error={library.saveError}
                onSubmit={(name) => onRename(current.id, name)}
                onClose={() => {
                  setPending(undefined)
                }}
              />
            ) : null}
            {pending?.kind === 'delete' && pending.id === current.id ? (
              <InlineConfirm
                title={`Delete ${current.name}?`}
                text={`The script is removed from this login’s private storage, for every session that uses it. This cannot be undone${scripts.length > 0 ? '; export it first to keep a copy' : ''}.`}
                action="Delete script"
                onConfirm={() => void onDelete(current.id)}
                onClose={() => {
                  setPending(undefined)
                }}
              />
            ) : null}

            <CodeEditor
              label={`Code of ${current.name}`}
              value={code}
              onChange={(value) => {
                setBuffer(current.id, { code: value })
              }}
              onSave={() => void onSave()}
            />
            <div className="wrx-scripts__controls">
              <TextField
                className="wrx-scripts__limit"
                label="Time limit (seconds)"
                inputMode="numeric"
                value={limitText}
                hint={`1 to ${SCRIPT_LIMITS.maxSeconds}; the run is stopped after it.`}
                error={limitError}
                onChange={(event) => {
                  setBuffer(current.id, { limit: event.target.value })
                }}
              />
              <div className="wrx-scripts__buttons">
                <Button
                  size="small"
                  disabled={buffer === undefined || limitError !== undefined || disabled}
                  busy={library.saving}
                  onClick={() => void onSave()}
                >
                  Save
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  disabled={running || limitError !== undefined || python.phase === 'unavailable'}
                  onClick={() => void onRun()}
                >
                  Run
                </Button>
                <Button size="small" variant="danger" disabled={!running} onClick={onStop}>
                  Stop
                </Button>
              </div>
            </div>
            {role === 'admin' ? (
              <AutoPublishSetting
                script={current}
                disabled={disabled}
                confirming={pending?.kind === 'auto-publish' && pending.id === current.id}
                onAsk={() => {
                  setPending({ kind: 'auto-publish', id: current.id })
                }}
                onCancel={() => {
                  setPending(undefined)
                }}
                onSet={(on) => void setAutoPublish(current.id, on)}
              />
            ) : null}
            <RunReport run={run} lines={lines} role={role} />
          </div>
        )}
      </div>
      {role === 'admin' ? <PublishRecord records={publishes} error={publishesError} /> : null}
    </section>
  )
}

/**
 * The per-script opt-in to publish without review (PD7, PY-9, PR2): off by default; turning it
 * on asks first, saying it changes the live map without review; turning it off does not ask.
 */
function AutoPublishSetting({
  script,
  disabled,
  confirming,
  onAsk,
  onCancel,
  onSet,
}: {
  readonly script: StoredScript
  readonly disabled: boolean
  readonly confirming: boolean
  readonly onAsk: () => void
  readonly onCancel: () => void
  readonly onSet: (on: boolean) => void
}) {
  const id = useId()
  const on = script.settings.autoPublish
  return (
    <div className="wrx-scripts__auto">
      <input
        id={id}
        type="checkbox"
        checked={on}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          if (event.target.checked) onAsk()
          else onSet(false)
        }}
      />
      <label htmlFor={id}>Publish without review</label>
      <p id={`${id}-hint`} className="wrx-scripts__hint">
        {on
          ? 'On: when this script finishes cleanly and has changed the draft, the world state is published to every role at once, without the change summary.'
          : 'Off: the script fills the draft, and you publish it from the Map room after the change summary.'}
      </p>
      {confirming ? (
        <InlineConfirm
          title={`Publish without review for ${script.name}?`}
          text="Each clean run that changes the draft will then publish the world state to every role straight away, at any time, mid-phase included. It changes the live map without review: you will not see the change summary first. Each publish is checked and recorded below, and a manual publish can put a mistake right."
          action="Turn on"
          onConfirm={() => {
            onSet(true)
          }}
          onClose={onCancel}
        />
      ) : null}
    </div>
  )
}

/** Each world state a script published without review, newest first (PY-9). */
function PublishRecord({
  records,
  error,
}: {
  readonly records: readonly ScriptPublishRecord[] | undefined
  readonly error: string | undefined
}) {
  const headingId = useId()
  const newest = records === undefined ? [] : [...records].reverse()
  return (
    <section className="wrx-scripts__record" aria-labelledby={headingId}>
      <h3 id={headingId} className="wrx-scripts__subheading">
        Published without review
      </h3>
      {error === undefined ? null : <p className="wrx-scripts__hint">The record: {error}.</p>}
      {records === undefined ? null : newest.length === 0 ? (
        <p className="wrx-empty">No script has published the world state without review.</p>
      ) : (
        <ol className="wrx-scripts__records">
          {newest.map((r) => (
            <li key={`${r.at}-${r.stanzaId}`}>
              <strong>{r.scriptName}</strong> published turn {r.turn} at{' '}
              <time dateTime={r.at}>{r.at.slice(0, 16).replace('T', ' ')}</time> (UTC):{' '}
              {[
                r.added.count > 0 ? `added ${titleList(r.added.titles, r.added.count)}` : undefined,
                r.removed.count > 0
                  ? `removed ${titleList(r.removed.titles, r.removed.count)}`
                  : undefined,
                r.changed.count > 0
                  ? `changed ${titleList(r.changed.titles, r.changed.count)}`
                  : undefined,
              ]
                .filter((p) => p !== undefined)
                .join('; ')}
              .
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function PythonStatus({
  python,
  onRetry,
}: {
  readonly python: PythonState
  readonly onRetry: () => void
}) {
  if (python.phase === 'unavailable') {
    return (
      <Banner tone="info" title="Python scripts are not available in this build">
        {python.reason}
      </Banner>
    )
  }
  if (python.phase === 'failed') {
    return (
      <Banner
        tone="danger"
        title="Python could not start"
        actions={
          <Button size="small" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {python.error}
      </Banner>
    )
  }
  return (
    <p className="wrx-scripts__python" role="status">
      {python.phase === 'loading'
        ? 'Starting Python… (the first start takes a few seconds)'
        : 'Python is ready.'}
    </p>
  )
}

function statusWords(run: Exclude<RunState, { phase: 'idle' }>, role: ScriptRole): string {
  if (run.phase === 'running') {
    return `Running ${run.name}… It is stopped after ${run.limit} s.`
  }
  const { outcome } = run
  const draft = role === 'admin' ? ' The world-state draft is unchanged.' : ''
  switch (outcome.status) {
    case 'finished':
      return `${run.name} finished in ${seconds(outcome.ms)}.`
    case 'failed':
      return `${run.name} failed after ${seconds(outcome.ms)}.${draft}`
    case 'stopped':
      return `${run.name} was stopped after ${seconds(outcome.ms)}.${draft}`
    case 'timed-out':
      return `${run.name} reached its ${run.limit} s time limit and was stopped.${draft}`
  }
}

function RunReport({
  run,
  lines,
  role,
}: {
  readonly run: RunState
  readonly lines: readonly Line[]
  readonly role: ScriptRole
}) {
  const outputId = useId()
  const errorId = useId()
  const end = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const pre = end.current
    if (pre !== null) pre.scrollTop = pre.scrollHeight
  }, [lines])
  if (run.phase === 'idle') {
    return <p className="wrx-empty wrx-scripts__report">Run a script to see its output here.</p>
  }
  const failed = run.phase === 'done' && run.outcome.status !== 'finished'
  const draft = run.phase === 'done' ? run.draft : undefined
  // While running, the lines come live; afterwards the outcome holds all of them, but the live
  // ones keep their streams.
  const shown: readonly Line[] =
    lines.length > 0 || run.phase === 'running' || run.outcome.output === ''
      ? lines
      : run.outcome.output.split('\n').map((text) => ({ stream: 'stdout' as const, text }))
  return (
    <div className="wrx-scripts__report">
      <p
        className={`wrx-scripts__status wrx-scripts__status--${run.phase === 'running' ? 'running' : run.outcome.status}`}
        role="status"
      >
        {statusWords(run, role)}
      </p>
      {draft === undefined ? null : draft.ok ? (
        <Banner
          tone="success"
          title={
            run.phase === 'done' && run.publish?.status === 'published'
              ? 'The world state was published without review'
              : 'The world-state draft was updated'
          }
        >
          The script changed your draft: {diffWords(draft.changes, 'no assets changed')}; the rest
          of the draft, your own edits included, is as it was.
          {draft.overwritten.length > 0
            ? ` It also changed ${titleList(
                draft.overwritten.slice(0, 5).map((a) => a.title),
                draft.overwritten.length,
              )}, which you had edited since it read the draft: its values were kept.`
            : ''}{' '}
          {run.phase !== 'done' || run.publish === undefined ? (
            <>
              Against the published state: {diffWords(draft.diff)}. Nothing is published. Open the
              Map room and choose “Publish world state…” to review the change summary first.
            </>
          ) : run.publish.status === 'published' ? (
            <>
              Published to every role as turn {run.publish.turn}: {diffWords(run.publish.diff)}. It
              is recorded below.
            </>
          ) : run.publish.status === 'unchanged' ? (
            <>The draft is the published state, so nothing was published.</>
          ) : (
            <>Not published: {run.publish.error} The draft is kept.</>
          )}
        </Banner>
      ) : (
        <Banner tone="danger" title="The draft was not written">
          The script finished, but its world state was not kept: {draft.error}.
        </Banner>
      )}
      <h4 id={outputId} className="wrx-scripts__subheading">
        Output
      </h4>
      <pre
        ref={end}
        className="wrx-scripts__output"
        aria-labelledby={outputId}
        tabIndex={0}
        role="region"
      >
        {shown.length === 0 ? (
          <span className="wrx-scripts__quiet">(nothing printed)</span>
        ) : (
          shown.map((line, i) =>
            line.stream === 'stderr' ? (
              <span key={i} className="wrx-scripts__stderr">
                <span className="wrx-visually-hidden">stderr: </span>
                {line.text}
                {'\n'}
              </span>
            ) : (
              <span key={i}>
                {line.text}
                {'\n'}
              </span>
            ),
          )
        )}
      </pre>
      {failed && run.outcome.error !== undefined ? (
        <>
          <h4 id={errorId} className="wrx-scripts__subheading">
            Error
          </h4>
          <pre className="wrx-scripts__error" aria-labelledby={errorId} tabIndex={0} role="region">
            {run.outcome.error}
          </pre>
        </>
      ) : null}
    </div>
  )
}

function RenameForm({
  name,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  readonly name: string
  readonly busy: boolean
  readonly error: string | undefined
  readonly onSubmit: (name: string) => Promise<boolean>
  readonly onClose: () => void
}) {
  const [value, setValue] = useState(name)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.select()
  }, [])
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    void onSubmit(value)
  }
  return (
    <form className="wrx-scripts__inline" aria-label={`Rename ${name}`} onSubmit={submit}>
      <TextField
        ref={input}
        label="New name"
        value={value}
        maxLength={SCRIPT_LIMITS.nameChars}
        error={error}
        onChange={(event) => {
          setValue(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      />
      <div className="wrx-scripts__buttons">
        <Button size="small" variant="primary" type="submit" busy={busy}>
          Rename
        </Button>
        <Button size="small" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** A confirmation in the panel, not a modal, so it works popped out (as the map editor's). */
function InlineConfirm({
  title,
  text,
  action,
  onConfirm,
  onClose,
}: {
  readonly title: string
  readonly text: string
  readonly action: string
  readonly onConfirm: () => void
  readonly onClose: () => void
}) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section
      className="wrx-scripts__inline"
      role="alertdialog"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <h4 id={headingId} ref={heading} tabIndex={-1} className="wrx-scripts__subheading">
        {title}
      </h4>
      <p>{text}</p>
      <div className="wrx-scripts__buttons">
        <Button size="small" variant="danger" onClick={onConfirm}>
          {action}
        </Button>
        <Button size="small" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  )
}

/** The panel over the pane's session: its private storage, its runner and the admin's draft. */
export default function ScriptsPanel({ role }: { readonly role: ScriptRole }) {
  const store = useSessionStore()
  const me = useMe().data
  const storage = useWorldDraftStorage()
  const mapRoomId = useMapRoomId()
  // The admin's draft starts from the published state, and a publish stamps the current turn:
  // keep the map room's state and the turn read.
  useEffect(() => {
    if (role !== 'admin' || mapRoomId === undefined) return undefined
    const releaseWorld = store.acquireWorldState(mapRoomId)
    const releaseTurn = store.acquire(SINGLETON_NODES.gameState)
    return () => {
      releaseWorld()
      releaseTurn()
    }
  }, [role, mapRoomId, store])
  const factory = useMemo<RunnerFactory>(() => loadPanelRunner(store), [store])
  const writeDraft = useCallback(
    (write: RunnerDraftWrite) =>
      writeScriptDraft(store, storage, mapRoomId, write, new Date().toISOString()),
    [store, storage, mapRoomId],
  )
  const currentDraft = useCallback(
    () => currentScriptDraft(store, storage, mapRoomId),
    [store, storage, mapRoomId],
  )
  const publishDraft = useCallback(
    () => publishScriptDraft(store, storage, mapRoomId),
    [store, storage, mapRoomId],
  )
  const runsAs =
    role === 'admin'
      ? `the admin (${UMPIRE_NAME})`
      : `${me.role?.name ?? 'this role'}, with its access`
  return (
    <ScriptsPanelView
      role={role}
      privateStore={store.session.admin}
      runnerFactory={factory}
      writeDraft={role === 'admin' ? writeDraft : undefined}
      currentDraft={role === 'admin' ? currentDraft : undefined}
      publishDraft={role === 'admin' ? publishDraft : undefined}
      runsAs={runsAs}
    />
  )
}
