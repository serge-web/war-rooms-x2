import type { Meta, StoryObj } from '@storybook/react-vite'
import { BackendChoiceCore } from './backend.tsx'
import { LoginFormCore } from './login-form.tsx'

const meta: Meta<typeof LoginFormCore> = {
  title: 'Player/LoginFormCore',
  component: LoginFormCore,
  args: { onSubmit: () => undefined },
}
export default meta

type Story = StoryObj<typeof LoginFormCore>

export const RealServer: Story = {}
export const MockWithDemoLogins: Story = {
  args: {
    demoLogins: [
      { roleId: 'blue-co', label: 'Blue CO (Blue)', password: 'demo-blue-co' },
      { roleId: 'red-co', label: 'Red CO (Red)', password: 'demo-red-co' },
    ],
  },
}
export const WithBackendChoice: Story = {
  args: {
    before: (
      <BackendChoiceCore
        options={[
          {
            id: 'server',
            backend: { kind: 'xmpp', address: 'Exercise server' },
            description: 'The game server at wrx.example.',
          },
          { id: 'mock', backend: { kind: 'mock' }, description: 'Runs in this browser.' },
        ]}
        selected="server"
        onSelect={() => undefined}
      />
    ),
  },
}
export const Refused: Story = { args: { error: 'Wrong role id or password.' } }
export const Busy: Story = { args: { busy: true } }
