// A test page for the mock host (WP 1.5): one player per tab, driven by Playwright through
// `window.wrx`, with a small view of what it sees. Query flags:
//   ?hosting=leader|shared-worker|local   force a hosting mode (default auto)
//   ?nohost                               do not start the host; expose storage only
import type { RoomJid, RoomMessage, Session } from '@wrx/transport'
import {
  IndexedDbStore,
  basePathOf,
  connectMockTransport,
  hostNames,
  mockNamespace,
} from '../../src/index.ts'
import type { HostingPreference } from '../../src/index.ts'
import type { TestHooks } from './hooks.ts'

const DOMAIN = 'wrx.mock'
const params = new URLSearchParams(location.search)

function element(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (el === null) throw new Error(`#${id} is missing`)
  return el
}

function textOf(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null && 'content' in parsed) {
      const content: unknown = parsed.content
      if (typeof content === 'object' && content !== null && 'text' in content) {
        return String(content.text)
      }
    }
  } catch {
    // Not chat JSON: show it raw.
  }
  return body
}

async function main(): Promise<void> {
  const names = hostNames(mockNamespace(basePathOf(document.baseURI)))
  if (params.has('nohost')) {
    const store = new IndexedDbStore(indexedDB, names.database)
    window.wrxStorage = {
      database: names.database,
      write: (value) => store.save(value),
      read: () => store.load(),
    }
    element('hosting').textContent = 'no host'
    return
  }

  const hostingParam = params.get('hosting') ?? 'auto'
  const hosting: HostingPreference =
    hostingParam === 'leader' || hostingParam === 'shared-worker' || hostingParam === 'local'
      ? hostingParam
      : 'auto'
  const noticeList = element('notices')
  const host = await connectMockTransport({
    hosting,
    onNotice: (notice) => {
      const li = document.createElement('li')
      li.textContent = `${notice.kind}: ${notice.text}`
      noticeList.append(li)
    },
  })
  element('hosting').textContent = host.hosting

  let session: Session | undefined
  let recoveries = 0
  const joined = new Set<RoomJid>()
  const seen = new Map<RoomJid, Map<string, RoomMessage>>()
  const roomJid = (room: string) => `${room}@conference.${DOMAIN}`

  const render = () => {
    const list = element('messages')
    list.replaceChildren(
      ...[...seen.values()].flatMap((messages) =>
        [...messages.values()].map((m) => {
          const li = document.createElement('li')
          li.textContent = `${m.nick}: ${textOf(m.body)}`
          return li
        }),
      ),
    )
  }

  const record = (message: RoomMessage) => {
    const messages = seen.get(message.room) ?? new Map<string, RoomMessage>()
    messages.set(message.stanzaId, message)
    seen.set(message.room, messages)
    render()
  }

  const enter = async (s: Session, room: RoomJid, nick: string) => {
    const result = await s.muc.join(room, nick)
    if (!result.ok) throw new Error(`cannot join ${room}: ${result.error.condition}`)
    const page = await s.mam.queryRoom(room, { max: 200 })
    if (page.ok) page.value.messages.forEach(record)
  }

  const requireSession = (): Session => {
    if (session === undefined) throw new Error('not logged in')
    return session
  }

  const hooks: TestHooks = {
    hosting: host.hosting,
    tab: host.tab,
    isHosting: () => host.isHosting(),
    notices: () => host.notices().map((n) => n.kind),
    login: async (role) => {
      const result = await host.connect({
        endpoint: { websocketUrl: 'mock://e2e', domain: DOMAIN },
        credentials: { kind: 'password', username: role, password: `demo-${role}` },
        resource: `${role}-${host.tab}`,
      })
      if (!result.ok) throw new Error(`cannot log in: ${result.error.condition}`)
      const s = result.value
      session = s
      element('who').textContent = role
      s.onRecovered((how) => {
        if (how !== 'reconnected') return
        recoveries++
        // A new session: the server may have been reset, so rebuild from history.
        seen.clear()
        render()
        for (const room of joined) void enter(s, room, role)
      })
    },
    join: async (room) => {
      const s = requireSession()
      const jid = roomJid(room)
      s.muc.onMessage(jid, record)
      joined.add(jid)
      await enter(s, jid, s.jid.split('@')[0] ?? 'player')
    },
    send: async (room, text) => {
      const body = JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
      const result = await requireSession().muc.send(roomJid(room), body)
      return result.ok ? undefined : result.error.condition
    },
    texts: (room) => [...(seen.get(roomJid(room))?.values() ?? [])].map((m) => textOf(m.body)),
    recoveries: () => recoveries,
    reset: async () => {
      const result = await host.resetToSeed()
      return result.ok ? undefined : result.error
    },
    exportDb: async () => {
      const result = await host.exportDatabase()
      if (!result.ok) throw new Error(result.error)
      return result.value
    },
    importDb: async (json) => {
      const result = await host.importDatabase(json)
      return result.ok ? undefined : result.error
    },
  }
  window.wrx = hooks
}

void main()
