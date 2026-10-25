import { JXT, createClient } from 'stanza'
import { describe, expect, it } from 'vitest'
import { backoffDelay, DEFAULT_BACKOFF } from './backoff.ts'
import { ejabberd } from './ejabberd.ts'
import { booleanField, listField, stringField, submitForm } from './forms.ts'
import { PUBSUB_PAYLOAD_CAP_BYTES, messageWithinCap, payloadWithinCap } from './size.ts'

/** Parses an XML stanza the way the live transport does, with StanzaJS's registry. */
function parse(xml: string): unknown {
  const client = createClient({ transports: { websocket: false, bosh: false } })
  return client.stanzas.import(JXT.parse(xml))
}

describe('ejabberd adapter: stanza errors (ARC-8)', () => {
  it('reads the condition when <text/> comes first, as ejabberd sends it (S13 stanza)', () => {
    const stanza = parse(
      `<iq xmlns='jabber:client' type='error' from='room@conference.localhost' id='x'>` +
        `<error type='cancel'><text xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'>Changing role/affiliation is not allowed</text>` +
        `<not-allowed xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>`,
    )
    expect(ejabberd.stanzaError(stanza)).toEqual({
      condition: 'not-allowed',
      type: 'cancel',
      text: 'Changing role/affiliation is not allowed',
    })
  })

  it('maps the visitor refusal and the not-acceptable nick error (S13)', () => {
    const visitor = parse(
      `<message xmlns='jabber:client' from='room@conference.localhost' type='error' id='m'>` +
        `<error type='auth'><text xml:lang='en' xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'>Visitors are not allowed to send messages to all occupants</text>` +
        `<forbidden xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error><body>x</body></message>`,
    )
    expect(ejabberd.stanzaError(visitor)).toMatchObject({ condition: 'forbidden', type: 'auth' })
    const nick = parse(
      `<iq xmlns='jabber:client' type='error' id='y'><error type='modify'>` +
        `<not-acceptable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>`,
    )
    expect(ejabberd.stanzaError(nick)).toEqual({ condition: 'not-acceptable', type: 'modify' })
  })

  it('passes StanzaJS timeouts through and ignores rejections that are not stanzas', () => {
    expect(ejabberd.stanzaError({ error: { condition: 'timeout', text: 't' } })).toEqual({
      condition: 'timeout',
      text: 't',
    })
    expect(ejabberd.stanzaError({ error: { condition: 'made-up' } })).toEqual({
      condition: 'undefined-condition',
    })
    expect(ejabberd.stanzaError(new Error('bug'))).toBeUndefined()
    expect(ejabberd.stanzaError(undefined)).toBeUndefined()
  })
})

describe('ejabberd adapter: stream errors, ad-hoc fields, timestamps', () => {
  it('maps the forced-logout stream errors (PLY-50) and nothing else', () => {
    expect(ejabberd.endReason('policy-violation')).toBe('session-ended')
    expect(ejabberd.endReason('conflict')).toBe('account-removed')
    expect(ejabberd.endReason('system-shutdown')).toBeUndefined()
    expect(ejabberd.endReason('connection-timeout')).toBeUndefined()
  })

  it('fits XEP-0133 field names to the offered form (accountjid for accountjids)', () => {
    const values = [{ name: 'accountjids', value: ['a@localhost'] }]
    expect(ejabberd.fitCommandFields(['FORM_TYPE', 'accountjid'], values)).toEqual([
      { name: 'accountjid', value: 'a@localhost' },
    ])
    expect(ejabberd.fitCommandFields(['FORM_TYPE', 'accountjids'], values)).toEqual(values)
    expect(
      ejabberd.fitCommandFields(['accountjids'], [{ name: 'accountjid', value: 'b@localhost' }]),
    ).toEqual([{ name: 'accountjids', value: ['b@localhost'] }])
    expect(ejabberd.onlineUsersField).toBe('onlineuserjids')
    expect(ejabberd.onlineUsersCountField).toBe('onlineusersnum')
    expect(ejabberd.registeredUsersField).toBe('registereduserjids')
  })

  it('takes ejabberd’s anonymous localparts (long decimal numbers) for sessions', () => {
    expect(ejabberd.isAnonymousAccount('1080128588868944608416002@localhost')).toBe(true)
    expect(ejabberd.isAnonymousAccount('290422220885955458115906@localhost')).toBe(true)
    expect(ejabberd.isAnonymousAccount('blue-co@localhost')).toBe(false)
    expect(ejabberd.isAnonymousAccount('007@localhost')).toBe(false)
  })

  it('reads the registered-users list ejabberd sends, admin listed twice (WP 2.10 probe)', () => {
    const stanza = parse(
      `<iq xmlns='jabber:client' type='result' from='localhost' id='r'>` +
        `<command xmlns='http://jabber.org/protocol/commands' status='completed' ` +
        `node='http://jabber.org/protocol/admin#get-registered-users-list'>` +
        `<x type='form' xmlns='jabber:x:data'>` +
        `<field var='FORM_TYPE' type='hidden'><value>http://jabber.org/protocol/admin</value></field>` +
        `<field var='registereduserjids' type='jid-multi' label='The list of all users'>` +
        `<value>admin@localhost</value><value>probe-a@localhost</value>` +
        `<value>admin@localhost</value></field></x></command></iq>`,
    )
    const form = (stanza as { command?: { form?: Parameters<typeof listField>[0] } }).command?.form
    expect(listField(form, ejabberd.registeredUsersField)).toEqual([
      'admin@localhost',
      'probe-a@localhost',
      'admin@localhost',
    ])
  })

  it('treats delete-user item-not-found as an account already gone (R-E)', () => {
    expect(ejabberd.isAbsentAccount({ condition: 'item-not-found' })).toBe(true)
    expect(ejabberd.isAbsentAccount({ condition: 'forbidden' })).toBe(false)
  })

  it('reads the server time from a stanza-id, to the millisecond (S5)', () => {
    // 1792875235611764 µs is the MAM delay stamp 2026-10-24T20:53:55.611764Z (WP 1.3 probe).
    expect(ejabberd.liveTimestamp('1792875235611764')).toBe('2026-10-24T20:53:55.611Z')
    expect(ejabberd.liveTimestamp('not-a-number')).toBeUndefined()
    expect(ejabberd.liveTimestamp('123')).toBeUndefined()
  })
})

