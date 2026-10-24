// XEP-0045 Multi-User Chat over StanzaJS: occupant use (§7), moderation (§8), ownership (§9–10).
import { err } from '@wrx/transport'
import type {
  AffiliationEntry,
  Joined,
  MucAffiliation,
  MucApi,
  MucRole,
  OccupantEvent,
  Outcome,
  RoomConfig,
  RoomJid,
  RoomMessage,
  Unsubscribe,
} from '@wrx/transport'
import { JID } from 'stanza'
import type * as XMPP from 'stanza'
import { sendIq } from './core.ts'
import type { Core } from './core.ts'
import { booleanField, stringField, submitForm } from './forms.ts'
import { Listeners } from './listeners.ts'
import { Refusal, invalidResponse, withTimeout } from './refusal.ts'
import { messageWithinCap } from './size.ts'

const NS_ROOMCONFIG = 'http://jabber.org/protocol/muc#roomconfig'
const SELF_PRESENCE = 110

type ReceivedPresence = XMPP.Stanzas.ReceivedPresence
type ReceivedMessage = XMPP.Stanzas.ReceivedMessage

const ROLES = Object.freeze(['moderator', 'participant', 'visitor', 'none'] as const)
const AFFILIATIONS = Object.freeze(['owner', 'admin', 'member', 'outcast', 'none'] as const)

function role(value: string | undefined): MucRole {
  return ROLES.find((r) => r === value) ?? 'none'
}

function affiliation(value: string | undefined): MucAffiliation {
  return AFFILIATIONS.find((a) => a === value) ?? 'none'
}

interface Pending<T> {
  resolve(value: T): void
  reject(reason: unknown): void
}

interface RoomState {
  nick: string
  joined: boolean
  readonly occupants: Map<string, OccupantEvent>
  join?: Pending<Joined>
  leave?: Pending<undefined>
}

export class XmppMuc implements MucApi {
  private readonly rooms = new Map<RoomJid, RoomState>()
  private readonly messageListeners = new Listeners<RoomJid, RoomMessage>()
  private readonly occupantListeners = new Listeners<RoomJid, OccupantEvent>()
  /** Sends waiting for their reflection, by message id. */
  private readonly reflections = new Map<string, Pending<{ readonly stanzaId: string }>>()

  constructor(private readonly core: Core) {}

  /**
   * A new session replaced the old one (`reconnected`): the server has dropped us from every
   * room, so local room state goes too. The domain layer rejoins (PLY-2).
   */
  reset(): void {
    const gone = new Refusal({ condition: 'disconnected', text: 'the session was replaced' })
    for (const state of this.rooms.values()) {
      state.join?.reject(gone)
      state.leave?.resolve(undefined)
    }
    this.rooms.clear()
    for (const pending of this.reflections.values()) pending.reject(gone)
    this.reflections.clear()
  }

  /** Rooms this session is in. */
  joinedRooms(): readonly RoomJid[] {
    return [...this.rooms].filter(([, state]) => state.joined).map(([room]) => room)
  }

  // ---- incoming stanzas, dispatched by the session ------------------------------------------

  handlePresence(presence: ReceivedPresence): void {
    const room = JID.toBare(presence.from)
    const state = this.rooms.get(room)
    if (state === undefined) return
    if (presence.type === 'error') {
      // §7.2.6 onwards: a refused join comes back as presence of type error.
      const pending = state.join
      if (pending === undefined) return
      state.join = undefined
      if (!state.joined) this.rooms.delete(room)
      pending.reject(presence)
      return
    }
    const nick = JID.getResource(presence.from)
    const muc = presence.muc
    if (nick === undefined || muc === undefined || muc.type === 'join') return
    const statusCodes = (muc.statusCodes ?? []).map(Number).filter(Number.isFinite)
    const event: OccupantEvent = {
      room,
      nick,
      jid: muc.jid === undefined ? undefined : JID.toBare(muc.jid),
      role: role(muc.role),
      affiliation: affiliation(muc.affiliation),
      available: presence.type !== 'unavailable',
      self: statusCodes.includes(SELF_PRESENCE),
      statusCodes,
    }
    if (event.available) state.occupants.set(nick, event)
    else state.occupants.delete(nick)
    if (event.self && event.available) {
      // §7.2.3: self-presence completes the join. It comes after the existing occupants and
      // before the history.
      state.joined = true
      state.nick = nick
      const pending = state.join
      state.join = undefined
      pending?.resolve({ room, nick, role: event.role, affiliation: event.affiliation })
    }
    if (event.self && !event.available && !statusCodes.includes(303)) {
      // Left, kicked (307), banned (301), removed by an affiliation change (321) or shut down.
      state.joined = false
      state.occupants.clear()
      const pending = state.leave
      state.leave = undefined
      pending?.resolve(undefined)
    }
    this.occupantListeners.emit(room, event)
  }

