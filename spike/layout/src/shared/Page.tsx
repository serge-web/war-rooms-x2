import { StrictMode, useEffect, useState, type ComponentType, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import type { Library } from './harness.ts'
import { makeRooms, room, type Room } from './rooms.ts'
import { createUnreadStore, UnreadProvider, type UnreadStore } from './unread.tsx'
import './page.css'

export interface WorkspaceProps {
  wsId: string
  initialRooms: Room[]
  unread: UnreadStore
}

/** A room's panel. Its theme is a CSS custom property scoped to this element (PLY-26). */
export function RoomPanel({ roomId }: { roomId: string }) {
  const r = room(roomId)
  // A real room panel joins its MUC on mount, so the tests track which panels mount.
  useEffect(() => {
    window.wrx ??= { workspaces: {}, mounts: [] }
    window.wrx.mounts.push(roomId)
  }, [roomId])
  return (
    <div
      className="room-panel"
      data-room={r.id}
      style={{ '--room-accent': r.accent } as CSSProperties}
    >
      <h2 className="room-header">{r.name}</h2>
      <p>{r.name} content</p>
      {/* Uncontrolled, so the tests can check component state survives moves and restores. */}
      <input aria-label={`Draft for ${r.name}`} />
    </div>
  )
}

function WorkspaceShell({
  index,
  Workspace,
  rooms,
}: {
  index: number
  Workspace: ComponentType<WorkspaceProps>
  rooms: Room[]
}) {
  // One store per workspace; nothing is shared between workspaces (D15).
  const [unread] = useState(createUnreadStore)
  const wsId = `ws${index}`
  return (
    <section
      className={`workspace ws-theme-${index}`}
      data-ws={wsId}
      aria-label={`Workspace ${index + 1}`}
    >
      <header className="workspace-title">Workspace {index + 1}</header>
      <div className="workspace-body">
        <UnreadProvider store={unread}>
          <Workspace wsId={wsId} initialRooms={rooms} unread={unread} />
        </UnreadProvider>
      </div>
    </section>
  )
}

export function mountPage(library: Library, Workspace: ComponentType<WorkspaceProps>): void {
  const params = new URLSearchParams(location.search)
  const roomCount = Number(params.get('rooms') ?? '4')
  const wsCount = Math.min(4, Math.max(1, Number(params.get('ws') ?? '4')))
  const rooms = makeRooms(roomCount)
  const root = document.getElementById('root')
  if (root === null) throw new Error('no #root')
  createRoot(root).render(
    <StrictMode>
      <main className="page" data-library={library}>
        {Array.from({ length: wsCount }, (_, i) => (
          <WorkspaceShell key={i} index={i} Workspace={Workspace} rooms={rooms} />
        ))}
      </main>
    </StrictMode>,
  )
}
