// The workspace module (WP 2.5, ARC-9): the only code that imports flexlayout-react. Its public
// API is what this file exports; the FlexLayout adapter (`model.ts`) stays inside, so the library
// can be swapped without touching callers. Importing this module loads the layout's stylesheet.
import 'flexlayout-react/style/light.css'
import './workspace.css'

export { Workspace } from './workspace.tsx'
export type { WorkspaceProps } from './workspace.tsx'
export { WorkspaceCore } from './workspace-core.tsx'
export type { WorkspaceCoreProps, WorkspacePanel, WorkspaceRoom } from './workspace-core.tsx'
export { UnreadBadge } from './tabs.tsx'
export type { RoomTabBadge, RoomTabBadgeProps, UnreadBadgeProps } from './tabs.tsx'
export {
  GameInfoPanel,
  GameInfoPanelCore,
  OnlinePanel,
  OnlinePanelCore,
  RoomPanel,
  RoomPlaceholderCore,
  onlineRoles,
} from './panels.tsx'
export type {
  GameInfoPanelCoreProps,
  OnlineRole,
  RoomPanelProps,
  RoomPlaceholderCoreProps,
} from './panels.tsx'
export { layoutKey, memoryLayoutStorage, webLayoutStorage } from './storage.ts'
export type { LayoutKeyParts, LayoutStorage, StorageLike } from './storage.ts'