  handleMessage(message: ReceivedMessage): void {
    if (message.type === 'error') {
      const pending = message.id === undefined ? undefined : this.reflections.get(message.id)
      if (pending !== undefined && message.id !== undefined) {
        this.reflections.delete(message.id)
        pending.reject(message)
      }
      return
    }
    if (message.type !== 'groupchat') return
    const room = JID.toBare(message.from)
    const state = this.rooms.get(room)
    const nick = JID.getResource(message.from)
    if (state === undefined || nick === undefined || message.body === undefined) return
    // XEP-0359: the room's stanza-id, which is also the MAM archive id (PLY-10).
    const stanzaId = message.stanzaIds?.find((s) => s.by === room)?.id
    if (stanzaId === undefined) return
    if (message.id !== undefined && nick === state.nick) {
      const pending = this.reflections.get(message.id)
      if (pending !== undefined) {
        this.reflections.delete(message.id)
        pending.resolve({ stanzaId })
      }
    }
    this.messageListeners.emit(room, {
      room,
      stanzaId,
      nick,
      from: this.senderOf(message, state, nick),
      timestamp:
        message.delay?.timestamp.toISOString() ??
        this.core.adapter.liveTimestamp(stanzaId) ??
        new Date().toISOString(),
      body: message.body,
    })
  }

  /** §7.2.4 non-anonymous rooms: the sender's real JID, from the stanza or its presence. */
  private senderOf(message: ReceivedMessage, state: RoomState, nick: string): string | undefined {
    const muc = message.muc
    if (muc !== undefined && muc.type !== 'direct-invite' && muc.jid !== undefined) {
      return JID.toBare(muc.jid)
    }
    const ofrom = message.addresses?.find((a) => a.type === 'ofrom')?.jid
    if (ofrom !== undefined) return JID.toBare(ofrom)
    return state.occupants.get(nick)?.jid
  }

  // ---- occupant use (§7) --------------------------------------------------------------------

  join(room: RoomJid, nick: string): Outcome<Joined> {
    const existing = this.rooms.get(room)
    const state: RoomState = existing ?? { nick, joined: false, occupants: new Map() }
    this.rooms.set(room, state)
    return this.core.run(() => {
      const joined = new Promise<Joined>((resolve, reject) => {
        state.join?.reject(new Refusal({ condition: 'conflict', text: 'joined again' }))
        state.join = { resolve, reject }
      })
      this.core.client.sendPresence({ to: JID.createFull(room, nick), muc: { type: 'join' } })
      return withTimeout(joined, this.core.timeoutMs, `join ${room}`).catch((reason: unknown) => {
        state.join = undefined
        if (!state.joined) this.rooms.delete(room)
        throw reason
      })
    })
  }

  leave(room: RoomJid): Outcome<void> {
    const state = this.rooms.get(room)
    return this.core.run(async () => {
      if (state?.joined !== true) {
        this.rooms.delete(room)
        return
      }
      const left = new Promise<undefined>((resolve, reject) => {
        state.leave = { resolve, reject }
      })
      this.core.client.sendPresence({ to: JID.createFull(room, state.nick), type: 'unavailable' })
      await withTimeout(left, this.core.timeoutMs, `leave ${room}`)
      this.rooms.delete(room)
    })
  }

  send(room: RoomJid, body: string): Outcome<{ readonly stanzaId: string }> {
    const client = this.core.client
    const id = client.nextId()
    const message: XMPP.Stanzas.Message = { id, originId: id, to: room, type: 'groupchat', body }
    const serialised = client.stanzas.export('message', message)?.toString() ?? ''
    if (!messageWithinCap(serialised)) {
      return Promise.resolve(
        err('too-large', `message stanza is ${serialised.length} characters, over the cap`),
      )
    }
    return this.core.run(() => {
      // §7.4: the service reflects the message to the sender with the same id; ejabberd adds
      // the stanza-id there. A refusal comes back as a message of type error with that id.
      const reflected = new Promise<{ readonly stanzaId: string }>((resolve, reject) => {
        this.reflections.set(id, { resolve, reject })
      })
      client.sendMessage(message)
      return withTimeout(reflected, this.core.timeoutMs, `message to ${room}`).finally(() => {
        this.reflections.delete(id)
      })
    })
  }

