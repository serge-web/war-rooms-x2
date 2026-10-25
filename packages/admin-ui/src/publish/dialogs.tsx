// The publish section's dialogs, over Radix AlertDialog like ConfirmDialog: the apply
// confirmation with a tick per destructive warning (ADM-14, ADM-40, ADM-26), the typed reset
// confirmation (ADM-15), and the vault passphrase forms (ADM-37). Each renders in place, so it
// inherits the admin root's `--wrx-*` properties.
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useId, useState } from 'react'
import type { ReactNode, SyntheticEvent } from 'react'
import { MIN_PASSPHRASE_CHARS } from '@wrx/admin-ops'
import { Button } from '../components/index.ts'
import type { ButtonVariant } from '../components/index.ts'

interface DialogFrameProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly triggerLabel: string
  readonly triggerVariant?: ButtonVariant
  readonly triggerDisabled?: boolean
  readonly title: string
  readonly children: ReactNode
}

function DialogFrame({
  open,
  onOpenChange,
  triggerLabel,
  triggerVariant = 'primary',
  triggerDisabled,
  title,
  children,
}: DialogFrameProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Trigger asChild>
        <Button variant={triggerVariant} disabled={triggerDisabled}>
          {triggerLabel}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Overlay className="wrx-admin-overlay" />
      <AlertDialog.Content className="wrx-admin-dialog">
        <AlertDialog.Title className="wrx-admin-dialog-title">{title}</AlertDialog.Title>
        {children}
      </AlertDialog.Content>
    </AlertDialog.Root>
  )
}

export interface Acknowledgement {
  readonly id: string
  /** What the admin confirms, e.g. "Delete the 42 messages in Negotiation". */
  readonly label: string
}

export interface ApplyDialogProps {
  readonly triggerLabel: string
  readonly triggerDisabled?: boolean
  readonly title: string
  /** What applying will do. */
  readonly children: ReactNode
  /** One tick box per warning that must be confirmed. */
  readonly acknowledgements: readonly Acknowledgement[]
  /** When set, the admin types this text to confirm (ADM-15). */
  readonly typed?: string
  readonly confirmLabel: string
  readonly onConfirm: () => void
}

/** Confirms applying a plan: enabled once every tick box is ticked and any typed text matches. */
export function ApplyDialog({
  triggerLabel,
  triggerDisabled,
  title,
  children,
  acknowledgements,
  typed,
  confirmLabel,
  onConfirm,
}: ApplyDialogProps) {
  const [open, setOpen] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [text, setText] = useState('')
  const typedId = useId()
  const ready =
    acknowledgements.every((a) => ticked.has(a.id)) && (typed === undefined || text === typed)
  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setTicked(new Set())
          setText('')
        }
      }}
      triggerLabel={triggerLabel}
      triggerVariant={typed === undefined ? 'primary' : 'danger'}
      {...(triggerDisabled === undefined ? {} : { triggerDisabled })}
      title={title}
    >
      <AlertDialog.Description asChild>
        <div className="wrx-admin-dialog-body">{children}</div>
      </AlertDialog.Description>
      {acknowledgements.length > 0 && (
        <fieldset className="wrx-admin-fieldset">
          <legend>Confirm each of these</legend>
          {acknowledgements.map((a) => (
            <div key={a.id} className="wrx-admin-field wrx-admin-field-check">
              <input
                id={`${typedId}-${a.id}`}
                type="checkbox"
                checked={ticked.has(a.id)}
                onChange={(e) => {
                  const next = new Set(ticked)
                  if (e.target.checked) next.add(a.id)
                  else next.delete(a.id)
                  setTicked(next)
                }}
              />
              <label htmlFor={`${typedId}-${a.id}`}>{a.label}</label>
            </div>
          ))}
        </fieldset>
      )}
      {typed !== undefined && (
        <div className="wrx-admin-field">
          <label htmlFor={typedId}>
            Type <strong>{typed}</strong> to confirm
          </label>
          <input
            id={typedId}
            className="wrx-admin-input"
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
            }}
          />
        </div>
      )}
      <div className="wrx-admin-dialog-actions">
        <AlertDialog.Cancel asChild>
          <Button>Cancel</Button>
        </AlertDialog.Cancel>
        <Button
          variant={typed === undefined ? 'primary' : 'danger'}
          disabled={!ready}
          onClick={() => {
            setOpen(false)
            setTicked(new Set())
            setText('')
            onConfirm()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </DialogFrame>
  )
}

