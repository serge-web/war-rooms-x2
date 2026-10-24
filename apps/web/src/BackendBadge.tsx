export type Backend =
  { readonly kind: 'mock' } | { readonly kind: 'xmpp'; readonly serverAddress: string }

/** Shows which backend the client is using, at all times (PLY-1). */
export function BackendBadge({ backend }: { readonly backend: Backend }) {
  const label = backend.kind === 'mock' ? 'MOCK' : backend.serverAddress
  return (
    <span className="backend-badge" data-backend={backend.kind} aria-label={`Backend: ${label}`}>
      {label}
    </span>
  )
}
