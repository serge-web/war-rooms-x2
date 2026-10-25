// The out-of-game column (PLY-36): fixed width, always visible, outside the dockable workspace.
// Top to bottom: the reserved game-time area (empty in v1, D7), the admin panel (PLY-37) and the
// force panel (PLY-25). The shell renders it inside its `Out-of-game column` landmark.
import type { ReactNode } from 'react'
import { AnnouncementsPanel } from './announcements.tsx'
import { ForcePanel } from './force-panel.tsx'

/** The game time and turn slot, reserved for the turn model (D7, §8). */
export function GameTimeSlot() {
  return (
    <section className="wrx-column__section wrx-column__time" aria-label="Game time">
      <p className="wrx-column__reserved">Game time and turn: not used in this version.</p>
    </section>
  )
}

export interface OutOfGameColumnCoreProps {
  readonly time?: ReactNode
  readonly announcements: ReactNode
  readonly force: ReactNode
}

/** Lays the three parts out top to bottom; the announcements take the spare height. */
export function OutOfGameColumnCore({
  time = <GameTimeSlot />,
  announcements,
  force,
}: OutOfGameColumnCoreProps) {
  return (
    <div className="wrx-column">
      {time}
      {announcements}
      {force}
    </div>
  )
}

/** The column over the pane's store; needs a SessionStoreProvider. */
export function OutOfGameColumn() {
  return <OutOfGameColumnCore announcements={<AnnouncementsPanel />} force={<ForcePanel />} />
}
