// Server administration over XMPP with the admin's own session (D10, ADM-12): XEP-0133 Service
// Administration, plus private storage for the admin's own data (XEP-0049).
import type { Outcome } from './errors.ts'

export interface AdminApi {
  /** Bare JIDs of accounts currently online (XEP-0133 §4.18). */
  onlineUsers(): Outcome<readonly string[]>
  /** §4.1. Fails `conflict` if the account exists. */
  addUser(jid: string, password: string): Outcome<void>
  /** §4.2. A missing account is success: it is already gone (ADM-39, R-E). */
  deleteUser(jid: string): Outcome<void>
  /** §4.7. Does not end current sessions (PLY-31). */
  changePassword(jid: string, password: string): Outcome<void>
  /** §4.6. Ends every session of the account; they see `session-ended` (PLY-50). */
  endUserSessions(jid: string): Outcome<void>
  /**
   * XEP-0049 private XML storage for this account, holding one JSON string per key. The
   * observer-password vault keeps only ciphertext here (ADM-37).
   */
  getPrivate(key: string): Outcome<string | undefined>
  setPrivate(key: string, value: string): Outcome<void>
}
