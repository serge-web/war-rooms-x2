import type { Meta, StoryObj } from '@storybook/react-vite'
import type { GameSetup } from '@wrx/schemas'
import { AppBarCore } from './player-client.tsx'
import { ForcedLogoutNotice } from './ended.tsx'
import { LoginFormCore } from './login-form.tsx'
import { WelcomePageCore } from './welcome.tsx'

const GAME: GameSetup = {
  schemaVersion: 1,
  name: 'Exercise Northern Gate',
  description: 'A two-sided negotiation exercise.',
  briefing: [
    '## Briefing',
    '',
    'The exercise starts at 09:00. Blue holds the west bank; Red the east.',
    '',
    ...Array.from({ length: 10 }, (_, i) => `${i + 1}. A line of background for the players.`),
  ].join('\n'),
  designVersion: 1,
  theme: { tokens: { primary: '#14532d', background: '#f0fdf4' } },
  roomTypeDefaults: {},
}

const meta: Meta<typeof WelcomePageCore> = {
  title: 'Player/WelcomePageCore',
  component: WelcomePageCore,
  parameters: { layout: 'fullscreen' },
  args: {
    status: 'ready',
    game: GAME,
    header: <AppBarCore backend={{ kind: 'mock' }} />,
    children: (
      <LoginFormCore
        onSubmit={() => undefined}
        demoLogins={[{ roleId: 'blue-co', label: 'Blue CO (Blue)', password: 'demo-blue-co' }]}
      />
    ),
  },
}
export default meta

type Story = StoryObj<typeof WelcomePageCore>

export const Themed: Story = {}
export const Loading: Story = { args: { status: 'loading', game: undefined } }
export const NoGame: Story = { args: { status: 'none', game: undefined } }
export const ServerUnavailable: Story = {
  args: {
    status: 'unavailable',
    game: undefined,
    header: <AppBarCore backend={{ kind: 'xmpp', address: 'wrx.example' }} />,
  },
}
export const AfterForcedLogout: Story = {
  args: { notices: <ForcedLogoutNotice ended={{ reason: 'session-ended' }} /> },
}
