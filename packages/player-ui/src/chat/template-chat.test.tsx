// @vitest-environment happy-dom
// Templated messages in the chat panel (Annex A, WP 4.2), over a store: the composer's
// "Message type" drop-down (TD3, TPL-3), sending a template, a refused one keeping its values
// (PLY-33), a templates-only room offering a role nothing; and received messages as cards
// (TD7), a not-permitted one as a card with a warning, an invalid one as plain text with a
// warning (TPL-6, provisional answer 3).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  DOMAIN,
  MUC,
  flush,
  harness,
  message,
  room,
  sampleDocuments,
  selfPresence,
} from '@wrx/domain/fixtures'
import type { Harness } from '@wrx/domain/fixtures'
import { SessionStoreProvider } from '@wrx/hooks'
import { nodeName } from '@wrx/schemas'
import type { ChatRoomConfig } from '@wrx/schemas'
import { TEMPLATE, blueReportsConfig, sampleTemplates, tid } from '@wrx/schemas/fixtures'
import { err } from '@wrx/transport'
import type { RoomMessage } from '@wrx/transport'
import { StrictMode } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatPanel } from './chat-panel.tsx'
import { NO_TEMPLATES_REASON } from './chat-composer.tsx'
import { UnreadProvider } from './unread.tsx'

afterEach(cleanup)

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(800)
})
afterAll(() => {
  vi.restoreAllMocks()
})

const REPORTS = `${tid('blue-reports')}@${MUC}`

function templated(
  roleId: string,
  templateId: string,
  values: Record<string, unknown>,
): RoomMessage {
  return message('blue-reports', {
    nick: roleId,
    from: `${roleId}@${DOMAIN}/x`,
    body: JSON.stringify({ type: 'template', schemaVersion: 1, content: { templateId, values } }),
  })
}

async function mount({
  roleId = 'blue-co',
  archive = [],
  config = blueReportsConfig(),
}: {
  roleId?: string
  archive?: RoomMessage[]
  config?: ChatRoomConfig
} = {}): Promise<{ h: Harness; remount: () => Promise<void> }> {
  const docs = sampleDocuments()
  docs.set('templates', sampleTemplates())
  const reports = room(
    'blue-reports',
    [
      { kind: 'force', id: 'blue', access: 'write' },
      { kind: 'role', id: 'red-co', access: 'write' },
    ],
    { order: 3, config },
  )
  docs.set(nodeName.room(reports.id), [reports])
  const h = harness({ roleId, docs })
  h.archive.set(REPORTS, archive)
  await h.store.ready()
  const doc = h.store.room(tid('blue-reports')).data
  if (doc === undefined) throw new Error('no room')
  const ui = () => (
    <StrictMode>
      <SessionStoreProvider store={h.store}>
        <UnreadProvider>
          <ChatPanel roomId={tid('blue-reports')} room={doc} config={config} access="write" />
        </UnreadProvider>
      </SessionStoreProvider>
    </StrictMode>
  )
  const view = render(ui())
  await act(() => flush())
  act(() => {
    h.session.emitOccupant(selfPresence('blue-reports', roleId))
  })
  return {
    h,
    remount: async () => {
      view.unmount()
      render(ui())
      await act(() => flush())
    },
  }
}

const typeSelect = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Message type' })

async function choose(name: string) {
  const select = typeSelect()
  const option = [...select.options].find((o) => o.textContent === name)
  if (option === undefined) throw new Error(`no ${name}`)
  fireEvent.change(select, { target: { value: option.value } })
  // The form is loaded lazily.
  await screen.findByRole('button', { name: 'Clear' })
}

async function fillContact() {
  fireEvent.change(await screen.findByLabelText(/Seen at/), {
    target: { value: '2026-10-24T08:40' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: /Grid reference/ }), {
    target: { value: 'NV1234' },
  })
}

describe('the template composer', () => {
  it('offers the role’s templates, and no free text where the room has none (TD3, TD4)', async () => {
    await mount()
    expect([...typeSelect().options].map((o) => o.textContent)).toEqual([
      'Situation report',
      'Contact report',
      'Support request',
    ])
    // The first template's form is shown at once.
    expect(await screen.findByRole('combobox', { name: /Reporting force/ })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Message blue-reports' })).toBeNull()
  })

  it('offers free text first where the room allows it', async () => {
    await mount({ config: { ...blueReportsConfig(), freeText: true } })
    expect(typeSelect().options[0]?.textContent).toBe('Free text')
    expect(screen.getByRole('textbox', { name: 'Message blue-reports' })).toBeTruthy()
  })

  it('says a templates-only room offers this role nothing, and cannot send', async () => {
    await mount({
      config: {
        schemaVersion: 2,
        freeText: false,
        templates: [{ kind: 'role', id: tid('red-co'), templateIds: [TEMPLATE.contact] }],
      },
    })
    expect(screen.queryByRole('combobox', { name: 'Message type' })).toBeNull()
    expect(screen.getByText(NO_TEMPLATES_REASON)).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send' }).disabled).toBe(true)
  })

  it('sends a template as a `template` message, then clears the form (TPL-3)', async () => {
    const { h } = await mount()
    await choose('Contact report')
    await fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => {
      expect(h.session.calls.some((c) => c.op === 'send')).toBe(true)
    })
    const send = h.session.calls.find((c) => c.op === 'send')
    expect(send?.args[0]).toBe(REPORTS)
    expect(JSON.parse(String(send?.args[1]))).toEqual({
      type: 'template',
      schemaVersion: 1,
      content: {
        templateId: TEMPLATE.contact,
        values: {
          seenAt: new Date('2026-10-24T08:40').toISOString(),
          grid: 'NV1234',
          // An unticked yes/no is sent as no.
          hostile: false,
        },
      },
    })
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Grid reference/ }).value).toBe(
        '',
      )
    })
  })

  it('does not send values that do not fit, and announces how many fields need attention', async () => {
    const { h } = await mount()
    await choose('Contact report')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Not sent: 2 fields need attention.',
    )
    expect(h.session.calls.some((c) => c.op === 'send')).toBe(false)
  })

  it('keeps a refused template’s values, and again after the panel is re-mounted (PLY-33)', async () => {
    const { h, remount } = await mount()
    h.session.stub('muc', 'send', () => Promise.resolve(err('forbidden')))
    await choose('Contact report')
    await fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Not sent: you can no longer post in this room. Your values are kept below.',
    )
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Grid reference/ }).value).toBe(
      'NV1234',
    )
    await remount()
    expect(typeSelect().selectedOptions[0]?.textContent).toBe('Contact report')
    expect(
      (await screen.findByRole<HTMLInputElement>('textbox', { name: /Grid reference/ })).value,
    ).toBe('NV1234')
    expect(screen.getByRole('alert').textContent).toContain('Your values are kept below.')
  })

  it('keeps each type’s unsent values while switching between them', async () => {
    await mount({ config: { ...blueReportsConfig(), freeText: true } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Message blue-reports' }), {
      target: { value: 'A draft' },
    })
    await choose('Contact report')
    fireEvent.change(screen.getByRole('textbox', { name: /Grid reference/ }), {
      target: { value: 'NV99' },
    })
    await choose('Situation report')
    await choose('Contact report')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Grid reference/ }).value).toBe(
      'NV99',
    )
    fireEvent.change(typeSelect(), { target: { value: '' } })
    expect(
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message blue-reports' }).value,
    ).toBe('A draft')
  })
})

