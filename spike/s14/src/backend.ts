// The backend the S14 checks run against: the same ContractBackend and RawAccess the contract
// suite's ejabberd runner builds (packages/contract-suite/ejabberd/ejabberd.contract.test.ts),
// through the real transport. The checks take only these two, so they can move into
// packages/contract-suite unchanged (ARC-10).
import type { Session } from '../../../packages/transport/src/index.ts'
import { XmppSession, XmppTransport } from '../../../packages/transport-xmpp/src/index.ts'
import type { ContractBackend, Login, RawAccess } from '../../../packages/contract-suite/src/index.ts'
import { ADMIN_PASSWORD, endpoint } from './config.ts'

const transport = new XmppTransport({
  timeoutMs: 20_000,
  backoff: { initialMs: 200, maxMs: 2_000 },
})

function xmpp(session: Session): XmppSession {
  if (!(session instanceof XmppSession)) throw new Error('not a session of @wrx/transport-xmpp')
  return session
}

/** A contract backend for the server at `at` (the config under test by default). */
export function makeBackend(at: { websocketUrl: string; domain: string } = endpoint): ContractBackend {
  return {
    name: 'ejabberd',
    domain: at.domain,
    connect: (login: Login) =>
      transport.connect({
        endpoint: at,
        credentials:
          login.kind === 'anonymous'
            ? { kind: 'anonymous' }
            : { kind: 'password', username: login.username, password: login.password },
        ...(login.resource === undefined ? {} : { resource: login.resource }),
      }),
    admin: () =>
      transport.connect({
        endpoint: at,
        credentials: { kind: 'password', username: 'admin', password: ADMIN_PASSWORD },
        resource: `s14-${Math.random().toString(36).slice(2, 8)}`,
      }),
    interrupt: (session, how) => {
      xmpp(session).interruptConnection(how)
      return Promise.resolve()
    },
  }
}

export const backend: ContractBackend = makeBackend()

export const raw: RawAccess = {
  send: (session, xml) => {
    xmpp(session).sendRawForTest(xml)
  },
  onIncoming: (session, listener) => xmpp(session).onRawIncomingForTest(listener),
}
