import type { Meta, StoryObj } from '@storybook/react-vite'
import { AnnouncementsPanelCore } from './announcements.tsx'
import { OutOfGameColumnCore } from './column.tsx'
import { ForcePanelCore, ObjectivesEditorCore } from './force-panel.tsx'

const ITEMS = [
  {
    id: 'a1',
    text: 'Welcome to Exercise Northern Gate.',
    postedAt: '2026-10-24T08:30:00.000Z',
    live: false,
  },
  { id: 'a2', text: 'Break until 10:30.', postedAt: '2026-10-24T10:00:00.000Z', live: true },
]

const FORCES = [
  { id: 'blue', name: 'Blue' },
  { id: 'red', name: 'Red' },
  { id: 'umpire', name: 'Umpire' },
]

function Column({ admin = false, umpire = false }: { admin?: boolean; umpire?: boolean }) {
  const chooses = admin || umpire
  return (
    <aside style={{ width: '18rem', padding: '1rem' }} aria-label="Out-of-game column">
      <OutOfGameColumnCore
        announcements={
          <AnnouncementsPanelCore
            items={ITEMS}
            onPost={admin ? () => Promise.resolve(undefined) : undefined}
          />
        }
        force={
          <section className="wrx-force-panel" aria-label="Force panel">
            <ForcePanelCore
              roleName={admin ? 'Admin' : umpire ? 'Lead Umpire' : 'Blue CO'}
              forceName={admin ? undefined : umpire ? 'Umpire' : 'Blue'}
              objectivesForce={FORCES[0]}
              objectives={'1. Secure the crossing.\n2. Keep the bridge open.'}
              forceChoice={chooses ? { forces: FORCES, onSelect: () => undefined } : undefined}
              onEdit={chooses ? () => undefined : undefined}
            />
          </section>
        }
      />
    </aside>
  )
}

const meta: Meta<typeof Column> = {
  title: 'Player/OutOfGameColumn',
  component: Column,
}
export default meta

type Story = StoryObj<typeof Column>

export const Player: Story = {}
export const Umpire: Story = { args: { umpire: true } }
export const Admin: Story = { args: { admin: true } }
export const Empty: Story = {
  render: () => (
    <aside style={{ width: '18rem', padding: '1rem' }} aria-label="Out-of-game column">
      <OutOfGameColumnCore
        announcements={<AnnouncementsPanelCore items={[]} />}
        force={
          <section className="wrx-force-panel" aria-label="Force panel">
            <ForcePanelCore
              roleName="Red CO"
              forceName="Red"
              objectivesForce={FORCES[1]}
              objectives={undefined}
            />
          </section>
        }
      />
    </aside>
  ),
}
export const Editor: Story = {
  render: () => (
    <ObjectivesEditorCore
      open
      onOpenChange={() => undefined}
      forceName="Red"
      initial={'1. Delay Blue.\n\n**Hold** the east bank.'}
      onPublish={() => Promise.resolve(undefined)}
    />
  ),
}
