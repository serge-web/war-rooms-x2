// @wrx/player-ui: the player client (WP 2.4; 2.5 the workspace, 2.6 chat, 2.7 the out-of-game
// column, 2.9 the multi-client view and the admin's preview as a role). `*Core` components take
// plain props; their wrappers read @wrx/hooks (NFR-18). Importing this module loads its stylesheet.
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
export * from './column/index.ts'
export * from './multi/index.ts'
export { AdminGameView, PreviewSelectorCore } from './preview/admin-game-view.tsx'
export type { PreviewRoleOption, PreviewSelectorCoreProps } from './preview/admin-game-view.tsx'
export { previewAsRole } from './preview/preview-store.ts'
export * from './workspace/index.ts'
export * from './chat/index.ts'
