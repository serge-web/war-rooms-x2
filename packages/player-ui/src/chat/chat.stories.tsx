import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChatPanelCore } from './chat-panel.tsx'
import type { ChatMessage } from './format.ts'
import './chat.css'

const BLUE = { senderKey: 'blue-co', senderName: 'Blue CO', forceName: 'Blue', colour: '#1d4ed8' }
const RED = { senderKey: 'red-co', senderName: 'Red CO', forceName: 'Red', colour: '#b91c1c' }

const MESSAGES: readonly ChatMessage[] = [
  { ...BLUE, id: '1', timestamp: '2026-10-23T16:10:00Z', self: true, text: 'End of day one.' },
  { ...BLUE, id: '2', timestamp: '2026-10-24T08:40:00Z', self: true, text: 'Orders are out.' },
  {
    ...BLUE,
    id: '3',
    timestamp: '2026-10-24T08:41:00Z',
    self: true,
    text: 'Plan: https://example.org/plan\nRecce team moving to the bridge.',
  },
  { ...RED, id: '4', timestamp: '2026-10-24T08:45:00Z', self: false, text: 'Hold the east bank.' },
  { ...RED, id: '5', timestamp: '2026-10-24T08:46:00Z', self: false, text: undefined },
]

const meta: Meta<typeof ChatPanelCore> = {
  title: 'Player/ChatPanelCore',
  component: ChatPanelCore,
  decorators: [
    (Story) => (
      <div className="wrx-theme" style={{ height: '32rem', maxWidth: '40rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    roomName: 'Blue HQ',
    messages: MESSAGES,
    online: [
      { id: 'blue-co', name: 'Blue CO', colour: '#1d4ed8', self: true },
      { id: 'red-co', name: 'Red CO', colour: '#b91c1c', self: false },
    ],
    hasOlder: false,
    loadingOlder: false,
    onSend: () => Promise.resolve({ ok: true }),
    timeFormat: { locale: 'en-GB', timeZone: 'UTC' },
  },
}
export default meta

type Story = StoryObj<typeof ChatPanelCore>

export const Default: Story = {}

export const ReadOnly: Story = {
  args: {
    disabledReason: 'You are observing this game: you can read this room but not post in it.',
  },
}

export const RefusedPost: Story = {
  args: {
    unsent: { text: 'Move to grid 1234.', reason: 'you can no longer post in this room.' },
  },
}

export const TenThousandMessages: Story = {
  args: {
    messages: Array.from({ length: 10_000 }, (_, i) => ({
      ...(i % 3 === 0 ? RED : BLUE),
      id: `m${i}`,
      timestamp: new Date(Date.UTC(2026, 9, 1) + i * 90_000).toISOString(),
      self: false,
      text: `Message ${i + 1}`,
    })),
  },
}
