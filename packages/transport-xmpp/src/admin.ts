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

/** One private-storage value: element `<value xmlns='urn:wrx:private:0:KEY'>` holding text. */
interface PrivateValue {
  readonly key: string
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
  /** Private-storage keys whose element is registered with this session's StanzaJS registry. */
  private readonly definedKeys = new Set<string>()

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

  onlineUsers(): Outcome<readonly string[]> {
    return this.core.run(async () => {
      // §4.18. The list may hold full or bare JIDs; the interface reports accounts.
      const result = await this.command('get-online-users-list', [
        { name: 'max_items', value: '1000' },
      ])
      const jids = listField(result.form, this.core.adapter.onlineUsersField)
      return [...new Set(jids.map((j) => JID.toBare(j)))]
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

  private defineKey(key: string): void {
    if (!KEY_PATTERN.test(key)) {
      throw new Refusal({ condition: 'bad-request', text: `private key ${key} is not allowed` })
    }
    if (this.definedKeys.has(key)) return
    // XEP-0049 §2: storage is keyed by the child element's namespace, so each key gets its own.
    this.core.client.stanzas.define({
      element: 'value',
      namespace: `${NS_PRIVATE}:${key}`,
      type: key,
      typeField: 'key',
      aliases: [{ path: 'iq.privateStorage.wrxPrivate', impliedType: true }],
      fields: { value: JXT.text() },
    })
    this.definedKeys.add(key)
  }

  getPrivate(key: string): Outcome<string | undefined> {
    return this.core.run(async () => {
      this.defineKey(key)
      const result = await sendIq(this.core.client, {
        type: 'get',
        privateStorage: { wrxPrivate: { key } },
      })
      // The reply holds the one element asked for (§3.2); StanzaJS does not fill in `key` when
      // reading it back. Never stored, it comes back empty.
      const value = result.privateStorage?.wrxPrivate?.value
      return value === undefined || value === '' ? undefined : value
    })
  }

  setPrivate(key: string, value: string): Outcome<void> {
    return this.core.run(async () => {
      this.defineKey(key)
      await sendIq(this.core.client, {
        type: 'set',
        privateStorage: { wrxPrivate: { key, value } },
      })
    })
  }
}