/** The demo vault's passphrase, labelled as a demo secret like the demo passwords (NFR-6). */
export function DemoPassphrase({ passphrase }: { readonly passphrase: string }) {
  return (
    <p className="wrx-credentials-demo">
      DEMO vault: the mock’s demo game opens it with <code>{passphrase}</code>. Known, not secret;
      for the mock server only.
    </p>
  )
}

export interface VaultDialogProps {
  readonly mode: 'create' | 'unlock'
  readonly busy: boolean
  /** Resolves with an error to show, or undefined on success (the dialog closes). */
  readonly onSubmit: (passphrase: string) => Promise<string | undefined>
  /** The mock demo seed's passphrase, shown labelled as a DEMO passphrase when unlocking (NFR-6). */
  readonly demoPassphrase?: string
}

/**
 * The vault passphrase (ADM-37). Creating asks twice and explains that a lost passphrase cannot
 * be recovered; unlocking asks once. The passphrase lives only in this form's state and is
 * cleared on close.
 */
export function VaultDialog({ mode, busy, onSubmit, demoPassphrase }: VaultDialogProps) {
  const [open, setOpen] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | undefined>()
  const id = useId()
  const clear = () => {
    setPassphrase('')
    setAgain('')
    setError(undefined)
  }
  const tooShort = Array.from(passphrase).length < MIN_PASSPHRASE_CHARS
  const mismatch = mode === 'create' && passphrase !== again
  const submit = (e: SyntheticEvent) => {
    e.preventDefault()
    if (mode === 'create' && (tooShort || mismatch)) return
    void onSubmit(passphrase).then((problem) => {
      if (problem === undefined) {
        clear()
        setOpen(false)
      } else {
        setError(problem)
      }
    })
  }
  return (
    <DialogFrame
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) clear()
      }}
      triggerLabel={mode === 'create' ? 'Create the vault' : 'Unlock the vault'}
      title={mode === 'create' ? 'Create the observer-password vault' : 'Unlock the vault'}
    >
      <AlertDialog.Description asChild>
        <div className="wrx-admin-dialog-body">
          {mode === 'create' ? (
            <p>
              Read-only roles are made read-only by logging in as them, so their passwords are kept
              in a vault, encrypted in this browser under a passphrase. The server holds only the
              ciphertext. A lost passphrase cannot be recovered: the read-only roles’ passwords
              would have to be reset.
            </p>
          ) : (
            <p>The vault passphrase decrypts the read-only roles’ passwords in this browser.</p>
          )}
          {mode === 'unlock' && demoPassphrase !== undefined && (
            <DemoPassphrase passphrase={demoPassphrase} />
          )}
        </div>
      </AlertDialog.Description>
      <form onSubmit={submit} aria-label="Vault passphrase">
        <div className="wrx-admin-field">
          <label htmlFor={`${id}-p`}>Passphrase</label>
          <input
            id={`${id}-p`}
            className="wrx-admin-input"
            type="password"
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={passphrase}
            aria-describedby={mode === 'create' ? `${id}-hint` : undefined}
            onChange={(e) => {
              setPassphrase(e.target.value)
            }}
          />
          {mode === 'create' && (
            <div className="wrx-admin-hint" id={`${id}-hint`}>
              At least {MIN_PASSPHRASE_CHARS} characters.
            </div>
          )}
        </div>
        {mode === 'create' && (
          <div className="wrx-admin-field">
            <label htmlFor={`${id}-a`}>Passphrase again</label>
            <input
              id={`${id}-a`}
              className="wrx-admin-input"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => {
                setAgain(e.target.value)
              }}
            />
            {again !== '' && mismatch && <div className="wrx-admin-hint">The two differ.</div>}
          </div>
        )}
        {error !== undefined && (
          <p className="wrx-admin-notice wrx-admin-notice-error" role="alert">
            {error}
          </p>
        )}
        <div className="wrx-admin-dialog-actions">
          <AlertDialog.Cancel asChild>
            <Button>Cancel</Button>
          </AlertDialog.Cancel>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || passphrase === '' || (mode === 'create' && (tooShort || mismatch))}
          >
            {mode === 'create' ? 'Create' : 'Unlock'}
          </Button>
        </div>
      </form>
    </DialogFrame>
  )
}
