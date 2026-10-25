// The live preview beside the theme controls (ADM-19): the welcome page, a room panel and the
// force panel, each in its own ThemeScope, so each shows its own resolved theme exactly as a
// player's panel would (PLY-26). The room pane renders the real chat panel (WP 2.6) over sample
// messages; the welcome page and force panel are representative stand-ins.
import { byOrderThenId } from '@wrx/domain'
import type { DesignFile } from '@wrx/schemas'
import { resolveTheme } from '@wrx/theme'
import type { ResolvedTheme } from '@wrx/theme'
import { ChatPanelCore } from '@wrx/player-ui/chat'
import type { ChatMessage } from '@wrx/player-ui/chat'
import { AssetImageCore, ThemeScope } from '@wrx/theme/react'
import { useId, useMemo } from 'react'
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
  const sample = useMemo(() => sampleChat(design), [design])

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
          <div className="wrx-preview-chat">
            <ChatPanelCore
              roomName={room?.name ?? 'A room'}
              messages={sample.messages}
              online={sample.online}
              hasOlder={false}
              loadingOlder={false}
              // A preview: nothing is posted anywhere.
              onSend={() => Promise.resolve({ ok: true })}
            />
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

/** Two speakers' sample messages, from the design's first roles and their force colours. */
function sampleChat(design: DesignFile): {
  readonly messages: readonly ChatMessage[]
  readonly online: readonly { id: string; name: string; colour?: string; self: boolean }[]
} {
  const forces = new Map(design.forces.map((f) => [f.id, f]))
  const roles = sortedRoles(design).slice(0, 2)
  const people = [0, 1].map((i) => {
    const role = roles[i]
    const force = role === undefined ? undefined : forces.get(role.forceId)
    return {
      id: role?.id ?? (i === 0 ? 'blue-co' : 'red-co'),
      name: role?.name ?? (i === 0 ? 'Blue CO' : 'Red CO'),
      forceName: force?.name,
      colour: force?.colour,
    }
  })
  const texts = [
    [0, 'Moving to the crossing now.'],
    [0, 'Recce team at the bridge by 09:40.'],
    [1, 'Understood. Holding position.'],
  ] as const
  const messages = texts.map(([who, text], i): ChatMessage => {
    const person = people[who] ?? people[0]
    return {
      id: `preview-${i}`,
      timestamp: `2026-01-15T09:3${i}:00Z`,
      senderKey: person?.id ?? 'x',
      senderName: person?.name ?? '',
      forceName: person?.forceName,
      colour: person?.colour,
      self: false,
      text,
    }
  })
  return {
    messages,
    online: people.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.colour === undefined ? {} : { colour: p.colour }),
      self: false,
    })),
  }
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
