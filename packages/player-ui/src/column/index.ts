// The out-of-game column (WP 2.7, PLY-36): the reserved game-time slot, the admin panel with
// announcements (PLY-37, PLY-38, ADM-29) and the force panel with objectives (PLY-25, PLY-35).
// Importing this module loads its stylesheet.
import './column.css'

export { AnnouncementsPanel, AnnouncementsPanelCore } from './announcements.tsx'
export type { AnnouncementItem, AnnouncementsPanelCoreProps } from './announcements.tsx'
export { GameTimeSlot, OutOfGameColumn, OutOfGameColumnCore } from './column.tsx'
export type { OutOfGameColumnCoreProps } from './column.tsx'
export { ForcePanel, ForcePanelCore, ObjectivesEditorCore } from './force-panel.tsx'
export type { ForceOption, ForcePanelCoreProps, ObjectivesEditorCoreProps } from './force-panel.tsx'
