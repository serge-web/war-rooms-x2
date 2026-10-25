// @vitest-environment happy-dom
// The chat panel over a store (happy-dom): history with shared headers and plain text, sending
// with Enter, a refused post kept with its reason, the observer's disabled composer, who is
// online, unread counts, and a 10,000-message list rendering only what is in view.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DOMAIN, MUC, chatBody, flush, harness, message, selfPresence } from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { err } from '@wrx/transport'
import type { RoomMessage } from '@wrx/transport'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatPanel, ChatPanelCore } from './chat-panel.tsx'
import type { ChatMessage } from './format.ts'
import {
  ChatUnreadBadge,
  ReadMarkers,
  UnreadProvider,
  countUnread,
  useReadMarkers,
} from './unread.tsx'

afterEach(cleanup)

// happy-dom lays nothing out, so the virtualiser would see a zero-height list and render no rows:
// every element reports a fixed size instead.
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
})
afterAll(() => {
  vi.restoreAllMocks()
})

const HQ = `blue-hq@${MUC}`

function from(roleId: string, text: string, extra: Partial<RoomMessage> = {}): RoomMessage {
  return message('blue-hq', {
    nick: roleId,
    from: `${roleId}@${DOMAIN}/x`,
    body: chatBody(text),
    ...extra,
  })
}

async function mount({
  roleId = 'blue-co',
  access = 'write',
  archive = [],
  extra,
}: {
  roleId?: string
  access?: 'write' | 'read'
  archive?: RoomMessage[]
  extra?: ReactNode
} = {}): Promise<Harness> {
  const h = harness({ roleId })
  h.archive.set(HQ, archive)
  await h.store.ready()
  const roomDoc = h.store.room('blue-hq').data
  if (roomDoc === undefined) throw new Error('no room')
  render(
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        <UnreadProvider>
          <ChatPanel roomId="blue-hq" room={roomDoc} config={{}} access={access} />
          {extra}
        </UnreadProvider>
      </SessionStoreProvider>
    </StrictMode>,
  )
  await act(() => flush())
  return h
}

const composer = () => screen.getByRole('textbox', { name: 'Message blue-hq' })

