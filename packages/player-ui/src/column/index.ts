// The out-of-game column (WP 2.7, PLY-36): the turn panel (PLY-55, WP 5.4), the admin panel with
// announcements (PLY-37, PLY-38, ADM-29) and the force panel with objectives (PLY-25, PLY-35).
// Importing this module loads its stylesheet.
import './column.css'

export {
  AnnouncementsPanel,
  AnnouncementsPanelCore,
  unseenCount,
  useUnseenAnnouncements,
} from './announcements.tsx'
export type { AnnouncementItem, AnnouncementsPanelCoreProps } from './announcements.tsx'
export { OutOfGameColumn, OutOfGameColumnCore } from './column.tsx'
export type { OutOfGameColumnCoreProps } from './column.tsx'
export { TurnPanel, TurnPanelCore, advanceWords, turnLabel } from './turn-panel.tsx'
export type { TurnPanelCoreProps, TurnPanelProps } from './turn-panel.tsx'
export { ForcePanel, ForcePanelCore, ObjectivesEditorCore } from './force-panel.tsx'
export type { ForceOption, ForcePanelCoreProps, ObjectivesEditorCoreProps } from './force-panel.tsx'
