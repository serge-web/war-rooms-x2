// The multi-client view (PLY-16–19, D15): 2, 3 or 4 independent clients on one page, side by side
// or in a grid. Each pane owns its session, store, provider and layout; nothing is shared between
// panes but the backend itself (on the mock, the one mock server of this browser, PLY-17). The
// toolbar sets the pane count and arrangement, and saves and restores named presets (PLY-19).
import { Button } from '@wrx/ui'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import type { BackendInfo } from '../backend.tsx'
import type { DemoLogin } from '../login-form.tsx'
import type { Connection } from '../session.ts'
import { ClientPane } from './pane.tsx'
import { withPreset } from './presets.ts'
import type { MultiPreset, PaneArrangement, PaneCount, PaneKind, PresetStorage } from './presets.ts'

export interface MultiClientViewProps {
  readonly connection: Connection
  readonly backend: BackendInfo
  /** Mock only: quick logins for the panes (PLY-18). */
  readonly demoLogins?: readonly DemoLogin[] | undefined
  /** Each pane's workspace; the same element renders a separate workspace in each pane. */
  readonly workspace?: ReactNode
  /** The admin backend, for panes that show it instead of a player client. */
  readonly renderAdmin?: (() => ReactNode) | undefined
  /** Where named presets are kept (PLY-19); without it, presets are not offered. */
  readonly presets?: PresetStorage | undefined
  /** Above the toolbar, e.g. the app bar. */
  readonly header?: ReactNode
  /** Extra toolbar items, e.g. the backend choice (PLY-20). */
  readonly toolbarItems?: ReactNode
  /** The mock's database controls (PLY-21), on the mock only. */
  readonly mockControls?: ReactNode
  readonly initialCount?: PaneCount
}

interface PaneState {
  /** A new key remounts the pane: a fresh session, store and layout. */
  readonly key: number
  readonly kind: PaneKind
  readonly roleId: string | undefined
  /** From a preset: the role to log in as when the pane mounts. */
  readonly autoLogin: string | undefined
}

interface ViewState {
  readonly count: PaneCount
  readonly arrangement: PaneArrangement
  readonly panes: readonly PaneState[]
  readonly nextKey: number
}

const COUNTS: readonly PaneCount[] = Object.freeze([2, 3, 4] as const)

function defaultArrangement(count: PaneCount): PaneArrangement {
  return count === 4 ? 'grid' : 'row'
}

function freshPanes(
  from: number,
  setups: readonly { readonly kind: PaneKind; readonly roleId?: string | undefined }[],
): PaneState[] {
  return setups.map((setup, i) => ({
    key: from + i,
    kind: setup.kind,
    roleId: undefined,
    autoLogin: setup.roleId,
  }))
}

function initialState(count: PaneCount): ViewState {
  return {
    count,
    arrangement: defaultArrangement(count),
    panes: freshPanes(
      0,
      Array.from({ length: count }, () => ({ kind: 'player' as const })),
    ),
    nextKey: count,
  }
}

/** Changes the pane count, keeping the panes that stay (and their sessions). */
function withCount(state: ViewState, count: PaneCount): ViewState {
  if (count === state.count) return state
  const kept = state.panes.slice(0, count)
  const added = freshPanes(
    state.nextKey,
    Array.from({ length: count - kept.length }, () => ({ kind: 'player' as const })),
  )
  return {
    count,
    arrangement: defaultArrangement(count),
    panes: [...kept, ...added],
    nextKey: state.nextKey + added.length,
  }
}

function fromPreset(state: ViewState, preset: MultiPreset): ViewState {
  return {
    count: preset.count,
    arrangement: preset.arrangement,
    panes: freshPanes(state.nextKey, preset.panes),
    nextKey: state.nextKey + preset.panes.length,
  }
}

