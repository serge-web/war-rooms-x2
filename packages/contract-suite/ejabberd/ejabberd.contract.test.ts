// The contract suite against the reference ejabberd (deploy/ejabberd), through the real
// transport. Run with `pnpm --filter @wrx/contract-suite test:ejabberd` after `pnpm stack:up`.
// An unreachable server fails every test (NFR-16).
import type { Session } from '@wrx/transport'
import { XmppSession, XmppTransport } from '@wrx/transport-xmpp'
import { defineContractSuite } from '../src/index.ts'
import type { ContractBackend, Login, RawAccess } from '../src/index.ts'

const endpoint = {
  websocketUrl: process.env.WRX_XMPP_WS ?? 'wss://localhost:35443/ws',
  domain: process.env.WRX_XMPP_DOMAIN ?? 'localhost',
}
/** Set by deploy/ejabberd/bootstrap.sh for a throwaway local container; not a product secret. */
const adminPassword = process.env.WRX_ADMIN_PASSWORD ?? 'spike-password'

const transport = new XmppTransport({
  timeoutMs: 10_000,
  backoff: { initialMs: 200, maxMs: 2_000 },
})

function xmpp(session: Session): XmppSession {
  if (!(session instanceof XmppSession)) throw new Error('not a session of @wrx/transport-xmpp')
  return session
}

const backend: ContractBackend = {
  name: 'ejabberd',
  domain: endpoint.domain,
  connect: (login: Login) =>
    transport.connect({
      endpoint,
      credentials:
        login.kind === 'anonymous'
          ? { kind: 'anonymous' }
          : { kind: 'password', username: login.username, password: login.password },
      ...(login.resource === undefined ? {} : { resource: login.resource }),
    }),
  admin: () =>
    transport.connect({
      endpoint,
      credentials: { kind: 'password', username: 'admin', password: adminPassword },
      resource: `contract-${Math.random().toString(36).slice(2, 8)}`,
    }),
  interrupt: (session, how) => {
    xmpp(session).interruptConnection(how)
    return Promise.resolve()
  },
}

const raw: RawAccess = {
  send: (session, xml) => {
    xmpp(session).sendRawForTest(xml)
  },
  onIncoming: (session, listener) => xmpp(session).onRawIncomingForTest(listener),
}

defineContractSuite(backend, { raw })
