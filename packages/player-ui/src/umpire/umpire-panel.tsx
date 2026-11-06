// The umpire room's panel (SRD Annex C PD6, PD8, PY-8; WP 6.4): the chat panel, with each White
// Force proposal shown as a card. In the admin's own view, a card offers "Load into draft…",
// which shows the change summary first (ADM-46) and then puts the proposed state in the
// world-state draft, to be published from the map room as any draft is (ADM-45). Every other
// client, the White Force's included, shows the card only. A preview as a role reads through the
// admin's session but is not the admin's view, so it offers nothing to load.
import { diffWorldStates, isEmptyDiff } from '@wrx/domain'
import type { WorldStateView } from '@wrx/domain'
import { useForces, useGameState, useMe, useWorldState } from '@wrx/hooks'
import type { PlayerPanelProps } from '@wrx/hooks'
import { Banner, Button } from '@wrx/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { ChatPanel } from '../chat/chat-panel.tsx'
import type { ChatMessage, ProposalView } from '../chat/format.ts'
import { WorldStateSummary } from '../map/change-summary.tsx'
import { useAdminWorldDraft, useMapRoomId, useWorldDraftStorage } from '../map/world-draft.tsx'

/** The umpire room's panel. Register it with `withSlots` for `umpire`. */
export function UmpirePanel(props: PlayerPanelProps) {
  const admin = useMe().data.identity.isAdmin
  const storage = useWorldDraftStorage()
  const mapRoomId = useMapRoomId()
  if (!admin || storage === undefined || mapRoomId === undefined) return <ChatPanel {...props} />
  return <AdminUmpirePanel {...props} mapRoomId={mapRoomId} />
}

function AdminUmpirePanel(props: PlayerPanelProps & { readonly mapRoomId: string }) {
  const { mapRoomId } = props
  const world = useWorldState(mapRoomId)
  const turn = useGameState().data?.turn
  const draft = useAdminWorldDraft(mapRoomId, world.data, turn)
  const [chosen, setChosen] = useState<ChatMessage | undefined>(undefined)
  const [done, setDone] = useState<{ readonly tone: 'success' | 'danger'; readonly text: string }>()
  const proposal = chosen?.proposal
  const aside =
    chosen === undefined || proposal === undefined ? (
      done === undefined ? null : (
        <Banner
          tone={done.tone}
          title={done.tone === 'success' ? 'Loaded into your draft' : 'Not loaded'}
          onDismiss={() => {
            setDone(undefined)
          }}
        >
          {done.text}
        </Banner>
      )
    ) : (
      <LoadProposal
        sender={chosen.senderName}
        proposal={proposal}
        published={world.data}
        hasEdits={draft?.dirty === true}
        loading={draft === undefined || draft.searching}
        onCancel={() => {
          setChosen(undefined)
        }}
        onLoad={() => {
          const problem = draft?.replace(proposal.state)
          setChosen(undefined)
          setDone(
            problem === undefined
              ? {
                  tone: 'success',
                  text: `${chosen.senderName}’s proposal is now your world-state draft. Nothing is published: open the Map room and choose “Publish world state…” to review it and publish.`,
                }
              : { tone: 'danger', text: problem },
          )
        }}
      />
    )
  return (
    <ChatPanel
      {...props}
      proposals={{
        onLoad: (message) => {
          setDone(undefined)
          setChosen(message)
        },
        aside,
      }}
    />
  )
}

/** The confirmation before a proposal becomes the draft, with its change summary (ADM-46). */
function LoadProposal({
  sender,
  proposal,
  published,
  hasEdits,
  loading,
  onCancel,
  onLoad,
}: {
  readonly sender: string
  readonly proposal: ProposalView
  readonly published: WorldStateView | undefined
  readonly hasEdits: boolean
  readonly loading: boolean
  readonly onCancel: () => void
  readonly onLoad: () => void
}) {
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const forces = useForces().data
  // It takes focus when it opens; when it closes and focus would be lost with it, focus goes back
  // to the card's "Load into draft…" (NFR-14; WP 6.5 review, as the asset form's A1 fix).
  useEffect(() => {
    const opener = document.activeElement
    heading.current?.focus()
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body
      if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  const diff = diffWorldStates(published?.state, proposal.state)
  return (
    <section
      className="wrx-chat__proposal-load"
      role="alertdialog"
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel()
      }}
    >
      <h3 id={headingId} ref={heading} tabIndex={-1} className="wrx-chat__proposal-title">
        Load {sender}’s proposal into your draft?
      </h3>
      <p>{proposal.summary}</p>
      <p>Against the published world state, publishing it would change:</p>
      <WorldStateSummary diff={diff} state={proposal.state} forces={forces} />
      {isEmptyDiff(diff) ? <p>It is the same as the published state.</p> : null}
      {hasEdits ? (
        <p>
          <strong>Your draft has unpublished edits.</strong> Loading replaces the whole draft with
          the proposal; your edits are lost.
        </p>
      ) : null}
      <p>Nothing is published until you publish the draft from the Map room.</p>
      <div className="wrx-chat__proposal-actions">
        <Button size="small" variant="primary" disabled={loading} onClick={onLoad}>
          Load into draft
        </Button>
        <Button size="small" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