export function MultiClientView({
  connection,
  backend,
  demoLogins,
  workspace,
  renderAdmin,
  presets,
  header,
  toolbarItems,
  mockControls,
  initialCount = 2,
}: MultiClientViewProps) {
  const [state, setState] = useState(() => initialState(initialCount))
  const ids = useId()

  const updatePane = (key: number, change: (pane: PaneState) => PaneState) => {
    setState((s) => ({ ...s, panes: s.panes.map((p) => (p.key === key ? change(p) : p)) }))
  }

  return (
    <div className="wrx-multi">
      {header}
      <div className="wrx-multi__toolbar" role="toolbar" aria-label="Multi-client view">
        <h2 className="wrx-multi__title">Multi-client view</h2>
        <fieldset className="wrx-multi__choice">
          <legend>Panes</legend>
          {COUNTS.map((count) => (
            <label key={count}>
              <input
                type="radio"
                name={`${ids}-count`}
                checked={state.count === count}
                onChange={() => {
                  setState((s) => withCount(s, count))
                }}
              />
              {count}
            </label>
          ))}
        </fieldset>
        <fieldset className="wrx-multi__choice">
          <legend>Arrangement</legend>
          {(['row', 'grid'] as const).map((arrangement) => (
            <label key={arrangement}>
              <input
                type="radio"
                name={`${ids}-arrangement`}
                checked={state.arrangement === arrangement}
                onChange={() => {
                  setState((s) => ({ ...s, arrangement }))
                }}
              />
              {arrangement === 'row' ? 'Side by side' : 'Grid'}
            </label>
          ))}
        </fieldset>
        {presets === undefined ? null : (
          <PresetControls
            storage={presets}
            current={() => ({
              count: state.count,
              arrangement: state.arrangement,
              panes: state.panes.slice(0, state.count).map((p) => ({
                kind: p.kind,
                ...(p.kind === 'player' && p.roleId !== undefined ? { roleId: p.roleId } : {}),
              })),
            })}
            onLoad={(preset) => {
              setState((s) => fromPreset(s, preset))
            }}
          />
        )}
        {toolbarItems}
        {mockControls}
      </div>
      <div
        className="wrx-multi__panes"
        data-arrangement={state.arrangement}
        data-count={state.count}
      >
        {state.panes.slice(0, state.count).map((pane, i) => (
          <ClientPane
            key={pane.key}
            number={i + 1}
            kind={pane.kind}
            onKindChange={(kind) => {
              updatePane(pane.key, (p) => ({ ...p, kind, roleId: undefined, autoLogin: undefined }))
            }}
            connection={connection}
            backend={backend}
            demoLogins={demoLogins}
            workspace={workspace}
            renderAdmin={renderAdmin}
            autoLogin={pane.autoLogin}
            onLogin={(roleId) => {
              updatePane(pane.key, (p) => (p.roleId === roleId ? p : { ...p, roleId }))
            }}
          />
        ))}
      </div>
    </div>
  )
}

function PresetControls({
  storage,
  current,
  onLoad,
}: {
  readonly storage: PresetStorage
  readonly current: () => Omit<MultiPreset, 'name'>
  readonly onLoad: (preset: MultiPreset) => void
}) {
  const id = useId()
  const [saved, setSaved] = useState(() => storage.load())
  const [chosen, setChosen] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | undefined>(undefined)
  const selected = saved.find((p) => p.name === chosen) ?? saved[0]

  const store = (next: readonly MultiPreset[], done: string) => {
    if (storage.save(next)) {
      setSaved(next)
      setMessage(done)
    } else {
      setMessage('This browser would not save presets.')
    }
  }

  return (
    <div className="wrx-multi__presets" role="group" aria-label="Presets">
      <form
        className="wrx-multi__preset-save"
        onSubmit={(event) => {
          event.preventDefault()
          const trimmed = name.trim()
          if (trimmed === '') return
          store(withPreset(saved, { name: trimmed, ...current() }), `Saved preset “${trimmed}”.`)
          setChosen(trimmed)
          setName('')
        }}
      >
        <label htmlFor={`${id}-name`}>Preset name</label>
        <input
          id={`${id}-name`}
          className="wrx-multi__input"
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
        <Button size="small" type="submit" disabled={name.trim() === ''}>
          Save preset
        </Button>
      </form>
      {saved.length === 0 ? null : (
        <div className="wrx-multi__preset-load">
          <label htmlFor={`${id}-saved`}>Saved presets</label>
          <select
            id={`${id}-saved`}
            className="wrx-multi__input"
            value={selected?.name ?? ''}
            onChange={(event) => {
              setChosen(event.target.value)
            }}
          >
            {saved.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
          <Button
            size="small"
            onClick={() => {
              if (selected === undefined) return
              onLoad(selected)
              setMessage(`Restored preset “${selected.name}”.`)
            }}
          >
            Restore
          </Button>
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              if (selected === undefined) return
              store(
                saved.filter((p) => p.name !== selected.name),
                `Deleted preset “${selected.name}”.`,
              )
              setChosen('')
            }}
          >
            Delete
          </Button>
        </div>
      )}
      <span className="wrx-multi__preset-status" role="status">
        {message}
      </span>
    </div>
  )
}
