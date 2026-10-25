// Server administration with the admin's own session: XEP-0133 Service Administration over
// XEP-0050 ad-hoc commands, and XEP-0049 private XML storage for the admin's own data.
import type { AdminApi, Outcome } from '@wrx/transport'
import { JID, JXT } from 'stanza'
import type * as XMPP from 'stanza'
import { sendIq } from './core.ts'
import type { Core } from './core.ts'
import { fieldNames, listField, submitForm } from './forms.ts'
import type { FieldValue } from './forms.ts'
import { Refusal } from './refusal.ts'

const NS_ADMIN = 'http://jabber.org/protocol/admin'
const NS_PRIVATE = 'urn:wrx:private:0'

/**
 * All of WRX1's private-storage values, as one JSON object of key → text inside
 * `<store xmlns='urn:wrx:private:0'>`. One element, because StanzaJS resolves every element
 * defined on the same path to the last one defined, so per-key elements cannot coexist.
 */
interface PrivateValue {
  readonly value?: string
}

declare module 'stanza/protocol' {
  interface PrivateStorage {
    wrxPrivate?: PrivateValue
  }
}

/** Keys become part of an XML namespace, so they are kept to a safe alphabet. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/

export class XmppAdmin implements AdminApi {
  private storeDefined = false

  constructor(private readonly core: Core) {}

  /**
   * XEP-0050 §3.4: execute the command, then complete it with our values fitted to the form the
   * server returned (`fitCommandFields`, ARC-8). A completed command whose notes include an error
   * is a refusal too (XEP-0050 §3.4.3).
   */
  private async command(
    name: string,
    values: readonly FieldValue[],
  ): Promise<XMPP.Stanzas.AdHocCommand> {
    const client = this.core.client
    const node = `${NS_ADMIN}#${name}`
    const to = this.core.domain
    const first = await sendIq(client, { to, type: 'set', command: { node, action: 'execute' } })
    const started = first.command
    if (started === undefined) throw new Refusal({ condition: 'invalid-response', text: node })
    if (started.status === 'completed') return started
    const fields = this.core.adapter.fitCommandFields(fieldNames(started.form), values)
    const done = await sendIq(client, {
      to,
      type: 'set',
      command: {
        node,
        ...(started.sid === undefined ? {} : { sid: started.sid }),
        action: 'complete',
        form: submitForm(NS_ADMIN, fields),
      },
    })
    const result = done.command
    if (result === undefined) throw new Refusal({ condition: 'invalid-response', text: node })
    const note = result.notes?.find((n) => n.type === 'error')
    if (note !== undefined) {
      throw new Refusal({ condition: 'bad-request', text: note.value ?? `${name} failed` })
    }
    return result
  }

  /** §4.18. The list may hold full or bare JIDs; the interface reports accounts. */
  private async listOnline(): Promise<string[]> {
    const result = await this.command('get-online-users-list', [
      { name: 'max_items', value: '1000' },
    ])
    const jids = listField(result.form, this.core.adapter.onlineUsersField)
    return [...new Set(jids.map((j) => JID.toBare(j)))]
  }

  onlineUsers(): Outcome<readonly string[]> {
    return this.core.run(() => this.listOnline())
  }

  registeredUsers(): Outcome<readonly string[]> {
    return this.core.run(async () => {
      // §4.17 ("none" is the form's no-limit option). ejabberd completes at once with every
      // account (the adapter records how).
      const result = await this.command('get-registered-users-list', [
        { name: 'max_items', value: 'none' },
      ])
      const jids = listField(result.form, this.core.adapter.registeredUsersField)
      const bare = [...new Set(jids.map((j) => JID.toBare(j)))]
      // Online SASL ANONYMOUS sessions are not accounts, though a server may list them.
      const anonymous = (jid: string) => this.core.adapter.isAnonymousAccount(jid)
      if (!bare.some(anonymous)) return bare
      const online = new Set(await this.listOnline())
      return bare.filter((j) => !(anonymous(j) && online.has(j)))
    })
  }

  addUser(jid: string, password: string): Outcome<void> {
    return this.core.run(async () => {
      await this.command('add-user', [
        { name: 'accountjid', value: jid },
        { name: 'password', value: password },
        { name: 'password-verify', value: password },
      ])
    })
  }

  deleteUser(jid: string): Outcome<void> {
    return this.core.run(async () => {
      try {
        await this.command('delete-user', [{ name: 'accountjids', value: [jid] }])
      } catch (reason) {
        // A missing account is success (ADM-39); how the server says so is the adapter's call.
        const error =
          reason instanceof Refusal ? reason.error : this.core.adapter.stanzaError(reason)
        if (error !== undefined && this.core.adapter.isAbsentAccount(error)) return
        throw reason
      }
    })
  }

  changePassword(jid: string, password: string): Outcome<void> {
    return this.core.run(async () => {
      await this.command('change-user-password', [
        { name: 'accountjid', value: jid },
        { name: 'password', value: password },
      ])
    })
  }

  endUserSessions(jid: string): Outcome<void> {
    return this.core.run(async () => {
      await this.command('end-user-session', [{ name: 'accountjids', value: [jid] }])
    })
  }

  private checkKey(key: string): void {
    if (!KEY_PATTERN.test(key)) {
      throw new Refusal({ condition: 'bad-request', text: `private key ${key} is not allowed` })
    }
    if (this.storeDefined) return
    this.core.client.stanzas.define({
      element: 'store',
      namespace: NS_PRIVATE,
      path: 'iq.privateStorage.wrxPrivate',
      fields: { value: JXT.text() },
    })
    this.storeDefined = true
  }

  /** XEP-0049 §3: the stored object; empty if nothing is stored yet. */
  private async readStore(): Promise<Record<string, string>> {
    const result = await sendIq(this.core.client, {
      type: 'get',
      privateStorage: { wrxPrivate: {} },
    })
    const text = result.privateStorage?.wrxPrivate?.value
    if (text === undefined || text === '') return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Refusal({ condition: 'invalid-response', text: 'private storage is not JSON' })
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Refusal({ condition: 'invalid-response', text: 'private storage is not an object' })
    }
    const values: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') values[key] = value
    }
    return values
  }

  getPrivate(key: string): Outcome<string | undefined> {
    return this.core.run(async () => {
      this.checkKey(key)
      const value = (await this.readStore())[key]
      return value === undefined || value === '' ? undefined : value
    })
  }

  /** Read, update, write: another session writing in between can lose an update. */
  setPrivate(key: string, value: string): Outcome<void> {
    return this.core.run(async () => {
      this.checkKey(key)
      const values = { ...(await this.readStore()), [key]: value }
      await sendIq(this.core.client, {
        type: 'set',
        privateStorage: { wrxPrivate: { value: JSON.stringify(values) } },
      })
    })
  }
}
