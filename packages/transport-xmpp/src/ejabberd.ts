// The ejabberd 26.09 server adapter (ARC-8). Every ejabberd-specific behaviour of the transport
// lives in this module; the evidence for each is cited (spike checks S0–S13, WP 0.3, WP 0.1).
//
// Behaviours the transport relies on but does not change, recorded here so the mock and the
// admin tooling can find them in one place:
// - Stored roles (R13, R-B): ejabberd stores a moderator's role change per bare JID and applies
//   it on every later join, but only in moderated rooms, and any affiliation change clears it.
//   Re-setting the same affiliation keeps it (spike S1, mod_muc_room.erl `roles` map).
// - S13 route (WP 0.1): a role change for an absent occupant is refused, `not-allowed` by JID and
//   `not-acceptable` by nick, so observer voice is revoked with the observer logged in (the
//   vault route, ADM-37). The transport passes both errors through unchanged.
// - PubSub revocation (R-A, spike S2/S12): taking a subscribed reader off a whitelist leaves its
//   subscription, and the subscription alone still grants reads. Its subscriptions must be
//   removed as well (setSubscriptions `none`, for each full JID the owner's list shows, since
//   the transport subscribes by full JID).
// - Item ownership (WP 1.3 probe): a `publisher` cannot overwrite or retract an item another
//   entity published (`forbidden`); the node owner can. XEP-0060 leaves this to the service.
// - Auto-create (XEP-0060 §7.1.4): the admin publishing to a missing node creates it with the
//   default config (open access); a player gets `item-not-found`.
// - An owner request (XEP-0045 §10) to a missing room creates it for the admin, and is refused
//   for anyone else by the room-creation policy (`forbidden`).
// - Join history is in memory only and lost on restart (spike S5); history comes from MAM.
import { isXmppCondition } from '@wrx/transport'
import type { EndReason, NodeConfig, RoomConfig, TransportError } from '@wrx/transport'
import { booleanField, stringField } from './forms.ts'
import type { DataForm, FieldValue } from './forms.ts'
import type { RoomServerFields, ServerAdapter } from './server-adapter.ts'

const ERROR_TYPES = Object.freeze(['auth', 'cancel', 'continue', 'modify', 'wait'] as const)
type ErrorType = (typeof ERROR_TYPES)[number]

function isErrorType(value: unknown): value is ErrorType {
  return typeof value === 'string' && (ERROR_TYPES as readonly string[]).includes(value)
}

function errorOf(rejection: unknown): Record<string, unknown> | undefined {
  if (typeof rejection !== 'object' || rejection === null || !('error' in rejection)) return
  const error: unknown = rejection.error
  if (typeof error !== 'object' || error === null) return
  return Object.fromEntries(Object.entries(error))
}

/**
 * Maps an error stanza to a TransportError (RFC 6120 §8.3).
 *
 * Quirk: ejabberd puts `<text/>` before the defined condition inside `<error/>` (S13 stanzas).
 * RFC 6120 §8.3.2 lists the condition first, and a parser that takes the first child reads the
 * condition as "text" (`@xmpp/client` does, WP 0.3). StanzaJS matches the condition by element
 * name, so the order does not matter here; the unit tests pin that with ejabberd's own stanzas.
 * StanzaJS reports its own IQ timeout as condition `timeout`.
 */
function stanzaError(rejection: unknown): TransportError | undefined {
  const error = errorOf(rejection)
  if (error === undefined) return
  const condition = error.condition
  const text = typeof error.text === 'string' ? error.text : undefined
  const type = isErrorType(error.type) ? error.type : undefined
  const mapped: TransportError['condition'] =
    typeof condition === 'string' && (isXmppCondition(condition) || condition === 'timeout')
      ? condition
      : 'undefined-condition'
  return {
    condition: mapped,
    ...(text === undefined ? {} : { text }),
    ...(type === undefined ? {} : { type }),
  }
}

/**
 * Stream errors that end the session for good (PLY-50, spike S4/S12):
 * - XEP-0133 end-user-session: `<policy-violation/>` "has been kicked";
 * - XEP-0133 delete-user on an online account: `<conflict/>` "User removed".
 * Every other stream error (system-shutdown, connection-timeout, …) is a dropped connection, and
 * the transport reconnects.
 */
function endReason(condition: string): EndReason | undefined {
  if (condition === 'policy-violation') return 'session-ended'
  if (condition === 'conflict') return 'account-removed'
  if (condition === 'not-authorized') return 'auth-failed'
  return undefined
}

