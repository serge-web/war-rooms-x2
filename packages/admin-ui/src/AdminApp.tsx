// The admin backend's screen (ADM-27, ADM-28): a header with the admin / game view toggle, a
// left-hand menu of sections, and the selected section's list and edit form. `AdminApp` wires
// the draft store and `useDesignAccess`; `AdminAppCore` takes plain props (NFR-18).
import type { AccessMatrix } from '@wrx/domain'
import { useDesignAccess } from '@wrx/hooks'
import type { ReactRoomTypeRegistry } from '@wrx/hooks'
import { useState } from 'react'
import { Button, Notice } from './components/index.ts'
import type { Draft, DraftStore, DraftValidation } from './draft/index.ts'
import { AccessSectionCore } from './sections/AccessSection.tsx'
import { ForcesSectionCore } from './sections/ForcesSection.tsx'
import { GameSectionCore } from './sections/GameSection.tsx'
import { RolesSectionCore } from './sections/RolesSection.tsx'
import { RoomsSectionCore } from './sections/RoomsSection.tsx'
import { ThemesSectionCore } from './sections/ThemesSection.tsx'
import type { ThemesSlot } from './sections/ThemesSection.tsx'
import { useDraft, useDraftValidation } from './useDraft.ts'
import './admin.css'

export const ADMIN_SECTIONS = Object.freeze([
  'game',
  'forces',
  'roles',
  'rooms',
  'themes',
  'access',
] as const)
export type AdminSection = (typeof ADMIN_SECTIONS)[number]

const SECTION_LABEL: Readonly<Record<AdminSection, string>> = Object.freeze({
  game: 'Game',
  forces: 'Forces',
  roles: 'Roles',
  rooms: 'Rooms',
  themes: 'Themes',
  access: 'Access matrix',
})

/** The issue paths that belong to each section, for the menu's counts. */
const SECTION_PATHS: Readonly<Record<AdminSection, readonly string[]>> = Object.freeze({
  game: ['game'],
  forces: ['forces', 'objectives'],
  roles: ['roles'],
  rooms: ['rooms'],
  themes: ['assets'],
  access: [],
})

export interface AdminAppProps {
  /** The draft being edited; the host keys its storage by server (see `createBrowserDraftStore`). */
  readonly store: DraftStore
  /** The room-type registry, with admin editor slots filled where a type has settings (ADM-7). */
  readonly registry: ReactRoomTypeRegistry
  /** Shows the game view (ADM-28). Without it, the toggle is not shown. */
  readonly onSwitchToGame?: () => void
  /** WP 2.8's themes editor; until then the section is an empty slot. */
  readonly themes?: ThemesSlot
  readonly initialSection?: AdminSection
  /** The clock for objectives' `updatedAt`. */
  readonly now?: () => Date
}

export function AdminApp({ store, registry, ...rest }: AdminAppProps) {
  const snapshot = useDraft(store)
  const validation = useDraftValidation(snapshot.draft, registry)
  const matrix = useDesignAccess(snapshot.draft.design)
  return (
    <AdminAppCore
      draft={snapshot.draft}
      loadError={snapshot.loadError}
      saveError={snapshot.saveError}
      validation={validation}
      matrix={matrix}
      registry={registry}
      onChange={store.commit}
      {...rest}
    />
  )
}

export interface AdminAppCoreProps extends Omit<AdminAppProps, 'store'> {
  readonly draft: Draft
  readonly validation: DraftValidation
  readonly matrix: AccessMatrix
  readonly onChange: (next: Draft) => void
  readonly loadError?: string | undefined
  readonly saveError?: string | undefined
}

export function AdminAppCore({
  draft,
  validation,
  matrix,
  registry,
  onChange,
  loadError,
  saveError,
  onSwitchToGame,
  themes,
  initialSection = 'game',
  now,
}: AdminAppCoreProps) {
  const [section, setSection] = useState<AdminSection>(initialSection)
  const props = { draft, validation, onChange }
  const gameName = draft.design.game.name.trim() === '' ? 'Untitled game' : draft.design.game.name

  return (
    <div className="wrx-admin">
      <header className="wrx-admin-header">
        <div className="wrx-admin-title">
          <h1>{gameName}</h1>
          <span className="wrx-admin-subtitle">Admin: game design draft</span>
        </div>
        <p className="wrx-admin-save" role="status">
          {saveError === undefined
            ? 'Draft saved in this browser.'
            : `The draft could not be saved: ${saveError}`}
        </p>
        {onSwitchToGame !== undefined && (
          <div className="wrx-admin-toggle" role="group" aria-label="View">
            <Button aria-pressed="true" className="is-active">
              Admin
            </Button>
            <Button aria-pressed="false" onClick={onSwitchToGame}>
              Game
            </Button>
          </div>
        )}
      </header>
      <div className="wrx-admin-body">
        <nav className="wrx-admin-nav" aria-label="Admin sections">
          <ul>
            {ADMIN_SECTIONS.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  className="wrx-admin-nav-item"
                  aria-current={section === id ? 'page' : undefined}
                  onClick={() => {
                    setSection(id)
                  }}
                >
                  {SECTION_LABEL[id]}
                  <IssueBadge
                    validation={validation}
                    paths={SECTION_PATHS[id]}
                    all={id === 'access'}
                  />
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="wrx-admin-main">
          {loadError !== undefined && (
            <Notice tone="error" title="The saved draft could not be read.">
              A new draft was started; the old one is replaced at the first change. ({loadError})
            </Notice>
          )}
          {section === 'game' && <GameSectionCore {...props} />}
          {section === 'forces' && <ForcesSectionCore {...props} {...(now ? { now } : {})} />}
          {section === 'roles' && <RolesSectionCore {...props} />}
          {section === 'rooms' && <RoomsSectionCore {...props} registry={registry} />}
          {section === 'themes' && <ThemesSectionCore {...props} slot={themes} />}
          {section === 'access' && (
            <AccessSectionCore matrix={matrix} design={draft.design} validation={validation} />
          )}
        </main>
      </div>
    </div>
  )
}

function IssueBadge({
  validation,
  paths,
  all,
}: {
  readonly validation: DraftValidation
  readonly paths: readonly string[]
  readonly all: boolean
}) {
  const issues = all ? validation.issues : paths.flatMap((p) => validation.at(p))
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  if (issues.length === 0) return null
  const [count, word, tone] =
    errors > 0 ? [errors, 'error', 'error'] : [warnings, 'warning', 'warning']
  return (
    <span className={`wrx-admin-badge wrx-admin-badge-${tone}`}>
      {count}
      <span className="wrx-admin-visually-hidden">
        {' '}
        {word}
        {count === 1 ? '' : 's'}
      </span>
    </span>
  )
}
