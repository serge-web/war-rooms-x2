import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button.tsx'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Log in' },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Delete role' } }
export const Ghost: Story = { args: { variant: 'ghost', children: 'Use' } }
export const Small: Story = { args: { size: 'small', children: 'Log out' } }
export const Busy: Story = { args: { variant: 'primary', busy: true, children: 'Logging in…' } }
export const Disabled: Story = { args: { disabled: true } }
