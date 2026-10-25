import type { Meta, StoryObj } from '@storybook/react-vite'
import { PasswordField } from './fields.tsx'

const meta: Meta<typeof PasswordField> = {
  title: 'UI/PasswordField',
  component: PasswordField,
  args: { label: 'Password' },
}
export default meta

type Story = StoryObj<typeof PasswordField>

export const Empty: Story = {}
export const Filled: Story = { args: { defaultValue: 'demo-blue-co' } }
export const WithError: Story = { args: { error: 'Wrong role id or password.' } }