/**
 * Quirk (spike S4): ejabberd's end-user-session takes `accountjid` (jid-single) where XEP-0133
 * §4.6 specifies `accountjids` (jid-multi), and an unknown field is refused with
 * `<item-not-found/>` "No hook has processed this command". Field names are fitted to the form
 * the server returned: singular for plural and back.
 */
function fitCommandFields(
  offered: readonly string[],
  values: readonly FieldValue[],
): readonly FieldValue[] {
  if (offered.length === 0) return values
  const has = new Set(offered)
  return values.map(({ name, value }) => {
    if (has.has(name)) return { name, value }
    if (name.endsWith('s') && has.has(name.slice(0, -1))) {
      const single = typeof value === 'object' ? (value[0] ?? '') : value
      return { name: name.slice(0, -1), value: single }
    }
    if (has.has(`${name}s`)) {
      const multi = typeof value === 'object' ? value : [String(value)]
      return { name: `${name}s`, value: multi }
    }
    return { name, value }
  })
}

/**
 * Quirk (spike C01, R-E): delete-user for a missing account crashes ejabberd's mod_configure hook
 * and answers `<item-not-found/>` "No hook has processed this command". It means "already gone".
 */
function isAbsentAccount(error: TransportError): boolean {
  return error.condition === 'item-not-found'
}

/**
 * Quirk (WP 2.10 probe): with `auth_method: [internal, anonymous]`, ejabberd lists every online
 * SASL ANONYMOUS session in `get-registered-users-list` (and in its count) until it disconnects.
 * Their localparts are random decimal numbers (24 or 25 digits seen), so a long all-digit
 * localpart is taken as anonymous; the transport also requires it to be online before leaving it
 * out. No login name can have this shape (`ANONYMOUS_LIKE_NAME` in @wrx/schemas, refused by the
 * design check, AdminOps and the draft), so this never hides a role's account (review F4).
 */
function isAnonymousAccount(bareJid: string): boolean {
  return /^\d{16,}@/.test(bareJid)
}

/**
 * Room config (XEP-0045 §10.2). The standard muc#roomconfig fields come from the interface; the
 * rest are ejabberd's own:
 * - `mam`: ejabberd's room archiving switch (XEP-0313 defines no room config field);
 * - the S1b side channels, which game rooms close (no private messages from visitors, no visitor
 *   status text, no visitor nick changes, no voice requests, no MUC/Sub subscription). All are
 *   open by default in ejabberd 26.09, so they are written on every configure and read back
 *   (security review F6).
 */
function roomConfigFields(config: RoomConfig): readonly FieldValue[] {
  return [
    { name: 'muc#roomconfig_roomname', value: config.name },
    { name: 'muc#roomconfig_roomdesc', value: config.description ?? '' },
    { name: 'muc#roomconfig_persistentroom', value: config.persistent },
    { name: 'muc#roomconfig_publicroom', value: config.public },
    { name: 'muc#roomconfig_membersonly', value: config.membersOnly },
    { name: 'muc#roomconfig_moderatedroom', value: config.moderated },
    { name: 'muc#roomconfig_whois', value: config.whois },
    { name: 'mam', value: config.archive },
    { name: 'allow_private_messages_from_visitors', value: config.visitorPrivateMessages },
    { name: 'allow_visitor_status', value: config.visitorStatus },
    { name: 'allow_visitor_nickchange', value: config.visitorNickChange },
    { name: 'allow_voice_requests', value: config.voiceRequests },
    { name: 'allow_subscription', value: config.subscriptions },
  ]
}

const PRIVATE_MESSAGES = Object.freeze(['anyone', 'moderators', 'nobody'] as const)

/**
 * Reads back the fields `roomConfigFields` adds beyond muc#roomconfig. A missing `mam` field
 * means no archiving. A missing or unknown side-channel field is named, so the read fails rather
 * than reporting a channel as closed (ejabberd 26.09 offers all five, checked on the stack).
 */
