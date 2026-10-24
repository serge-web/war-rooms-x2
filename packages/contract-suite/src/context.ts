// The context each check receives: the backend, the provisioned fixture, and session helpers that
// close what a test opened.
import type { Outcome, RoomJid, Session } from '@wrx/transport'
import type { ContractBackend, Login } from './backend.ts'
import type { Fixture } from './fixture.ts'

export interface Ctx {
  readonly backend: ContractBackend
  /** The fixture of this run. Valid inside tests and hooks, not while tests are declared. */
  fx(): Fixture
  /** The admin session that provisioned the fixture, open for the whole run. */
  admin(): Session
  /** Logs in as a fixture account (or any account) with a fresh resource; closed after the test. */
  login(
    user: string,
    options?: { readonly password?: string; readonly resource?: string },
  ): Promise<Session>
  /** Logs in and returns the outcome, so a refusal can be checked. Closed after the test. */
  tryLogin(login: Login): Outcome<Session>
  /** A SASL ANONYMOUS session (D20); closed after the test. */
  anonymous(): Promise<Session>
  /** Another admin session; closed after the test. */
  adminSession(): Promise<Session>
  /** A room's JID on the MUC service. */
  room(localpart: string): RoomJid
  /** A fixture account's bare JID. */
  jid(user: string): string
}
