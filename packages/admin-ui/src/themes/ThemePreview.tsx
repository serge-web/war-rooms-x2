// The live preview beside the theme controls (ADM-19): the welcome page, a room panel and the
// force panel, each in its own ThemeScope, so each shows its own resolved theme exactly as a
// player's panel would (PLY-26). Representative stand-ins: WP 2.4 and 2.6 build the real ones.
import { byOrderThenId } from '@wrx/domain'
import type { DesignFile } from '@wrx/schemas'
import { resolveTheme } from '@wrx/theme'
import type { ResolvedTheme } from '@wrx/theme'
import { AssetImageCore, ThemeScope } from '@wrx/theme/react'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { MarkdownView } from '../components/index.ts'
import { objectivesOf, sortedRoles } from '../draft/index.ts'
import { assetById } from './themeDraft.ts'
import type { ThemeTarget } from './themeDraft.ts'

export interface ThemePreviewProps {
  readonly design: DesignFile
  /** The theme being edited; its pane is marked, and a force or room target is the one shown. */
  readonly target: ThemeTarget
}

export function ThemePreview({ design, target }: ThemePreviewProps) {
  const game = resolveTheme(design.game.theme)
  const force =
    target.kind === 'force'
      ? design.forces.find((f) => f.id === target.id)
      : [...design.forces].sort(byOrderThenId)[0]
  const room =
    target.kind === 'room'
      ? design.rooms.find((r) => r.id === target.id)
      : [...design.rooms].sort(byOrderThenId)[0]
  const forceTheme = resolveTheme(force?.theme, design.game.theme)
  const roomTheme = resolveTheme(room?.theme, design.game.theme)
  const image = (theme: ResolvedTheme, which: 'logo' | 'icon', alt: string, className: string) => (
    <AssetImageCore
      asset={assetById(design, which === 'logo' ? theme.logoAssetId : theme.iconAssetId)}
      alt={alt}
      className={className}
    />
  )
  const gameName = design.game.name.trim() === '' ? 'Untitled game' : design.game.name
  const roles = force === undefined ? [] : sortedRoles(design).filter((r) => r.forceId === force.id)
  const objectives = force === undefined ? undefined : objectivesOf(design, force.id)
  const forces = new Map(design.forces.map((f) => [f.id, f]))
  const speakers = sortedRoles(design).slice(0, 2)

  return (
    <div className="wrx-theme-preview" aria-label="Live preview" role="group">
      <Pane caption="Welcome page" editing={target.kind === 'game'} tokens={game}>
        <div className="wrx-preview-welcome">
          {image(game, 'logo', `${gameName} logo`, 'wrx-preview-logo')}
          <p className="wrx-preview-title">{gameName}</p>
          {design.game.description.trim() !== '' && (
            <p className="wrx-preview-muted">{design.game.description}</p>
          )}
          <div className="wrx-preview-card">
            <MarkdownView markdown={design.game.briefing} empty="No briefing yet." />
          </div>
          <div className="wrx-preview-card wrx-preview-login" aria-hidden="true">
            <span className="wrx-preview-field">Role id</span>
            <span className="wrx-preview-field">Password</span>
            <span className="wrx-preview-button">Log in</span>
          </div>
        </div>
      </Pane>

      <Pane
        caption={room === undefined ? 'Room panel' : `Room panel: ${room.name}`}
        editing={target.kind === 'room'}
        tokens={roomTheme}
      >
        <div className="wrx-preview-panel">
          <div className="wrx-preview-bar">
            {image(roomTheme, 'icon', '', 'wrx-preview-icon')}
            <span>{room?.name ?? 'A room'}</span>
          </div>
          <ul className="wrx-preview-messages">
            {(speakers.length > 0 ? speakers : [undefined, undefined]).map((role, i) => (
              <li key={role?.id ?? i}>
                <span
                  className="wrx-preview-author"
                  style={{
                    color: role === undefined ? undefined : forces.get(role.forceId)?.colour,
                  }}
                >
                  {role?.name ?? (i === 0 ? 'Blue CO' : 'Red CO')}
                </span>{' '}
                <span className="wrx-preview-muted">09:3{i}</span>
                <p>{i === 0 ? 'Moving to the crossing now.' : 'Understood. Holding position.'}</p>
              </li>
            ))}
          </ul>
          <div className="wrx-preview-composer" aria-hidden="true">
            <span className="wrx-preview-field">Write a message</span>
            <span className="wrx-preview-button">Send</span>
          </div>
        </div>
      </Pane>

      <Pane
        caption={force === undefined ? 'Force panel' : `Force panel: ${force.name}`}
        editing={target.kind === 'force'}
        tokens={forceTheme}
      >
        <div className="wrx-preview-panel">
          <div className="wrx-preview-bar">
            {image(forceTheme, 'icon', '', 'wrx-preview-icon')}
            <span>{force?.name ?? 'A force'}</span>
          </div>
          <div className="wrx-preview-body">
            {image(forceTheme, 'logo', `${force?.name ?? 'Force'} logo`, 'wrx-preview-logo')}
            <p className="wrx-preview-muted">
              Role: {roles[0]?.name ?? 'Commanding officer'}
              {roles.length > 1 ? ` (and ${roles.length - 1} more)` : ''}
            </p>
            <p className="wrx-preview-heading">Objectives</p>
            <div className="wrx-preview-card">
              <MarkdownView markdown={objectives?.markdown ?? ''} empty="No objectives yet." />
            </div>
          </div>
        </div>
      </Pane>
    </div>
  )
}

function Pane({
  caption,
  editing,
  tokens,
  children,
}: {
  readonly caption: string
  readonly editing: boolean
  readonly tokens: ResolvedTheme
  readonly children: ReactNode
}) {
  const id = useId()
  return (
    <figure className="wrx-theme-preview-pane" aria-labelledby={id}>
      <figcaption id={id}>
        {caption}
        {editing && <span className="wrx-theme-preview-editing"> (editing)</span>}
      </figcaption>
      <ThemeScope tokens={tokens.tokens} className="wrx-theme-preview-scope">
        {children}
      </ThemeScope>
    </figure>
  )
}
