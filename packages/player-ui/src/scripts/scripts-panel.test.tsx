// @vitest-environment happy-dom
// The Scripts panel (WP 6.3) over a fake private store and a fake runner: the list and its edits
// in private storage, saving with the version check between two sessions of one login, Run and
// Stop with live output and the outcome, the admin's draft notice, import and export; and the
// editor's indentation and the draft write on their own.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { diffWorldStates, parseWorldDraft, worldDraftKey } from '@wrx/domain'
import type { ScriptRole, SessionStore } from '@wrx/domain'
import { SCRIPTS_STORAGE_KEY, parseStoredScripts } from '@wrx/domain/scripts'
import type { PrivateStore } from '@wrx/domain/scripts'
import type { RunOutcome, RunOptions } from '@wrx/py-runner'
import { sampleWorldState } from '@wrx/schemas/fixtures'
import type { WorldState } from '@wrx/schemas'
import { afterEach, describe, expect, it } from 'vitest'
import { memoryWorldDraftStorage } from '../map/draft-storage.ts'
import { caretPosition, dedent, indent } from './code-editor.tsx'
import { writeScriptDraft } from './runner-host.ts'
import type { DraftWrite, PanelRunner, RunnerFactory, RunnerRequest } from './runner-host.ts'
import { ScriptsPanelView, starterCode } from './scripts-panel.tsx'

afterEach(cleanup)

/** One login's private storage; each `session()` is a session of it. */
function account() {
  const stored = new Map<string, string>()
  return {
    stored,
    session: (): PrivateStore => ({
      getPrivate: (key) => Promise.resolve({ ok: true, value: stored.get(key) }),
      setPrivate: (key, value) => {
        stored.set(key, value)
        return Promise.resolve({ ok: true, value: undefined })
      },
    }),
    names: () => {
      const read = parseStoredScripts(stored.get(SCRIPTS_STORAGE_KEY))
      return read.ok ? read.value.scripts.map((s) => s.name) : []
    },
  }
}

/** A runner whose runs the test finishes by hand. */
function fakeRunner() {
  const runs: {
    code: string
    options: RunOptions
    finish: (outcome: RunOutcome) => void
  }[] = []
  const requests: RunnerRequest[] = []
  let stops = 0
  const factory: RunnerFactory = (request) => {
    requests.push(request)
    const runner: PanelRunner = {
      start: () => Promise.resolve({ totalMs: 1_800 }),
      run: (code, options) =>
        new Promise((resolve) => {
          runs.push({ code, options, finish: resolve })
        }),
      stop: () => {
        stops++
        const last = runs.at(-1)
        last?.finish({ status: 'stopped', output: '', ms: 1_200 })
      },
      dispose: () => undefined,
    }
    return Promise.resolve(runner)
  }
  return { factory, runs, requests, stops: () => stops }
}

function mount(
  options: {
    readonly role?: ScriptRole
    readonly store?: PrivateStore
    readonly runner?: ReturnType<typeof fakeRunner>
    readonly writeDraft?: (state: WorldState) => DraftWrite
    readonly label?: string
  } = {},
) {
  const runner = options.runner ?? fakeRunner()
  const store = options.store ?? account().session()
  const view = (
    <section aria-label={options.label ?? 'Pane'}>
      <ScriptsPanelView
        role={options.role ?? 'white-force'}
        privateStore={store}
        runnerFactory={runner.factory}
        writeDraft={options.writeDraft}
        pollMs={0}
        runsAs="White Cell"
      />
    </section>
  )
  return { ...render(view), runner }
}

const pane = (name = 'Pane') => within(screen.getByRole('region', { name }))

async function ready(scope = pane()) {
  await waitFor(() => {
    expect(scope.getByText(/^Python is ready/)).toBeTruthy()
  })
  await waitFor(() => {
    expect(scope.queryByText('Loading the scripts…')).toBeNull()
  })
}

async function newScript(scope = pane()) {
  fireEvent.click(scope.getByRole('button', { name: 'New script' }))
  await waitFor(() => {
    expect(scope.getByRole('heading', { name: /Untitled script/, level: 3 })).toBeTruthy()
  })
}

