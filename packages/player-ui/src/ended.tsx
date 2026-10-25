// The explanation after a forced logout (PLY-29, PLY-50): the admin ended the session, removed
// the account or deleted the role, or the connection could not be restored.
import { Banner } from '@wrx/ui'
import type { EndedSession } from './session.ts'

export interface Explanation {
  readonly title: string
  readonly body: string
}

export function endedExplanation(reason: EndedSession['reason']): Explanation {
  switch (reason) {
    case 'session-ended':
      return {
        title: 'Your session was ended',
        body: 'The admin ended your session. You can log in again.',
      }
    case 'account-removed':
      return {
        title: 'Your login was removed',
        body: "The admin removed this role's login. Ask the admin before logging in again.",
      }
    case 'deleted':
      return {
        title: 'Your role was deleted',
        body: 'The admin deleted your role from the game, so you have been logged out.',
      }
    case 'auth-failed':
      return {
        title: 'Your login was refused',
        body: 'The server no longer accepts this role id and password.',
      }
    case 'unreachable':
      return {
        title: 'The connection was lost',
        body: 'The client could not reconnect to the server. Log in again once it is back.',
      }
  }
}

export interface ForcedLogoutNoticeProps {
  readonly ended: EndedSession
  readonly onDismiss?: () => void
}

/** A banner explaining a forced logout, shown on the login page. */
export function ForcedLogoutNotice({ ended, onDismiss }: ForcedLogoutNoticeProps) {
  const { title, body } = endedExplanation(ended.reason)
  return (
    <Banner tone="warning" title={title} onDismiss={onDismiss}>
      {body}
    </Banner>
  )
}
