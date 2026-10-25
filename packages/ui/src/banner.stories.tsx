import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from './banner.tsx'
import { Button } from './button.tsx'

const meta: Meta<typeof Banner> = {
  title: 'UI/Banner',
  component: Banner,
  args: { title: 'Reconnecting…', children: 'The connection to the server dropped.' },
}
export default meta

type Story = StoryObj<typeof Banner>

export const Info: Story = {}
export const Success: Story = { args: { tone: 'success', title: 'Published' } }
export const Warning: Story = {
  args: {
    tone: 'warning',
    title: 'Your session was ended',
    children: 'The admin ended your session. You can log in again.',
    onDismiss: () => undefined,
  },
}
export const Danger: Story = {
  args: {
    tone: 'danger',
    title: 'This backend cannot be used',
    actions: <Button size="small">Retry</Button>,
  },
}
