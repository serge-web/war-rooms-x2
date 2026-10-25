// Playwright check (WP 1.3): the production bundle of the transport loads in Chromium with no
// page errors, which catches a missing polyfill such as `events` (WP 0.3). With WRX_XMPP_WS set
// (the contract CI job sets it), the bundle also logs in anonymously over wss:// to the reference
// ejabberd; the browser trusts the test certificate by pinning its key, not by ignoring errors.
import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { build, preview } from 'vite'
import type { PreviewServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname)
const websocketUrl = process.env.WRX_XMPP_WS
const domain = process.env.WRX_XMPP_DOMAIN ?? 'localhost'
const serverCert =
  process.env.WRX_XMPP_CERT ?? resolve(root, '../../../deploy/ejabberd/tls-out/server.crt')

let server: PreviewServer | undefined
let browser: Browser | undefined

function keyPin(certFile: string): string {
  const cert = new X509Certificate(readFileSync(certFile))
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(spki).digest('base64')
}

beforeAll(async () => {
  await build({ root, base: './', logLevel: 'warn', build: { outDir: 'dist', emptyOutDir: true } })
  server = await preview({ root, logLevel: 'warn', preview: { port: 0, host: '127.0.0.1' } })
  const args =
    websocketUrl === undefined
      ? []
      : [`--ignore-certificate-errors-spki-list=${keyPin(serverCert)}`]
  browser = await chromium.launch({ args })
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

async function open(query: string): Promise<{ text: string; errors: string[] }> {
  const base = server?.resolvedUrls?.local[0]
  if (base === undefined || browser === undefined) throw new Error('no preview server or browser')
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(new URL(`index.html${query}`, base).href)
  await page.waitForFunction(
    () => document.querySelector('#state')?.textContent !== 'loading',
    undefined,
    {
      timeout: 20_000,
    },
  )
  const text = (await page.textContent('#state')) ?? ''
  await page.close()
  return { text, errors }
}

describe('transport-xmpp production bundle in Chromium', () => {
  it('loads with no page errors', async () => {
    const r = await open('')
    expect(r.errors).toEqual([])
    expect(r.text).toBe('loaded xmpp')
  })

  it.runIf(websocketUrl !== undefined)('logs in anonymously over wss://', async () => {
    const query = `?ws=${encodeURIComponent(websocketUrl ?? '')}&domain=${encodeURIComponent(domain)}`
    const r = await open(query)
    expect(r.errors).toEqual([])
    expect(r.text).toMatch(new RegExp(`^online \\S+@${domain}/\\S+ pubsub\\.`))
  })
})
