import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button.tsx'
import { ToastProvider, useToast } from './toast.tsx'
import type { Tone } from './toast.tsx'

const meta: Meta<typeof ToastProvider> = {
  title: 'UI/Toast',
  component: ToastProvider,
}
export default meta

type Story = StoryObj<typeof ToastProvider>

function Buttons() {
  const toast = useToast()
  const tones: readonly Tone[] = ['info', 'success', 'warning', 'danger']
  return (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      {tones.map((tone) => (
        <Button
          key={tone}
          onClick={() => {
            toast.show({ title: 'Mock backend', description: `A ${tone} notice.`, tone })
          }}
        >
          Show {tone}
        </Button>
      ))}
    </div>
  )
}

export const Tones: Story = {
  render: () => (
    <ToastProvider>
      <Buttons />
    </ToastProvider>
  ),
}
