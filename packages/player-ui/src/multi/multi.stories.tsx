import type { Meta, StoryObj } from '@storybook/react-vite'
import { PreviewSelectorCore } from '../preview/admin-game-view.tsx'
import { MockControlsCore } from './mock-controls.tsx'

const meta: Meta<typeof MockControlsCore> = {
  title: 'Player/MultiClient/MockControlsCore',
  component: MockControlsCore,
  args: {
    onReset: () => Promise.resolve(undefined),
    onExport: () => Promise.resolve({ ok: true, json: '{}' }),
    onImport: () => Promise.resolve('the file is not a mock database'),
    saveFile: () => undefined,
  },
}
export default meta

type Story = StoryObj<typeof MockControlsCore>

export const Controls: Story = {}

export const PreviewSelector: Story = {
  render: () => (
    <PreviewSelectorCore
      roles={[
        { id: 'blue-co', label: 'Blue CO (Blue)' },
        { id: 'red-co', label: 'Red CO (Red)' },
      ]}
      value="red-co"
      onChange={() => undefined}
    />
  ),
}
