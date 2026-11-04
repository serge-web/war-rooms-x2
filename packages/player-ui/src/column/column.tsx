// The out-of-game column (PLY-36): fixed width, always visible, outside the dockable workspace.
// Top to bottom: the turn panel (PLY-55), the admin panel (PLY-37) and the force panel (PLY-25).
// The shell renders it inside its `Out-of-game column` landmark, or in the narrow-window tab.
import type { ReactNode } from 'react'
import { AnnouncementsPanel } from './announcements.tsx'
import { ForcePanel } from './force-panel.tsx'
import { TurnPanel } from './turn-panel.tsx'

export interface OutOfGameColumnCoreProps {
  readonly turn: ReactNode
  readonly announcements: ReactNode
  readonly force: ReactNode
}

/** Lays the three parts out top to bottom; the announcements take the spare height. */
export function OutOfGameColumnCore({ turn, announcements, force }: OutOfGameColumnCoreProps) {
  return (
    <div className="wrx-column">
      {turn}
      {announcements}
      {force}
    </div>
  )
}

/** The column over the pane's store; needs a SessionStoreProvider. */
export function OutOfGameColumn() {
  return (
    <OutOfGameColumnCore
      turn={<TurnPanel />}
      announcements={<AnnouncementsPanel />}
      force={<ForcePanel />}
    />
  )
}
