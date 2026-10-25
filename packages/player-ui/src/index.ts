// @wrx/player-ui: the player client (WP 2.4; 2.5 the workspace, 2.6 chat, 2.7 the out-of-game
// column). `*Core` components take plain props; their wrappers read @wrx/hooks
// (NFR-18). Importing this module loads its stylesheet.
import './player.css'

export { BackendBadge, BackendChoiceCore, backendLabel } from './backend.tsx'
export type { BackendChoiceCoreProps, BackendInfo, BackendOption } from './backend.tsx'
export { ForcedLogoutNotice, endedExplanation } from './ended.tsx'
export type { Explanation, ForcedLogoutNoticeProps } from './ended.tsx'
export { LoginFormCore } from './login-form.tsx'
export type { DemoLogin, LoginFormCoreProps } from './login-form.tsx'
export { AppBarCore, PlayerClient } from './player-client.tsx'
export type { PlayerClientProps } from './player-client.tsx'
export { loginErrorMessage, useAnonymousStore, usePlayerSession } from './session.ts'
export type {
  AnonymousOptions,
  AnonymousState,
  Connection,
  EndedSession,
  PlayerSession,
  PlayerSessionState,
  SessionOptions,
} from './session.ts'
export {
  ConnectionIndicatorCore,
  NoGameCore,
  OutOfGameColumnPlaceholder,
  RoomList,
  RoomListCore,
  Shell,
  ShellCore,
} from './shell.tsx'
export type { RoomSummary, ShellCoreProps, ShellProps, ShellRole } from './shell.tsx'
export { WelcomePage, WelcomePageCore } from './welcome.tsx'
export type { WelcomePageCoreProps, WelcomePageProps } from './welcome.tsx'
export { assetUrl, useWelcomeData } from './welcome-data.ts'
export type { WelcomeData, WelcomeStatus } from './welcome-data.ts'
export * from './workspace/index.ts'
