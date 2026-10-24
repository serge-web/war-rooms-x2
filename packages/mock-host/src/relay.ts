// The tab end of the mock host: a ServerLink for MockTransport whose connections are carried to
// whichever context hosts the server (a SharedWorker, the leader tab, or this tab itself). When
// the host changes, every connection opened on the old one is dropped without a stream error, as
// a server restart drops it, so sessions reconnect as new sessions to the new host (PLY-2).
import type { ClientFrame, ServerFrame, ServerLink, ServerPort } from '@wrx/mock-server'

/** One way to reach the host. `id` names the host: a leader tab's id, or the worker. */
export interface Route {
  readonly id: string
  send(conn: number, frame: ClientFrame): void
}

interface Connection {
  readonly sink: (frame: ServerFrame) => void
  /** The host this connection was opened on; undefined until the first frame goes out. */
  route: Route | undefined
  /** Frames sent before any host was known. */
  readonly queue: ClientFrame[]
}

function isFinal(frame: ServerFrame): boolean {
  return frame.t === 'refused' || frame.t === 'end' || frame.t === 'closed' || frame.t === 'dropped'
}

export class ConnectionTable implements ServerLink {
  private nextId = 1
  private readonly connections = new Map<number, Connection>()
  private route: Route | undefined
  private closed = false

  attach(sink: (frame: ServerFrame) => void): ServerPort {
    if (this.closed) {
      return {
        send: (frame) => {
          if (frame.t !== 'login') return
          queueMicrotask(() => {
            sink({
              t: 'refused',
              error: { condition: 'service-unavailable', text: 'the mock host is closed' },
            })
          })
        },
      }
    }
    const id = this.nextId++
    const connection: Connection = { sink, route: undefined, queue: [] }
    this.connections.set(id, connection)
    return {
      send: (frame: ClientFrame) => {
        if (this.connections.get(id) !== connection) return
        connection.route ??= this.route
        if (connection.route === undefined) connection.queue.push(frame)
        else connection.route.send(id, frame)
        if (frame.t === 'drop') this.connections.delete(id)
      },
    }
  }

  /** A frame from host `routeId` for connection `conn`; anything else is stale and ignored. */
  deliver(routeId: string, conn: number, frame: ServerFrame): void {
    const connection = this.connections.get(conn)
    if (connection?.route?.id !== routeId) return
    if (isFinal(frame)) this.connections.delete(conn)
    connection.sink(frame)
  }

  /** The host is now reached through `route`; undefined while none is known. */
  setRoute(route: Route | undefined): void {
    const previous = this.route
    this.route = route
    if (previous?.id === route?.id && previous !== undefined) return
    for (const [id, connection] of [...this.connections]) {
      if (connection.route !== undefined && connection.route.id !== route?.id) {
        this.connections.delete(id)
        connection.sink({ t: 'dropped' })
      }
    }
    if (route === undefined) return
    for (const [id, connection] of [...this.connections]) {
      if (connection.route !== undefined) continue
      connection.route = route
      for (const frame of connection.queue.splice(0)) route.send(id, frame)
    }
  }

  /** Open connections, for tests and diagnostics. */
  get size(): number {
    return this.connections.size
  }

  /** Ends every session for good and refuses new ones: the tab no longer reaches any host. */
  close(): void {
    this.closed = true
    this.route = undefined
    for (const [id, connection] of [...this.connections]) {
      this.connections.delete(id)
      connection.sink({ t: 'end', reason: 'unreachable', text: 'the mock host was closed' })
    }
  }

  /** Ends every connection: they see a drop, and reconnect if their session is still live. */
  dropAll(): void {
    for (const [id, connection] of [...this.connections]) {
      this.connections.delete(id)
      connection.sink({ t: 'dropped' })
    }
  }
}
