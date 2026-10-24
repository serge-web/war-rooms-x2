// Admin operations over XMPP with the admin's own session: XEP-0133 ad-hoc commands and MUC owner
// (XEP-0045). Adapted from serge-web/xmpp-spike spike/tests/provision/xmpp-admin.ts (commit 4992530):
// adhoc(), admin.* and leaveRoom() are the spike's; ensureRoom() is trimmed (no convergence pass)
// and configureRoom() is split out so tests can flip single options.

import type { Constants, Stanzas } from 'stanza';
import type { Client } from './harness.js';

type DataFormField = Stanzas.DataFormField;
type MUCAffiliation = Constants.MUCAffiliation;

export const ADMIN_NS = 'http://jabber.org/protocol/admin';

/** The defined-condition of an IQ error thrown by StanzaJS, if any. */
export function errorCondition(e: unknown): string | undefined {
  return (e as { error?: { condition?: string } }).error?.condition;
}

/** Run a two-step ad-hoc command: execute to get the form, then complete with our values. */
export async function adhoc(client: Client, to: string, node: string, values: Record<string, string | string[]>, formType = ADMIN_NS) {
  const first = await client.sendIQ({ to, type: 'set', command: { node, action: 'execute' } });
  const cmd = first.command;
  if (!cmd) throw new Error(`${node}: no command payload`);
  if (cmd.status === 'completed') return cmd;
  // Fit our values to the form the server returned (ejabberd end-user-session uses `accountjid`
  // where XEP-0133 specifies `accountjids`).
  const offered = new Set((cmd.form?.fields ?? []).map((f) => f.name));
  const fit = (name: string, value: string | string[]): [string, string | string[]] => {
    if (offered.size === 0 || offered.has(name)) return [name, value];
    if (name.endsWith('s') && offered.has(name.slice(0, -1))) return [name.slice(0, -1), Array.isArray(value) ? value[0]! : value];
    if (offered.has(`${name}s`)) return [`${name}s`, Array.isArray(value) ? value : [value]];
    return [name, value];
  };
  const fields: DataFormField[] = [
    ...(formType ? [{ name: 'FORM_TYPE', type: 'hidden', value: formType } as DataFormField] : []),
    ...Object.entries(values).map(([n, v]) => {
      const [name, value] = fit(n, v);
      return { name, value } as DataFormField;
    }),
  ];
  const res = await client.sendIQ({
    to,
    type: 'set',
    command: { node, ...(cmd.sid ? { sid: cmd.sid } : {}), action: 'complete', form: { type: 'submit', fields } },
  });
  return res.command;
}

export const admin = {
  addUser: (c: Client, domain: string, jid: string, password: string) =>
    adhoc(c, domain, `${ADMIN_NS}#add-user`, { accountjid: jid, password, 'password-verify': password }),
  deleteUser: (c: Client, domain: string, jid: string) => adhoc(c, domain, `${ADMIN_NS}#delete-user`, { accountjids: [jid] }),
};

/** Leave a room and wait for the service to echo the unavailable self-presence. */
export async function leaveRoom(c: Client, roomJid: string, nick: string): Promise<void> {
  await c.leaveRoom(roomJid, nick);
}

/** Submit muc#roomconfig fields (the admin must be in the room). Rejects on unknown fields. */
export async function configureRoom(c: Client, roomJid: string, config: Record<string, string | boolean | string[]>): Promise<void> {
  const current = await c.getRoomConfig(roomJid);
  const known = new Set((current.fields ?? []).map((f) => f.name));
  const missing = Object.keys(config).filter((k) => !known.has(k));
  if (missing.length) throw new Error(`${roomJid}: server room config lacks fields ${missing.join(', ')}`);
  await c.configureRoom(roomJid, {
    type: 'submit',
    fields: [
      { name: 'FORM_TYPE', type: 'hidden', value: 'http://jabber.org/protocol/muc#roomconfig' },
      ...Object.entries(config).map(([name, value]) => ({ name, value }) as DataFormField),
    ],
  });
}

/** Create a room by joining it as owner, configure it, set affiliations, and stay in it (caller leaves). */
export async function createRoom(
  c: Client,
  roomJid: string,
  config: Record<string, string | boolean | string[]>,
  affiliations: Record<string, MUCAffiliation>,
): Promise<void> {
  await c.joinRoom(roomJid, 'admin');
  await configureRoom(c, roomJid, config);
  for (const [jid, aff] of Object.entries(affiliations)) await c.setRoomAffiliation(roomJid, jid, aff);
}

/** Read one room config field (the admin must be in the room). */
export async function roomConfigValue(c: Client, roomJid: string, field: string): Promise<unknown> {
  return (await c.getRoomConfig(roomJid)).fields?.find((f) => f.name === field)?.value;
}
