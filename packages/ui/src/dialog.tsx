// A modal dialog over Radix Dialog: focus trap, Escape to close, focus returned to the trigger,
// and the title and description wired to the dialog's accessible name and description (NFR-14).
import * as RadixDialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

export interface DialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** The dialog's accessible name, shown as its heading. */
  readonly title: string
  /** Shown under the title and used as the accessible description. */
  readonly description?: string
  /** Buttons along the bottom, e.g. Cancel and Confirm. */
  readonly actions?: ReactNode
  /**
   * Whether Escape and a click outside close it. Default true. Set false for a dialog the user
   * must answer through its actions.
   */
  readonly dismissible?: boolean
  readonly children?: ReactNode
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  actions,
  dismissible = true,
  children,
}: DialogProps) {
  const block = (event: Event) => {
    if (!dismissible) event.preventDefault()
  }
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="wrx-dialog__overlay" />
        <RadixDialog.Content
          className="wrx-dialog"
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
        >
          <RadixDialog.Title className="wrx-dialog__title">{title}</RadixDialog.Title>
          {description === undefined ? null : (
            <RadixDialog.Description className="wrx-dialog__description">
              {description}
            </RadixDialog.Description>
          )}
          {children === undefined ? null : <div className="wrx-dialog__body">{children}</div>}
          {actions === undefined ? null : <div className="wrx-dialog__actions">{actions}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Closes the enclosing dialog when its child is activated; wrap a Cancel button with it. */
export function DialogClose({ children }: { readonly children: ReactNode }) {
  return <RadixDialog.Close asChild>{children}</RadixDialog.Close>
}
