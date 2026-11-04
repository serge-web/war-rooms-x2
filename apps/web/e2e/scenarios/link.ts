// A network link that the scenarios can cut (SC-3, PLY-2): a TCP relay between one browser
// context and the reference ejabberd. Chromium's offline emulation (`context.setOffline`) stops
// new requests but leaves an open WebSocket up, so on its own it never drops a session; cutting
// the relay closes the connection under the client, as a network failure does, and refuses new
// connections until the link is back.
import { createConnection, createServer } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'

export interface CuttableLink {
  /** The relay's WebSocket URL, standing in for the server's. */
  readonly websocketUrl: string
  setUp(up: boolean): void
  close(): Promise<void>
}

export async function cuttableLink(websocketUrl: string): Promise<CuttableLink> {
  const target = new URL(websocketUrl)
  const port = Number(target.port === '' ? 443 : target.port)
  const sockets = new Set<Socket>()
  let up = true
  const server = createServer((client) => {
    if (!up) {
      client.destroy()
      return
    }
    const upstream = createConnection({ host: target.hostname, port })
    for (const socket of [client, upstream]) {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {
        client.destroy()
        upstream.destroy()
      })
    }
    client.pipe(upstream)
    upstream.pipe(client)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const relay = new URL(websocketUrl)
  relay.port = String((server.address() as AddressInfo).port)
  return {
    websocketUrl: relay.toString(),
    setUp(next) {
      up = next
      if (!up) for (const socket of sockets) socket.destroy()
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => {
          resolve()
        })
      }),
  }
}
