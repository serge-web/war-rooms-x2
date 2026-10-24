// Thin helpers over StanzaJS 12.22.1, used by the live test (Node) and the demo page (browser).
// Written to the repo's TypeScript rules (strict, noUncheckedIndexedAccess, no `any`). Every cast that
// StanzaJS's types force on us is marked `CAST:` with the reason; those are the typing gaps.

import * as XMPP from 'stanza';
import type { Endpoints } from './endpoints.ts';
import { NS_ADMIN } from './endpoints.ts';

export type Agent = XMPP.Agent;
type DataForm = XMPP.Stanzas.DataForm;
type DataFormField = XMPP.Stanzas.DataFormField;
type AdHocCommand = XMPP.Stanzas.AdHocCommand;
// sendIQ's response type defaults to an echo of the request literal; always pass <IQ> (see typing-probes.ts).
type IQ = XMPP.Stanzas.IQ;

export type Login = { kind: 'password'; user: string; password: string } | { kind: 'anonymous' };

export interface Session {
  client: Agent;
  /** SASL mechanism the client actually used, read from the outgoing <auth/>. */
  mechanism: string | undefined;
}

const ALL_BUT_ANONYMOUS = ['EXTERNAL', 'SCRAM-SHA-256-PLUS', 'SCRAM-SHA-256', 'SCRAM-SHA-1-PLUS', 'SCRAM-SHA-1', 'DIGEST-MD5', 'OAUTHBEARER', 'X-OAUTH2', 'PLAIN'];

/** Connect over WebSocket and resolve at session start. Rejects (never hangs) if the server is unreachable. */
export function connect(ep: Endpoints, login: Login, opts: { resource?: string; timeoutMs?: number; autoReconnect?: boolean } = {}): Promise<Session> {
  const client = XMPP.createClient({
    jid: login.kind === 'anonymous' ? ep.domain : `${login.user}@${ep.domain}`,
    ...(login.kind === 'password' ? { password: login.password } : {}),
    ...(opts.resource ? { resource: opts.resource } : {}),
    transports: { websocket: ep.websocketUrl, bosh: false },
    allowResumption: true,
    autoReconnect: opts.autoReconnect ?? false,
  });
  if (login.kind === 'anonymous') {
    // StanzaJS picks the highest-priority mechanism the server offers without checking that it has the
    // credentials for it (open PR legastero/stanza#489), and ranks ANONYMOUS lowest. Disable the rest.
    for (const m of ALL_BUT_ANONYMOUS) client.sasl.disable(m);
  }
  const session: Session = { client, mechanism: undefined };
  const onOut = (xml: string): void => {
    const m = /<auth[^>]*\bmechanism="([^"]+)"/.exec(xml);
    if (m) session.mechanism = m[1];
  };
  client.on('raw:outgoing', onOut);

  const timeoutMs = opts.timeoutMs ?? 10_000;
  return new Promise<Session>((resolve, reject) => {
    const done = (err?: Error): void => {
      clearTimeout(timer);
      client.off('session:started', onStarted);
      client.off('auth:failed', onAuthFailed);
      client.off('disconnected', onDisconnected);
      if (err) {
        client.off('raw:outgoing', onOut);
        client.disconnect();
        reject(err);
      } else {
        resolve(session);
      }
    };
    const onStarted = (): void => done();
    const onAuthFailed = (): void => done(new Error(`${ep.websocketUrl}: authentication failed`));
    const onDisconnected = (): void => done(new Error(`${ep.websocketUrl}: disconnected before session start (server unreachable or TLS refused)`));
    const timer = setTimeout(() => done(new Error(`${ep.websocketUrl}: no session after ${timeoutMs} ms`)), timeoutMs);
    client.on('session:started', onStarted);
    client.on('auth:failed', onAuthFailed);
    client.on('disconnected', onDisconnected);
    client.connect();
  });
}

export function disconnect(client: Agent): Promise<void> {
  return new Promise((resolve) => {
    if (!client.transport) return resolve();
    client.once('disconnected', () => resolve());
    client.disconnect();
  });
}

/** The XMPP defined condition of a rejected StanzaJS IQ promise. StanzaJS rejects with the error IQ itself. */
export function errorCondition(e: unknown): string | undefined {
  // Rejections are untyped (`any` in the promise). Narrow structurally instead of casting.
  if (typeof e !== 'object' || e === null || !('error' in e)) return undefined;
  const err = e.error;
  if (typeof err !== 'object' || err === null || !('condition' in err)) return undefined;
  return typeof err.condition === 'string' ? err.condition : undefined;
}

/** A plain field-value map turned into a submit form with FORM_TYPE. */
export function submitForm(formType: string, values: Record<string, string | boolean | string[]>): DataForm {
  const fields: DataFormField[] = [{ name: 'FORM_TYPE', type: 'hidden', value: formType }];
  for (const [name, value] of Object.entries(values)) fields.push({ name, value });
  return { type: 'submit', fields };
}

/**
 * XEP-0133 via XEP-0050: execute, then complete with our values. Fits field names to what the server
 * offers (ejabberd uses `accountjid` where XEP-0133 says `accountjids`; see the spike's xmpp-admin.ts).
 */
export async function adhoc(client: Agent, to: string, command: string, values: Record<string, string | string[]>): Promise<AdHocCommand> {
  const node = `${NS_ADMIN}#${command}`;
  const first = await client.sendIQ<IQ>({ to, type: 'set', command: { node, action: 'execute' } });
  const cmd = first.command;
  if (!cmd) throw new Error(`${node}: no command payload`);
  if (cmd.status === 'completed') return cmd;
  const offered = new Set((cmd.form?.fields ?? []).map((f) => f.name));
  const fitted: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(values)) {
    if (offered.has(name)) fitted[name] = value;
    else if (name.endsWith('s') && offered.has(name.slice(0, -1))) fitted[name.slice(0, -1)] = Array.isArray(value) ? (value[0] ?? '') : value;
    else if (offered.has(`${name}s`)) fitted[`${name}s`] = Array.isArray(value) ? value : [value];
    else fitted[name] = value;
  }
  const res = await client.sendIQ<IQ>({
    to,
    type: 'set',
    command: { node, ...(cmd.sid ? { sid: cmd.sid } : {}), action: 'complete', form: submitForm(NS_ADMIN, fitted) },
  });
  const done = res.command;
  if (!done) throw new Error(`${node}: no command payload in completion`);
  const errorNote = done.notes?.find((n) => n.type === 'error');
  if (errorNote) throw new Error(`${node}: ${errorNote.value ?? 'error note'}`);
  return done;
}

/** First value of a named field in a form, as a string. */
export function fieldValue(form: DataForm | undefined, name: string): string | undefined {
  const f = form?.fields?.find((x) => x.name === name);
  if (!f || f.value === undefined) return undefined;
  return Array.isArray(f.value) ? f.value.join('\n') : String(f.value);
}