describe('the script list in private storage (PY-7)', () => {
  it('starts empty, creates, renames, duplicates and deletes after a confirmation', async () => {
    const acct = account()
    mount({ store: acct.session() })
    await ready()
    expect(screen.getByText('No scripts yet. Create one, or import a file.')).toBeTruthy()
    await newScript()
    expect(acct.names()).toEqual(['Untitled script'])
    const code = screen.getByRole('textbox', { name: 'Code of Untitled script' })
    expect((code as HTMLTextAreaElement).value).toBe(starterCode('white-force'))

    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }))
    const form = screen.getByRole('form', { name: 'Rename Untitled script' })
    fireEvent.change(within(form).getByLabelText('New name'), { target: { value: 'Rooms' } })
    fireEvent.submit(form)
    await waitFor(() => {
      expect(acct.names()).toEqual(['Rooms'])
    })

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
    await waitFor(() => {
      expect(acct.names()).toEqual(['Rooms', 'Rooms (copy)'])
    })
    expect(screen.getByRole('heading', { name: 'Rooms (copy)', level: 3 })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete Rooms (copy)?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(acct.names()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete script' }))
    await waitFor(() => {
      expect(acct.names()).toEqual(['Rooms'])
    })
    expect(screen.getByRole('list', { name: 'Your scripts' })).toBeTruthy()
  })

  it('keeps code unsaved until Save (or Ctrl+S), and checks the time limit', async () => {
    const acct = account()
    mount({ store: acct.session() })
    await ready()
    await newScript()
    const code = screen.getByRole('textbox', { name: /^Code of/ })
    fireEvent.change(code, { target: { value: 'print(1)\n' } })
    expect(screen.getByText('(unsaved)')).toBeTruthy()
    const limit = screen.getByLabelText('Time limit (seconds)')
    fireEvent.change(limit, { target: { value: '601' } })
    expect(screen.getByText('A whole number of seconds from 1 to 600.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(limit, { target: { value: '5' } })
    fireEvent.keyDown(code, { key: 's', ctrlKey: true })
    await waitFor(() => {
      expect(screen.queryByText('(unsaved)')).toBeNull()
    })
    const stored = parseStoredScripts(acct.stored.get(SCRIPTS_STORAGE_KEY))
    expect(stored.ok && stored.value.scripts[0]).toMatchObject({
      code: 'print(1)\n',
      settings: { timeLimitSeconds: 5, autoPublish: false },
    })
  })
})

describe('two sessions of one login (PD5)', () => {
  it('refuses a save over the other session’s, then reloads theirs or keeps mine', async () => {
    const acct = account()
    mount({ store: acct.session(), label: 'One' })
    mount({ store: acct.session(), label: 'Two' })
    await ready(pane('One'))
    await ready(pane('Two'))
    await newScript(pane('One'))
    // Two still shows the empty list it loaded: its save is based on revision 0.
    fireEvent.click(pane('Two').getByRole('button', { name: 'New script' }))
    await waitFor(() => {
      expect(pane('Two').getByText('Changed in another session')).toBeTruthy()
    })
    expect(acct.names()).toEqual(['Untitled script'])
    fireEvent.click(pane('Two').getByRole('button', { name: 'Keep my change' }))
    await waitFor(() => {
      expect(acct.names()).toEqual(['Untitled script', 'Untitled script (2)'])
    })
    expect(pane('Two').queryByText('Changed in another session')).toBeNull()

    // One is now behind: its rename conflicts, and Reload takes what is stored.
    fireEvent.click(pane('One').getByRole('button', { name: 'Rename…' }))
    fireEvent.change(pane('One').getByLabelText('New name'), { target: { value: 'Mine' } })
    fireEvent.submit(pane('One').getByRole('form', { name: /^Rename/ }))
    await waitFor(() => {
      expect(pane('One').getByText('Changed in another session')).toBeTruthy()
    })
    fireEvent.click(pane('One').getByRole('button', { name: 'Reload' }))
    await waitFor(() => {
      expect(pane('One').getAllByRole('button', { name: /^Untitled script/ })).toHaveLength(2)
    })
    expect(acct.names()).toEqual(['Untitled script', 'Untitled script (2)'])
  })
})

describe('Run and Stop (PY-10, PD9)', () => {
  it('runs the editor’s text with the time limit, shows output live by stream, then the outcome', async () => {
    const { runner } = mount()
    await ready()
    await newScript()
    fireEvent.change(screen.getByRole('textbox', { name: /^Code of/ }), {
      target: { value: 'print("hi")' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(runner.runs).toHaveLength(1)
    })
    const run = runner.runs[0]
    expect(run?.code).toBe('print("hi")')
    expect(run?.options.timeoutMs).toBe(30_000)
    expect(screen.getByText('Running Untitled script… It is stopped after 30 s.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run' }).hasAttribute('disabled')).toBe(true)
    act(() => {
      run?.options.onOutput?.({ stream: 'stdout', text: 'hi' })
      run?.options.onOutput?.({ stream: 'stderr', text: 'warning: careful' })
    })
    const output = screen.getByRole('region', { name: 'Output' })
    expect(output.textContent).toContain('hi')
    expect(within(output).getByText('warning: careful', { exact: false }).className).toContain(
      'stderr',
    )
    act(() => {
      run?.finish({
        status: 'failed',
        error: 'Traceback (most recent call last):\n  File "<exec>", line 1\nNameError: x',
        output: 'hi\nwarning: careful',
        ms: 42,
      })
    })
    await waitFor(() => {
      expect(screen.getByText('Untitled script failed after 42 ms.')).toBeTruthy()
    })
    expect(screen.getByRole('region', { name: 'Error' }).textContent).toContain('NameError: x')
    expect(runner.requests[0]).toEqual({ role: 'white-force' })
  })

  it('stops a run: the worker is told, and the status says so', async () => {
    const { runner } = mount()
    await ready()
    await newScript()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(runner.runs).toHaveLength(1)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => {
      expect(screen.getByText('Untitled script was stopped after 1.2 s.')).toBeTruthy()
    })
    expect(runner.stops()).toBe(1)
  })

  it('tells the admin where a clean run’s draft went, and that nothing is published', async () => {
    const written: WorldState[] = []
    const { runner } = mount({
      role: 'admin',
      writeDraft: (state) => {
        written.push(state)
        const [first] = Object.values(state.assets)
        const before: WorldState =
          first === undefined
            ? state
            : {
                ...state,
                assets: { ...state.assets, [first.id]: { ...first, lat: first.lat + 1 } },
              }
        return { ok: true, diff: diffWorldStates(before, state) }
      },
    })
    await ready()
    await newScript()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => {
      expect(runner.runs).toHaveLength(1)
    })
    // The runner applies the draft (PD9) before the run's outcome arrives.
    act(() => {
      runner.requests[0]?.draft?.apply(sampleWorldState())
      runner.runs[0]?.finish({ status: 'finished', output: '', ms: 10 })
    })
    await waitFor(() => {
      expect(screen.getByText('The world-state draft was updated')).toBeTruthy()
    })
    expect(screen.getByText(/1 asset changed\. Nothing is published\./)).toBeTruthy()
    expect(written).toHaveLength(1)
  })
})

