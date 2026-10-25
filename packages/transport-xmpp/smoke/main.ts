// The transport in a production browser bundle (WP 1.3). Loading the page proves the bundle runs
// with the polyfills it declares (`events`, WP 0.3); with `?ws=…&domain=…` it also logs in
// anonymously, which needs the browser's SCRAM-free ANONYMOUS path and the wss:// transport.
// Endpoints come from the page URL, never from build constants (NFR-9).
import { XmppTransport } from '../src/index.ts'

const output = document.querySelector('#state')
const show = (text: string): void => {
  if (output !== null) output.textContent = text
}

const params = new URLSearchParams(location.search)
const websocketUrl = params.get('ws')
const domain = params.get('domain')
const transport = new XmppTransport({ timeoutMs: 10_000 })

if (websocketUrl === null || domain === null) {
  show(`loaded ${transport.kind}`)
} else {
  void transport
    .connect({ endpoint: { websocketUrl, domain }, credentials: { kind: 'anonymous' } })
    .then(async (result) => {
      if (!result.ok) {
        show(`failed ${result.error.condition}`)
        return
      }
      const session = result.value
      show(`online ${session.jid} ${session.services.pubsub}`)
      await session.disconnect()
    })
}
