import type { Meta, StoryObj } from '@storybook/react-vite'
import { BackendBadge } from './backend.tsx'
import { OutOfGameColumnPlaceholder, RoomListCore, ShellCore } from './shell.tsx'

const meta: Meta<typeof ShellCore> = {
  title: 'Player/ShellCore',
  component: ShellCore,
  parameters: { layout: 'fullscreen' },
  args: {
    status: { state: 'ready' },
    game: 'ready',
    gameName: 'Exercise Northern Gate',
    role: { name: 'Blue CO', forceName: 'Blue', forceColour: '#60a5fa' },
    backend: <BackendBadge backend={{ kind: 'mock' }} />,
    onLogout: () => undefined,
    workspace: (
      <RoomListCore
        rooms={[
          { id: 'blue-hq', name: 'Blue HQ', access: 'write' },
          { id: 'negotiation', name: 'Blue–Red negotiation', access: 'write' },
          { id: 'press', name: 'Press briefing', access: 'read' },
        ]}
      />
    ),
    column: <OutOfGameColumnPlaceholder />,
  },
}
export default meta

type Story = StoryObj<typeof ShellCore>

export const Ready: Story = {}
export const Starting: Story = { args: { status: { state: 'starting' } } }
export const Reconnecting: Story = { args: { status: { state: 'reconnecting', attempt: 2 } } }
export const NoGame: Story = { args: { game: 'none', gameName: undefined } }
export const NoRooms: Story = { args: { workspace: <RoomListCore rooms={[]} /> } }
export const RealServer: Story = {
  args: { backend: <BackendBadge backend={{ kind: 'xmpp', address: 'wrx.example' }} /> },
}