describe('export and import (PY-7, PR1)', () => {
  it('imports a bundle and a .py file as new scripts, running nothing', async () => {
    const acct = account()
    const { runner } = mount({ store: acct.session() })
    await ready()
    const bundle = JSON.stringify({
      format: 'wrx-script-bundle',
      version: 1,
      scripts: [{ name: 'Moves', code: 'print(1)', settings: { timeLimitSeconds: 9 } }],
    })
    const input = screen.getByLabelText('Import scripts from files')
    fireEvent.change(input, {
      target: {
        files: [
          new File([bundle], 'scripts.json', { type: 'application/json' }),
          new File(['print(2)\n'], 'Turns.py', { type: 'text/x-python' }),
        ],
      },
    })
    await waitFor(() => {
      expect(acct.names()).toEqual(['Moves', 'Turns'])
    })
    expect(screen.getAllByText(/Imported 2 scripts\. Nothing was run/).length).toBeGreaterThan(0)
    expect(runner.runs).toHaveLength(0)

    fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.txt')] } })
    await waitFor(() => {
      expect(screen.getByText('Not imported')).toBeTruthy()
    })
    expect(acct.names()).toHaveLength(2)
  })
})

describe('the editor', () => {
  it('indents and dedents the caret’s line or the selected lines by four spaces', () => {
    expect(indent('ab', 1, 1)).toEqual({ value: 'a    b', start: 5, end: 5 })
    const text = 'if x:\nprint(1)\nprint(2)'
    expect(indent(text, 7, 20)).toEqual({
      value: 'if x:\n    print(1)\n    print(2)',
      start: 11,
      end: 28,
    })
    expect(dedent('    a\n  b', 6, 9)).toEqual({ value: '    a\nb', start: 6, end: 7 })
    expect(caretPosition('a\nbc', 4)).toEqual({ line: 2, column: 3 })
  })
})

describe('the admin draft write (ADM-45)', () => {
  it('keeps a held draft’s start, else starts from the published state', () => {
    const storage = memoryWorldDraftStorage()
    const published = sampleWorldState()
    const store = {
      identity: { domain: 'wrx.test' },
      worldState: () => ({ status: 'ready', data: { state: published, stanzaId: 'pub-1' } }),
    } as unknown as SessionStore
    const moved: WorldState = {
      ...published,
      assets: Object.fromEntries(
        Object.entries(published.assets).map(([id, a]) => [id, { ...a, lat: a.lat + 1 }]),
      ),
    }
    const wrote = writeScriptDraft(store, storage, 'map-1', moved, '2026-11-06T10:00:00.000Z')
    expect(wrote.ok && wrote.diff.changed.length).toBe(Object.keys(published.assets).length)
    const text = storage.snapshot(worldDraftKey('wrx.test', 'map-1')).text ?? ''
    const held = parseWorldDraft(text)
    expect(held.ok && held.value.baseStanzaId).toBe('pub-1')
    expect(writeScriptDraft(store, undefined, 'map-1', moved, '').ok).toBe(false)
    expect(writeScriptDraft(store, storage, undefined, moved, '').ok).toBe(false)
  })
})