describe('the collapsed template composer (PLY-54)', () => {
  const toggle = (name: string) => screen.getByRole('button', { name })

  it('keeps the form’s values and chosen type while collapsed, and says a draft waits', async () => {
    await mount()
    // The form's own starting values are not a draft.
    fireEvent.click(toggle('Hide message entry'))
    expect(screen.queryByText('Draft not sent')).toBeNull()
    fireEvent.click(toggle('Write a message'))
    await choose('Contact report')
    await fillContact()
    fireEvent.click(toggle('Hide message entry'))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('Draft not sent')).toBeTruthy()
    fireEvent.click(toggle('Write a message'))
    expect(typeSelect().selectedOptions[0]?.textContent).toBe('Contact report')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Grid reference/ }).value).toBe(
      'NV1234',
    )
  })

  it('counts a draft of a type not on screen, and a refused one as not sent', async () => {
    const { h } = await mount()
    await choose('Contact report')
    fireEvent.change(screen.getByRole('textbox', { name: /Grid reference/ }), {
      target: { value: 'NV99' },
    })
    await choose('Situation report')
    fireEvent.click(toggle('Hide message entry'))
    expect(screen.getByText('Draft not sent')).toBeTruthy()
    fireEvent.click(toggle('Write a message'))

    h.session.stub('muc', 'send', () => Promise.resolve(err('forbidden')))
    await choose('Contact report')
    await fillContact()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByRole('alert')
    fireEvent.click(toggle('Hide message entry'))
    expect(screen.getByText('Message not sent')).toBeTruthy()
  })
})

describe('received templated messages', () => {
  it('shows a card, a not-permitted one with a warning, an invalid one as text with a warning', async () => {
    await mount({
      archive: [
        templated('blue-co', TEMPLATE.sitrep, {
          force: tid('red'),
          summary: 'Holding the bridge.',
          readiness: 75,
          asOf: '2026-10-24',
        }),
        // Red CO is in the room, but the room offers it no template.
        templated('red-co', TEMPLATE.contact, {
          seenAt: '2026-10-24T08:40:00.000Z',
          grid: 'NV1234',
        }),
        // A hostile client: readiness out of range, and markup in the text.
        templated('red-co', TEMPLATE.sitrep, {
          force: tid('red'),
          summary: '<img src=x onerror="window.pwned=1">',
          readiness: 500,
          asOf: '2026-10-24',
        }),
        templated('red-co', tid('no-such-template'), { a: 1 }),
      ],
    })
    const feed = screen.getByRole('feed')
    const [valid, notPermitted, invalid, unknown] = within(feed).getAllByRole('article')
    if (valid === undefined || notPermitted === undefined || invalid === undefined) {
      throw new Error('messages missing')
    }
    // A card: the template's name, then label and value, a picker by name (TPL-8).
    const card = within(valid).getByText('Situation report').closest('.wrx-tcard')
    expect(card).not.toBeNull()
    const dl = valid.querySelector('dl')
    expect(dl?.textContent).toContain('Reporting force')
    expect(dl?.textContent).toContain('Holding the bridge.')
    expect(valid.querySelector('.wrx-chat__warning')).toBeNull()

    expect(notPermitted.querySelector('.wrx-tcard')).not.toBeNull()
    expect(notPermitted.querySelector('.wrx-chat__warning')?.textContent).toBe(
      'Warning: This room does not offer Contact report to the sender now.',
    )

    expect(invalid.querySelector('.wrx-tcard')).toBeNull()
    expect(invalid.querySelector('.wrx-chat__warning')?.textContent).toBe(
      'Warning: This message does not fit the template Situation report.',
    )
    expect(invalid.querySelector('.wrx-chat__text')?.textContent).toContain(
      'Summary: <img src=x onerror="window.pwned=1">',
    )
    expect(feed.querySelector('img')).toBeNull()

    expect(unknown?.querySelector('.wrx-chat__warning')?.textContent).toBe(
      'Warning: This message names a template this game does not have.',
    )
  })
})
