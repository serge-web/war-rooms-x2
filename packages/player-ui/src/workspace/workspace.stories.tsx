import type { Meta, StoryObj } from '@storybook/react-vite'
import { GameInfoPanelCore, OnlinePanelCore, RoomPlaceholderCore } from './panels.tsx'
import { UnreadBadge } from './tabs.tsx'
import type { RoomTabBadgeProps } from './tabs.tsx'
import { WorkspaceCore } from './workspace-core.tsx'
import type { WorkspaceRoom } from './workspace-core.tsx'
import './workspace.css'
import 'flexlayout-react/style/light.css'

const ROOMS: readonly WorkspaceRoom[] = [
  { id: 'blue-hq', name: 'Blue HQ' },
  { id: 'red-hq', name: 'Red HQ' },
  { id: 'negotiation', name: 'Blue–Red negotiation' },
  { id: 'press', name: 'Press briefing' },
]

const UNREAD: Readonly<Record<string, number>> = Object.freeze({ 'red-hq': 3, press: 128 })

function Badge({ roomId }: RoomTabBadgeProps) {
  return <UnreadBadge count={UNREAD[roomId] ?? 0} />
}

const meta: Meta<typeof WorkspaceCore> = {
  title: 'Player/WorkspaceCore',
  component: WorkspaceCore,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div style={{ height: '36rem', padding: '1rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    rooms: ROOMS,
    renderRoom: (roomId: string) => (
      <RoomPlaceholderCore
        name={ROOMS.find((r) => r.id === roomId)?.name ?? roomId}
        typeLabel="Chat"
        access="write"
      />
    ),
    panels: [
      {
        id: 'game-info',
        name: 'Game info',
        content: (
          <GameInfoPanelCore
            name="Exercise Northern Gate"
            description="A two-sided negotiation exercise."
            briefing={'## Briefing\n\nThe exercise starts at 09:00.'}
          />
        ),
      },
      {
        id: 'online',
        name: 'Online',
        content: (
          <OnlinePanelCore
            roles={[
              { id: 'blue-co', name: 'Blue CO', forceName: 'Blue', colour: '#1d4ed8', self: true },
              { id: 'red-co', name: 'Red CO', forceName: 'Red', colour: '#b91c1c', self: false },
            ]}
          />
        ),
      },
    ],
    tabBadge: Badge,
  },
}
export default meta

type Story = StoryObj<typeof WorkspaceCore>

export const FourRooms: Story = {}
export const OneRoom: Story = { args: { rooms: ROOMS.slice(0, 1) } }
export const NoRooms: Story = {
  args: {
    rooms: [],
    emptyState: <p className="wrx-empty">Your role has no rooms yet.</p>,
  },
}
