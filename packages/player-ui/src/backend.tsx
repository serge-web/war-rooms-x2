// The backend in use, shown at all times (PLY-1), and the choice between backends on the login
// screen (PLY-20).
import { useId } from 'react'

/** What the badge shows: "MOCK", or the real server's address. */
export type BackendInfo =
  { readonly kind: 'mock' } | { readonly kind: 'xmpp'; readonly address: string }

export function backendLabel(backend: BackendInfo): string {
  return backend.kind === 'mock' ? 'MOCK' : backend.address
}

/** Shows which backend the client is using (PLY-1). */
export function BackendBadge({ backend }: { readonly backend: BackendInfo }) {
  const label = backendLabel(backend)
  return (
    <span
      className="wrx-backend-badge"
      data-backend={backend.kind}
      aria-label={`Backend: ${label}`}
    >
      {label}
    </span>
  )
}

export interface BackendOption {
  readonly id: string
  readonly backend: BackendInfo
  /** One line under the option, e.g. "Runs in this browser; works offline". */
  readonly description: string
}

export interface BackendChoiceCoreProps {
  readonly options: readonly BackendOption[]
  readonly selected: string
  readonly onSelect: (id: string) => void
  readonly disabled?: boolean
}

/** A radio group of backends (PLY-20). Renders nothing when there is only one. */
export function BackendChoiceCore({
  options,
  selected,
  onSelect,
  disabled = false,
}: BackendChoiceCoreProps) {
  const name = useId()
  if (options.length < 2) return null
  return (
    <fieldset className="wrx-backend-choice" disabled={disabled}>
      <legend>Backend</legend>
      {options.map((option) => {
        const label = option.backend.kind === 'mock' ? 'Mock (in this browser)' : 'Real server'
        return (
          <label key={option.id} className="wrx-backend-choice__option">
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={option.id === selected}
              onChange={() => {
                onSelect(option.id)
              }}
            />
            <span>
              <span className="wrx-backend-choice__label">
                {label}
                {option.backend.kind === 'xmpp' ? `: ${option.backend.address}` : ''}
              </span>
              <span className="wrx-backend-choice__description">{option.description}</span>
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}