describe('ejabberd adapter: config forms', () => {
  const room = {
    name: 'Blue HQ',
    membersOnly: true,
    moderated: true,
    persistent: true,
    public: false,
    whois: 'anyone' as const,
    archive: true,
  }

  it('adds the S1b hardening and the mam switch to every room config', () => {
    const form = submitForm('ns', ejabberd.roomConfigFields(room))
    expect(stringField(form, 'allow_private_messages_from_visitors')).toBe('nobody')
    expect(booleanField(form, 'allow_visitor_status')).toBe(false)
    expect(booleanField(form, 'allow_visitor_nickchange')).toBe(false)
    expect(booleanField(form, 'allow_voice_requests')).toBe(false)
    expect(booleanField(form, 'allow_subscription')).toBe(false)
    expect(booleanField(form, 'mam')).toBe(true)
    expect(ejabberd.roomArchive(form)).toBe(true)
    expect(stringField(form, 'muc#roomconfig_whois')).toBe('anyone')
  })

  it('sets the node options the interface relies on', () => {
    const form = submitForm(
      'ns',
      ejabberd.nodeConfigFields({
        accessModel: 'whitelist',
        publishModel: 'publishers',
        maxItems: 1,
        notifyRetract: true,
      }),
    )
    expect(booleanField(form, 'pubsub#notify_delete')).toBe(true)
    expect(stringField(form, 'pubsub#send_last_published_item')).toBe('never')
    expect(stringField(form, 'pubsub#itemreply')).toBe('publisher')
    expect(stringField(form, 'pubsub#max_items')).toBe('1')
    expect(listField(form, 'pubsub#access_model')).toEqual(['whitelist'])
  })
})

describe('reconnect back-off (PLY-2)', () => {
  it('doubles from the initial delay, with jitter in the upper half, up to the cap', () => {
    const options = { initialMs: 500, maxMs: 8_000, maxAttempts: 10 }
    expect(backoffDelay(1, options, () => 0)).toBe(250)
    expect(backoffDelay(1, options, () => 0.999999)).toBe(500)
    expect(backoffDelay(3, options, () => 1)).toBe(2_000)
    expect(backoffDelay(10, options, () => 1)).toBe(8_000)
    expect(backoffDelay(10, options, () => 0)).toBe(4_000)
    expect(DEFAULT_BACKOFF.maxAttempts).toBeGreaterThan(0)
  })
})

describe('size caps (PLY-53)', () => {
  it('caps message stanzas at 65,536 bytes of UTF-8', () => {
    expect(messageWithinCap('x'.repeat(65_536))).toBe(true)
    expect(messageWithinCap('x'.repeat(65_537))).toBe(false)
    expect(messageWithinCap('é'.repeat(32_769))).toBe(false)
  })

  it('caps item payloads at the item limit less the XML overhead', () => {
    expect(PUBSUB_PAYLOAD_CAP_BYTES).toBe(248_000)
    expect(payloadWithinCap('x'.repeat(248_000))).toBe(true)
    expect(payloadWithinCap('x'.repeat(248_001))).toBe(false)
  })
})
