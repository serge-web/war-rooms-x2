// The backend the S15-S16 checks run against: the same ContractBackend and RawAccess the contract
// suite's ejabberd runner builds, through the real transport (as spike/s14/src/backend.ts). The
// checks take only these two, so they can move into packages/contract-suite unchanged (ARC-10).
import type { Session } from '../../../packages/transport/src/index.ts'
import { XmppSession, XmppTransport } from '../../../packages/transport-xmpp/src/index.ts'
import type { ContractBackend, Login, RawAccess } from '../../../packages/contract-suite/src/index.ts'
import { ADMIN_PASSWORD, endpoint } from './config.ts'

// Long timeout: a shaped player's 2 MB message holds its connection for about 36 s (S16).
const transport = new XmppTransport({
  timeoutMs: 120_000,
  backoff: { initialMs: 200, maxMs: 2_000 },
})

function xmpp(session: Session): XmppSession {
  if (!(session instanceof XmppSession)) throw new Error('not a session of @wrx/transport-xmpp')
  return session
}

export const backend: ContractBackend = {
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
      credentials: { kind: 'password', username: 'admin', password: ADMIN_PASSWORD },
      resource: `s1516-${Math.random().toString(36).slice(2, 8)}`,
    }),
  interrupt: (session, how) => {
    xmpp(session).interruptConnection(how)
    return Promise.resolve()
  },
}

export const raw: RawAccess = {
  send: (session, xml) => {
    xmpp(session).sendRawForTest(xml)
  },
  onIncoming: (session, listener) => xmpp(session).onRawIncomingForTest(listener),
}
