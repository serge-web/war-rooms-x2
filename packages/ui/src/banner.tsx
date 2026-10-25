import type { ReactNode } from 'react'
import type { Tone } from './toast.tsx'

export interface BannerProps {
  /** Default `info`. `warning` and `danger` are announced at once (`role="alert"`). */
  readonly tone?: Tone
  readonly title?: string
  readonly children?: ReactNode
  /** Buttons or links at the end of the banner. */
  readonly actions?: ReactNode
  /** Shows a dismiss button. */
  readonly onDismiss?: () => void
  readonly className?: string
}

/** An inline message across a page or panel: status, warnings, explanations. */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  onDismiss,
  className,
}: BannerProps) {
  const urgent = tone === 'warning' || tone === 'danger'
  return (
    <div
      className={['wrx-banner', `wrx-banner--${tone}`, className].filter(Boolean).join(' ')}
      role={urgent ? 'alert' : 'status'}
    >
      <div className="wrx-banner__text">
        {title === undefined ? null : <strong className="wrx-banner__title">{title}</strong>}
        {children === undefined ? null : <div className="wrx-banner__body">{children}</div>}
      </div>
      {actions === undefined ? null : <div className="wrx-banner__actions">{actions}</div>}
      {onDismiss === undefined ? null : (
        <button
          type="button"
          className="wrx-banner__dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  )
}
