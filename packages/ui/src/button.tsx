import type { ComponentPropsWithRef } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  /** Default `secondary`. */
  readonly variant?: ButtonVariant
  /** Default `medium`. */
  readonly size?: 'small' | 'medium'
  /** Shows a busy state: the button is disabled and `aria-busy` is set. */
  readonly busy?: boolean
}

/** A native `<button>`, `type="button"` unless given, so it never submits a form by accident. */
export function Button({
  variant = 'secondary',
  size = 'medium',
  busy = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={['wrx-button', `wrx-button--${variant}`, `wrx-button--${size}`, className]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
    >
      {children}
    </button>
  )
}
