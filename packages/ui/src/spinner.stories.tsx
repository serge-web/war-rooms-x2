import type { Meta, StoryObj } from '@storybook/react-vite'
import { Spinner } from './spinner.tsx'

const meta: Meta<typeof Spinner> = {
  title: 'UI/Spinner',
  component: Spinner,
}
export default meta

type Story = StoryObj<typeof Spinner>

export const WithLabel: Story = { args: { label: 'Starting the mock backend' } }
export const LabelHidden: Story = { args: { label: 'Loading', hideLabel: true } }
