import type { Meta, StoryObj } from '@storybook/react-vite'
import { Banner } from './banner.tsx'
import { Button } from './button.tsx'
import { ThemeScope } from './theme.tsx'

const meta: Meta<typeof ThemeScope> = {
  title: 'UI/ThemeScope',
  component: ThemeScope,
}
export default meta

type Story = StoryObj<typeof ThemeScope>

function Sample({ label }: { readonly label: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: '0.5rem',
        padding: '1rem',
        background: 'var(--wrx-background)',
        border: '1px solid var(--wrx-border)',
      }}
    >
      <strong>{label}</strong>
      <Banner title="A banner">Styled only by --wrx-* properties.</Banner>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
      </div>
    </div>
  )
}

/** Two panels side by side: each scope's theme stays on its own root (PLY-26). */
export const SideBySide: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
      <ThemeScope tokens={{ primary: '#1d4ed8' }}>
        <Sample label="Blue force theme" />
      </ThemeScope>
      <ThemeScope
        tokens={{
          primary: '#b91c1c',
          background: '#fef2f2',
          surface: '#ffffff',
          text: '#1f1111',
          fontFamily: 'serif',
        }}
      >
        <Sample label="Red force theme, serif" />
      </ThemeScope>
    </div>
  ),
}

export const Dark: Story = {
  render: () => (
    <ThemeScope
      tokens={{ primary: '#93c5fd', background: '#0f172a', surface: '#1e293b', text: '#f1f5f9' }}
    >
      <Sample label="Dark tokens" />
    </ThemeScope>
  ),
}
