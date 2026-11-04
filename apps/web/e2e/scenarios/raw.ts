// Raw protocol work for the scenarios, as a client other than the app would do it: the admin's
// direct operations, and a "modified client" posting as a role (SC-4). One self-contained
// function, so the same code runs in Node against ejabberd (through the real transport) and in
// the page against the mock (Playwright sends its source to the page, so it may use nothing from
// outside its own body).
import type { Transport } from '@wrx/transport'

export type RawStep =
  /** Joins a room and posts each text as a chat message, in order. */
  | { readonly op: 'post'; readonly room: string; readonly texts: readonly string[] }
  /**
   * Joins a room and posts each body as it is (a world state, WP 5.5), with the map-room cap when
   * `maxBytes` is given.
   */
  | {
      readonly op: 'post-body'
      readonly room: string
      readonly bodies: readonly string[]
      readonly maxBytes?: number
    }
  | { readonly op: 'end-sessions'; readonly jid: string }
  | { readonly op: 'delete-user'; readonly jid: string }
  | { readonly op: 'delete-node'; readonly node: string }
  | { readonly op: 'publish'; readonly node: string; readonly payload: string }
  /** A whitelist node that the roles named read, as a publish makes one (§3 rule 15). */
  | { readonly op: 'create-node'; readonly node: string; readonly readers: readonly string[] }

export interface RawRun {
  readonly endpoint: { readonly websocketUrl: string; readonly domain: string }
  readonly username: string
  readonly password: string
  readonly steps: readonly RawStep[]
}

/** Each step's outcome: `ok`, or the refusal's condition. A failed login returns `login: <condition>`. */
export async function rawRun(run: RawRun, transport?: Transport): Promise<string[]> {
  const host =
    transport ??
    (globalThis as unknown as { wrxMock?: Transport }).wrxMock ??
    (undefined as Transport | undefined)
  if (host === undefined) return ['login: no mock host']
  const login = await host.connect({
    endpoint: run.endpoint,
    credentials: { kind: 'password', username: run.username, password: run.password },
    resource: `raw-${Math.random().toString(36).slice(2, 8)}`,
  })
  if (!login.ok) return [`login: ${login.error.condition}`]
  const session = login.value
  const results: string[] = []
  for (const step of run.steps) {
    if (step.op === 'post-body') {
      const jid = `${step.room}@${session.services.muc}`
      const joined = await session.muc.join(jid, `${run.username}-raw`)
      if (!joined.ok) {
        results.push(`join: ${joined.error.condition}`)
        continue
      }
      for (const body of step.bodies) {
        const sent = await session.muc.send(
          jid,
          body,
          step.maxBytes === undefined ? undefined : { maxBytes: step.maxBytes },
        )
        results.push(sent.ok ? 'ok' : sent.error.condition)
      }
      await session.muc.leave(jid)
      continue
    }
    if (step.op === 'post') {
      const jid = `${step.room}@${session.services.muc}`
      const joined = await session.muc.join(jid, `${run.username}-raw`)
      if (!joined.ok) {
        results.push(`join: ${joined.error.condition}`)
        continue
      }
      for (const text of step.texts) {
        const body = JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
        const sent = await session.muc.send(jid, body)
        results.push(sent.ok ? 'ok' : sent.error.condition)
      }
      await session.muc.leave(jid)
      continue
    }
    if (step.op === 'create-node') {
      const created = await session.pubsub.createNode(step.node, {
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems: 1,
        notifyRetract: true,
      })
      if (!created.ok) {
        results.push(`create: ${created.error.condition}`)
        continue
      }
      const domain = session.jid.slice(session.jid.indexOf('@') + 1).split('/')[0] ?? ''
      const granted = await session.pubsub.setAffiliations(
        step.node,
        step.readers.map((id) => ({ jid: `${id}@${domain}`, affiliation: 'member' as const })),
      )
      results.push(granted.ok ? 'ok' : granted.error.condition)
      continue
    }
    const result =
      step.op === 'end-sessions'
        ? await session.admin.endUserSessions(step.jid)
        : step.op === 'delete-user'
          ? await session.admin.deleteUser(step.jid)
          : step.op === 'publish'
            ? await session.pubsub.publish(step.node, 'current', step.payload)
            : await session.pubsub.deleteNode(step.node)
    results.push(result.ok ? 'ok' : result.error.condition)
  }
  await session.disconnect()
  return results
}
