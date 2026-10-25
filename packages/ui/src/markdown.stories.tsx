import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarkdownView } from './markdown.tsx'

const BRIEFING = [
  '## Briefing',
  '',
  'The exercise starts at **09:00**. Read your [objectives](#objectives) first.',
  '',
  '1. Secure the crossing.',
  '2. Report to the umpire every hour.',
  '',
  '> Nothing in this briefing is confidential: anyone can read it before logging in.',
  '',
  ...Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1} of background detail.\n`),
].join('\n')

const meta: Meta<typeof MarkdownView> = {
  title: 'UI/MarkdownView',
  component: MarkdownView,
  args: { markdown: BRIEFING, label: 'Briefing' },
}
export default meta

type Story = StoryObj<typeof MarkdownView>

export const Flowing: Story = {}
export const FixedHeight: Story = { args: { maxHeight: '12rem' } }
export const RawHtmlIsText: Story = {
  args: {
    markdown: 'Raw HTML is shown as text: <script>alert(1)</script> <img src=x onerror=alert(1)>',
  },
}
