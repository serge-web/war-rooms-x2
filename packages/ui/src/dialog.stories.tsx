import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './button.tsx'
import { Dialog, DialogClose } from './dialog.tsx'

const meta: Meta<typeof Dialog> = {
  title: 'UI/Dialog',
  component: Dialog,
}
export default meta

type Story = StoryObj<typeof Dialog>

function Example({ dismissible = true }: { readonly dismissible?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true)
        }}
      >
        Delete role…
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Delete Blue CO?"
        description="Anyone logged in as this role is logged out at once."
        dismissible={dismissible}
        actions={
          <>
            <DialogClose>
              <Button>Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                setOpen(false)
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </>
  )
}

export const Confirm: Story = { render: () => <Example /> }
export const MustAnswer: Story = { render: () => <Example dismissible={false} /> }
