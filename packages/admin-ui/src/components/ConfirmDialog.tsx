// A confirmation over Radix AlertDialog: focus is trapped, Escape cancels, and the dialog is
// named and described for screen readers (NFR-14). It renders in place rather than in a portal,
// so it inherits the admin root's `--wrx-*` properties (PLY-26).
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'
import { Button } from './controls.tsx'
import type { ButtonVariant } from './controls.tsx'

export interface ConfirmDialogProps {
  /** The button that opens the dialog. */
  readonly triggerLabel: string
  readonly triggerVariant?: ButtonVariant
  readonly title: string
  /** What will happen; the dialog's description. */
  readonly children: ReactNode
  readonly confirmLabel: string
  /** When false, the dialog only explains and offers Close. */
  readonly canConfirm?: boolean
  readonly onConfirm: () => void
}

export function ConfirmDialog({
  triggerLabel,
  triggerVariant = 'danger',
  title,
  children,
  confirmLabel,
  canConfirm = true,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button variant={triggerVariant}>{triggerLabel}</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Overlay className="wrx-admin-overlay" />
      <AlertDialog.Content className="wrx-admin-dialog">
        <AlertDialog.Title className="wrx-admin-dialog-title">{title}</AlertDialog.Title>
        <AlertDialog.Description asChild>
          <div className="wrx-admin-dialog-body">{children}</div>
        </AlertDialog.Description>
        <div className="wrx-admin-dialog-actions">
          <AlertDialog.Cancel asChild>
            <Button>{canConfirm ? 'Cancel' : 'Close'}</Button>
          </AlertDialog.Cancel>
          {canConfirm && (
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialog.Action>
          )}
        </div>
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}
