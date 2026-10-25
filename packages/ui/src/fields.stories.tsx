import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextField } from './fields.tsx'

const meta: Meta<typeof TextField> = {
  title: 'UI/TextField',
  component: TextField,
  args: { label: 'Role id' },
}
export default meta

type Story = StoryObj<typeof TextField>

export const Plain: Story = {}
export const WithHint: Story = { args: { hint: 'As given to you by the admin.' } }
export const WithError: Story = { args: { error: 'Enter a role id.' } }
export const Disabled: Story = { args: { disabled: true, defaultValue: 'blue-co' } }
