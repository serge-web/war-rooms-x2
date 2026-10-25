export interface SpinnerProps {
  /** What is loading, for screen readers and shown beside the spinner. Default "Loading". */
  readonly label?: string
  /** Hide the label visually; it is still announced. Default false. */
  readonly hideLabel?: boolean
  readonly className?: string
}

/** A loading indicator in a polite live region. Stops spinning under reduced motion. */
export function Spinner({ label = 'Loading', hideLabel = false, className }: SpinnerProps) {
  return (
    <span className={['wrx-spinner', className].filter(Boolean).join(' ')} role="status">
      <span className="wrx-spinner__wheel" aria-hidden="true" />
      <span className={hideLabel ? 'wrx-visually-hidden' : 'wrx-spinner__label'}>{label}</span>
    </span>
  )
}