describe('ChatPanel', () => {
  it('shows history as cards, one header per sender run, text never as HTML (PLY-9, PLY-14, PLY-43)', async () => {
    await mount({
      archive: [
        from('red-co', 'Hold the east bank.'),
        from('red-co', '<img src=x onerror="window.pwned=1"> **not bold**'),
        from('blue-co', 'See https://example.org/plan.'),
      ],
    })
    const feed = screen.getByRole('feed')
    const cards = within(feed).getAllByRole('article')
    expect(cards).toHaveLength(3)
    // red-co's two messages share one header; blue-co's starts a new one.
    expect(feed.querySelectorAll('.wrx-chat__header')).toHaveLength(2)
    expect(within(feed).getByText('<img src=x onerror="window.pwned=1"> **not bold**')).toBeTruthy()
    expect(feed.querySelector('img, strong')).toBeNull()
    const link = within(feed).getByRole('link', { name: 'https://example.org/plan' })
    expect(link.getAttribute('href')).toBe('https://example.org/plan')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(within(cards[2]!).getByText('(you)')).toBeTruthy()
    expect(screen.getByText('Start of the room’s history.')).toBeTruthy()
  })

  it('labels the admin’s messages as the umpire, in the White Force, by JID only (SC-5, §3 rule 3)', async () => {
    const h = await mount({
      archive: [
        from('admin', 'The exercise clock starts at 09:00.'),
        // A nick of "admin" from another server is not the admin.
        message('blue-hq', {
          nick: 'admin',
          from: 'admin@evil.example/x',
          body: chatBody('I am the umpire'),
        }),
      ],
    })
    const feed = screen.getByRole('feed')
    const headers = [...feed.querySelectorAll('.wrx-chat__header')].map((e) => e.textContent)
    expect(headers[0]).toContain('Umpire')
    expect(headers[0]).toContain('WHITE')
    expect(headers[1]).not.toContain('Umpire')
    const accent = within(feed).getAllByRole('article')[0]?.getAttribute('style') ?? ''
    expect(accent).toContain('#4b5563')
    act(() => {
      h.session.emitOccupant(
        selfPresence('blue-hq', 'admin', { self: false, jid: `admin@${DOMAIN}/a` }),
      )
    })
    const list = screen.getByRole('list', { name: 'Online in this room' })
    expect(within(list).getByText('Umpire')).toBeTruthy()
  })

  it('sends with Enter, adds a line with Shift+Enter, and clears once accepted (PLY-44)', async () => {
    const h = await mount()
    act(() => {
      h.session.emitOccupant(selfPresence('blue-hq', 'blue-co'))
    })
    const area = composer()
    fireEvent.change(area, { target: { value: 'line one' } })
    fireEvent.keyDown(area, { key: 'Enter', shiftKey: true })
    expect(h.session.calls.some((c) => c.op === 'send')).toBe(false)
    fireEvent.keyDown(area, { key: 'Enter' })
    await act(() => flush())
    const send = h.session.calls.find((c) => c.op === 'send')
    expect(send?.args[0]).toBe(HQ)
    expect(JSON.parse(String(send?.args[1]))).toEqual({
      type: 'chat',
      schemaVersion: 1,
      content: { text: 'line one' },
    })
    expect((composer() as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps a refused post and says why (PLY-33)', async () => {
    const h = await mount()
    h.session.stub('muc', 'send', () => Promise.resolve(err('forbidden')))
    fireEvent.change(composer(), { target: { value: 'Secret plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await act(() => flush())
    expect(screen.getByRole('alert').textContent).toContain(
      'Not sent: you can no longer post in this room.',
    )
    expect((composer() as HTMLTextAreaElement).value).toBe('Secret plan')
  })

  it('will not send over the size cap, and says so (PLY-53)', async () => {
    const h = await mount()
    fireEvent.change(composer(), { target: { value: 'x'.repeat(8_001) } })
    expect(screen.getByText(/^Too long: 8,001 of 8,000 characters/)).toBeTruthy()
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Send' })
    expect(send.disabled).toBe(true)
    fireEvent.keyDown(composer(), { key: 'Enter' })
    await act(() => flush())
    expect(h.session.calls.some((c) => c.op === 'send')).toBe(false)
  })

  it('disables the composer for an observer, with an explanation (PLY-12)', async () => {
    await mount({ roleId: 'blue-observer', access: 'read' })
    const area = composer() as HTMLTextAreaElement
    expect(area.disabled).toBe(true)
    expect(screen.getByText(/You are observing this game/)).toBeTruthy()
    expect(area.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true)
  })

  it('shows who is online in the room (PLY-13)', async () => {
    const h = await mount()
    act(() => {
      h.session.emitOccupant(selfPresence('blue-hq', 'blue-co'))
      h.session.emitOccupant(
        selfPresence('blue-hq', 'white-1', { self: false, jid: `white-1@${DOMAIN}/a` }),
      )
    })
    const list = screen.getByRole('list', { name: 'Online in this room' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['blue-co (you)', 'white-1'])
    expect(screen.getByText('Online (2)')).toBeTruthy()
  })
})

describe('unread counts (PLY-11)', () => {
  it('counts other roles’ messages after the first load, until marked read', async () => {
    let markers: ReadMarkers | undefined
    const Grab = () => {
      markers = useReadMarkers()
      return null
    }
    const h = harness({ roleId: 'blue-co' })
    h.archive.set(HQ, [from('red-co', 'old news')])
    await h.store.ready()
    render(
      <SessionStoreProvider store={h.store}>
        <UnreadProvider>
          <span data-testid="badge">
            <ChatUnreadBadge roomId="blue-hq" />
          </span>
          <Grab />
        </UnreadProvider>
      </SessionStoreProvider>,
    )
    await act(() => flush())
    const badge = () => screen.getByTestId('badge').textContent
    // The history already there is read.
    expect(badge()).toBe('')
    act(() => {
      h.session.emitMessage(from('red-co', 'one'))
      h.session.emitMessage(from('blue-co', 'mine, from another session'))
      h.session.emitMessage(from('white-1', 'two'))
    })
    expect(badge()).toBe('2')
    const newest = h.store.roomView('blue-hq').data?.messages.at(-1)
    act(() => {
      if (newest !== undefined) {
        markers?.mark('blue-hq', { id: newest.id, ms: Date.parse(newest.timestamp) })
      }
    })
    expect(badge()).toBe('')
  })

  it('countUnread stops at the marker', () => {
    const entries = h3()
    const isOwn = () => false
    expect(countUnread(entries, { id: 'b', ms: Date.parse(entries[1]!.timestamp) }, isOwn)).toBe(1)
    expect(countUnread(entries, { id: '', ms: -Infinity }, isOwn)).toBe(3)
    // A marker no longer in the list still bounds the count by time.
    expect(countUnread(entries, { id: 'gone', ms: Date.parse(entries[1]!.timestamp) }, isOwn)).toBe(
      2,
    )
  })
})

function h3() {
  return ['a', 'b', 'c'].map((id, i) => ({
    kind: 'message' as const,
    id,
    roomId: 'r',
    timestamp: `2026-10-24T10:00:0${i}Z`,
    sender: { nick: 'x', jid: undefined, roleId: 'x', isAdmin: false },
    body: { type: 'chat' as const, schemaVersion: 1 as const, content: { text: id } },
  }))
}

describe('ChatPanelCore with 10,000 messages (NFR-11)', () => {
  it('renders only the rows in view, quickly', () => {
    const messages: ChatMessage[] = Array.from({ length: 10_000 }, (_, i) => ({
      id: `m${i}`,
      timestamp: new Date(Date.UTC(2026, 9, 1) + i * 30_000).toISOString(),
      senderKey: `r${i % 4}`,
      senderName: `Role ${i % 4}`,
      self: false,
      text: `Message number ${i}`,
    }))
    const start = performance.now()
    render(
      <ChatPanelCore
        roomName="Big room"
        messages={messages}
        online={[]}
        hasOlder={false}
        loadingOlder={false}
        onSend={() => Promise.resolve({ ok: true })}
        timeFormat={{ locale: 'en-GB', timeZone: 'UTC' }}
      />,
    )
    const elapsed = performance.now() - start
    const rendered = screen.getAllByRole('article')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(60)
    expect(elapsed).toBeLessThan(1_000)
  })
})