function roomServerFields(form: DataForm): RoomServerFields | string {
  const flag = (name: string): boolean | string => booleanField(form, name) ?? name
  const pm = stringField(form, 'allow_private_messages_from_visitors')
  const visitorPrivateMessages = PRIVATE_MESSAGES.find((v) => v === pm)
  if (visitorPrivateMessages === undefined) return 'allow_private_messages_from_visitors'
  const visitorStatus = flag('allow_visitor_status')
  const visitorNickChange = flag('allow_visitor_nickchange')
  const voiceRequests = flag('allow_voice_requests')
  const subscriptions = flag('allow_subscription')
  for (const value of [visitorStatus, visitorNickChange, voiceRequests, subscriptions]) {
    if (typeof value === 'string') return value
  }
  return {
    archive: booleanField(form, 'mam') ?? false,
    visitorPrivateMessages,
    visitorStatus: visitorStatus === true,
    visitorNickChange: visitorNickChange === true,
    voiceRequests: voiceRequests === true,
    subscriptions: subscriptions === true,
  }
}

/**
 * Node config (XEP-0060 §8.2). Beyond the interface's fields, the transport sets three that
 * ejabberd defaults differently from what the interface promises (spike S6, WP 1.3 probes):
 * - `notify_delete` on (default off), so subscribers see `deleted` when a node goes;
 * - `send_last_published_item` never (default on_sub_and_presence, which replays the last item
 *   to each new session as if it were a publish), so events mean publishes only;
 * - `itemreply` publisher (default none), so items report their publisher.
 * Items persist and notifications carry the payload, as the interface's `getItems` and `onItems`
 * assume.
 */
function nodeConfigFields(config: NodeConfig): readonly FieldValue[] {
  return [
    { name: 'pubsub#access_model', value: config.accessModel },
    { name: 'pubsub#publish_model', value: config.publishModel },
    { name: 'pubsub#max_items', value: String(config.maxItems) },
    { name: 'pubsub#notify_retract', value: config.notifyRetract },
    { name: 'pubsub#title', value: config.title ?? '' },
    { name: 'pubsub#persist_items', value: true },
    { name: 'pubsub#deliver_payloads', value: true },
    { name: 'pubsub#notify_delete', value: true },
    { name: 'pubsub#send_last_published_item', value: 'never' },
    { name: 'pubsub#itemreply', value: 'publisher' },
  ]
}

/**
 * Quirk (spike S5, WP 1.3 probes): ejabberd's room stanza-ids are the archive time in
 * microseconds since the epoch, the same instant as the MAM delay stamp. A live message carries
 * no delay stamp, so this is the only server time the client has for it. Truncated to
 * milliseconds, the precision StanzaJS gives delay stamps, so live and MAM copies of one message
 * carry the same timestamp string.
 */
function liveTimestamp(stanzaId: string): string | undefined {
  if (!/^\d{16}$/.test(stanzaId)) return undefined
  const date = new Date(Number(BigInt(stanzaId) / 1000n))
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export const ejabberd: ServerAdapter = Object.freeze({
  name: 'ejabberd',
  stanzaError,
  endReason,
  fitCommandFields,
  isAbsentAccount,
  /** Quirk (WP 0.3): XEP-0133 names no fields for these; ejabberd uses these two names. */
  onlineUsersField: 'onlineuserjids',
  onlineUsersCountField: 'onlineusersnum',
  /**
   * Quirk (WP 2.10 probe, ejabberd 26.09): XEP-0133 §4.17 names no field; ejabberd answers
   * `get-registered-users-list` in one step (status `completed`, no `max_items` form) with every
   * account in jid-multi `registereduserjids`, and lists `admin@<domain>` twice (its
   * `get-registered-users-num` counts it twice too). The transport removes duplicates.
   */
  registeredUsersField: 'registereduserjids',
  isAnonymousAccount,
  /**
   * Quirk (review F10, probed on 26.09 with 130 empty unlisted rooms): mod_muc answers a
   * disco#items without RSM with only the occupied rooms once the service holds more than
   * `max_rooms_discoitems` (default 100) rooms, so an idle game past 100 rooms lists none. With
   * RSM it pages through every room the asker may see, in name order, but caps a page at that
   * limit, and a `max` above it returns the last rooms of the window instead of the first (130
   * rooms, max 1000: rooms 31 to 130). 50 stays under the default; the setup guide asks
   * operators not to lower the limit below it. Online users need no paging: 26.09 answers
   * get-online-users-list in one step with every session (1,101 seen).
   */
  roomListPageSize: 50,
  roomConfigFields,
  roomServerFields,
  nodeConfigFields,
  liveTimestamp,
  /** Spike S6: a subscribed publisher gets the event for its own publish, before the IQ result. */
  notifiesOwnPublish: true,
})
