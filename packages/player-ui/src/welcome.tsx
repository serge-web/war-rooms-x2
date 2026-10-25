// The welcome page (PLY-27, PLY-46, PLY-47): styled by the game theme, it shows the logo, name
// and description, then the briefing in a fixed-height scrolling box, then the login form. With
// no game, or no server answer, it falls back to the default theme and still allows login.
import type { SessionStore } from '@wrx/domain'
import type { GameSetup } from '@wrx/schemas'
import { MarkdownView, Spinner, ThemeScope } from '@wrx/ui'
import type { ReactNode } from 'react'
import { assetUrl, useWelcomeData } from './welcome-data.ts'
import type { WelcomeStatus } from './welcome-data.ts'

export interface WelcomePageCoreProps {
  readonly status: WelcomeStatus
  readonly game: GameSetup | undefined
  /** A `data:` URL for the logo. */
  readonly logoSrc?: string | undefined
  /** The app bar: product name and backend badge (PLY-1). */
  readonly header: ReactNode
  /** Banners above the page, e.g. why the player was logged out (PLY-29, PLY-50). */
  readonly notices?: ReactNode
  /** The login form; it stays below the briefing and in view (PLY-47). */
  readonly children: ReactNode
}

export function WelcomePageCore({
  status,
  game,
  logoSrc,
  header,
  notices,
  children,
}: WelcomePageCoreProps) {
  return (
    <ThemeScope tokens={game?.theme.tokens} className="wrx-welcome">
      {header}
      <main className="wrx-welcome__main">
        {notices === undefined ? null : <div className="wrx-welcome__notices">{notices}</div>}
        <article className="wrx-welcome__card" aria-busy={status === 'loading' || undefined}>
          {status === 'loading' ? (
            <div className="wrx-welcome__loading">
              <Spinner label="Loading the game" />
            </div>
          ) : game === undefined ? (
            <div className="wrx-welcome__intro">
              <h2 className="wrx-welcome__name">Welcome</h2>
              <p className="wrx-welcome__empty" role="status">
                {status === 'unavailable'
                  ? 'The game details could not be loaded from the server. You can still log in.'
                  : 'No game has been published yet. You can still log in.'}
              </p>
            </div>
          ) : (
            <div className="wrx-welcome__intro">
              {logoSrc === undefined ? null : (
                <img className="wrx-welcome__logo" src={logoSrc} alt={`${game.name} logo`} />
              )}
              <h2 className="wrx-welcome__name">{game.name}</h2>
              {game.description === '' ? null : (
                <p className="wrx-welcome__description">{game.description}</p>
              )}
              {game.briefing.trim() === '' ? null : (
                <MarkdownView
                  className="wrx-welcome__briefing"
                  markdown={game.briefing}
                  label="Briefing"
                  maxHeight="clamp(8rem, 30vh, 16rem)"
                />
              )}
            </div>
          )}
          <div className="wrx-welcome__login">{children}</div>
        </article>
      </main>
    </ThemeScope>
  )
}

export interface WelcomePageProps extends Omit<
  WelcomePageCoreProps,
  'status' | 'game' | 'logoSrc'
> {
  /** The anonymous store (D20), once connected. */
  readonly store: SessionStore | undefined
  /** True while the anonymous session is still connecting. */
  readonly pending: boolean
}

/** The welcome page over an anonymous store. */
export function WelcomePage({ store, pending, ...rest }: WelcomePageProps) {
  const data = useWelcomeData(store, pending)
  return (
    <WelcomePageCore
      {...rest}
      status={data.status}
      game={data.game}
      logoSrc={data.logo === undefined ? undefined : assetUrl(data.logo)}
    />
  )
}
