// The server adapter (ARC-8): everything the XMPP core leaves to the server, behind one interface.
// The core (session, MUC, MAM, PubSub, admin modules) speaks standard XEPs only; whatever a given
// server does at a discretionary point, or gets wrong, is answered here. `ejabberd.ts` is the only
// implementation, for the reference deployment (NFR-22).
import type { EndReason, NodeConfig, RoomConfig, TransportError } from '@wrx/transport'
import type { DataForm, FieldValue } from './forms.ts'

export interface ServerAdapter {
  readonly name: string

  /**
   * The error a refused request carries, from a StanzaJS rejection (the error stanza itself), or
   * undefined when the rejection is not a stanza error.
   */
  stanzaError(rejection: unknown): TransportError | undefined

  /** Whether a stream error ends the session for good, and as what (PLY-50). */
  endReason(condition: string): EndReason | undefined

  /** XEP-0133: our field values, renamed to fit the form the server actually offered. */
  fitCommandFields(offered: readonly string[], values: readonly FieldValue[]): readonly FieldValue[]

  /** XEP-0133 delete-user: whether this refusal means the account is already gone (ADM-39). */
  isAbsentAccount(error: TransportError): boolean

  /** XEP-0133 §4.18: the field of `get-online-users-list` that lists the accounts. */
  readonly onlineUsersField: string

  /** XEP-0133 §4.17: the field of `get-registered-users-list` that lists the accounts. */
  readonly registeredUsersField: string

  /**
   * Whether a bare JID has the form the server gives SASL ANONYMOUS sessions. Such a JID that is
   * also online is left out of `registeredUsers`: it is a session, not an account.
   */
  isAnonymousAccount(bareJid: string): boolean

  /** XEP-0133 §4.16: the field of `get-online-users-num` that holds the count. */
  readonly onlineUsersCountField: string

  /** XEP-0045 §10.2: the owner form for a room config, standard fields and the server's own. */
  roomConfigFields(config: RoomConfig): readonly FieldValue[]

  /** Reads `archive` back from a room config form (XEP-0313 defines no standard field). */
  roomArchive(form: DataForm): boolean | undefined

  /** XEP-0060 §8.2: the node config form, with the settings the transport relies on. */
  nodeConfigFields(config: NodeConfig): readonly FieldValue[]

  /**
   * Server time of a live groupchat message, which carries no delay stamp (XEP-0203), from its
   * stanza-id when the server encodes time there. Undefined when it does not.
   */
  liveTimestamp(stanzaId: string): string | undefined

  /**
   * Whether a subscribed publisher is notified of its own publishes (XEP-0060 §7.1.2.1 leaves it
   * to the service). When false the transport reports them itself (S6).
   */
  readonly notifiesOwnPublish: boolean
}