  onMessage(room: RoomJid, listener: (message: RoomMessage) => void): Unsubscribe {
    return this.messageListeners.add(room, listener)
  }

  onOccupant(room: RoomJid, listener: (event: OccupantEvent) => void): Unsubscribe {
    return this.occupantListeners.add(room, listener)
  }

  occupants(room: RoomJid): readonly OccupantEvent[] {
    return [...(this.rooms.get(room)?.occupants.values() ?? [])]
  }

  // ---- moderation (§8) and ownership (§9–10) ------------------------------------------------

  setRole(room: RoomJid, nick: string, newRole: MucRole, reason?: string): Outcome<void> {
    return this.core.run(async () => {
      await this.core.client.setRoomRole(room, nick, newRole, reason)
    })
  }

  setAffiliations(room: RoomJid, entries: readonly AffiliationEntry[]): Outcome<void> {
    return this.core.run(async () => {
      if (entries.length === 0) return
      // §9.3 / §10.6: several items in one muc#admin request.
      await sendIq(this.core.client, {
        to: room,
        type: 'set',
        muc: {
          type: 'user-list',
          users: entries.map((e) => ({ jid: e.jid, affiliation: e.affiliation })),
        },
      })
    })
  }

  getAffiliations(room: RoomJid, wanted: MucAffiliation): Outcome<readonly AffiliationEntry[]> {
    return this.core.run(async () => {
      const result = await this.core.client.getRoomMembers(room, { affiliation: wanted })
      const entries: AffiliationEntry[] = []
      for (const user of result.muc.users ?? []) {
        if (user.jid === undefined) continue
        entries.push({ jid: JID.toBare(user.jid), affiliation: affiliation(user.affiliation) })
      }
      return entries
    })
  }

  createRoom(room: RoomJid, config: RoomConfig): Outcome<void> {
    // §10.1.2: entering a room that does not exist creates it, locked (status 201) until the
    // owner submits the configuration. An existing room is taken over by its owner.
    return this.core.run(async () => {
      const wasJoined = this.rooms.get(room)?.joined === true
      if (!wasJoined) {
        const nick = JID.getLocal(this.core.bareJid()) ?? 'admin'
        const joined = await this.join(room, nick)
        if (!joined.ok) throw new Refusal(joined.error)
      }
      try {
        await this.submitConfig(room, config)
      } finally {
        if (!wasJoined) await this.leave(room)
      }
    })
  }

  configureRoom(room: RoomJid, config: RoomConfig): Outcome<void> {
    return this.core.run(() => this.submitConfig(room, config))
  }

  private async submitConfig(room: RoomJid, config: RoomConfig): Promise<void> {
    const fields = this.core.adapter.roomConfigFields(config)
    await this.core.client.configureRoom(room, submitForm(NS_ROOMCONFIG, fields))
  }

  getRoomConfig(room: RoomJid): Outcome<RoomConfig> {
    return this.core.run(async () => {
      const form = await this.core.client.getRoomConfig(room)
      const flag = (name: string): boolean => {
        const value = booleanField(form, name)
        if (value === undefined) throw invalidResponse(`room config has no ${name}`)
        return value
      }
      const whois = stringField(form, 'muc#roomconfig_whois')
      if (whois !== 'anyone' && whois !== 'moderators') {
        throw invalidResponse(`room config whois is ${whois ?? 'missing'}`)
      }
      const description = stringField(form, 'muc#roomconfig_roomdesc')
      return {
        name: stringField(form, 'muc#roomconfig_roomname') ?? '',
        ...(description === undefined || description === '' ? {} : { description }),
        membersOnly: flag('muc#roomconfig_membersonly'),
        moderated: flag('muc#roomconfig_moderatedroom'),
        persistent: flag('muc#roomconfig_persistentroom'),
        public: flag('muc#roomconfig_publicroom'),
        whois,
        archive: this.core.adapter.roomArchive(form) ?? false,
      }
    })
  }

  destroyRoom(room: RoomJid, reason?: string): Outcome<void> {
    return this.core.run(async () => {
      await this.core.client.destroyRoom(room, reason === undefined ? {} : { reason })
      this.rooms.delete(room)
    })
  }

  listRooms(): Outcome<readonly RoomJid[]> {
    return this.core.run(async () => {
      const result = await this.core.client.getDiscoItems(this.core.services().muc)
      const rooms: RoomJid[] = []
      for (const item of result.items) if (item.jid !== undefined) rooms.push(JID.toBare(item.jid))
      return rooms
    })
  }
}
