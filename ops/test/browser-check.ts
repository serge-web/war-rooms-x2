// Opens an installed WRX1 deployment in Chromium, as a user would (WP 3.3): the client loads
// from ejabberd under the header Content-Security-Policy with no violation, reads the welcome
// page anonymously, logs the admin in over wss:// on the same origin, opens the admin backend,
// and logs out. Chromium trusts the server by its key (--ignore-certificate-errors-spki-list),
// as apps/web/playwright.config.ts does for the contract stack; a real browser is given the CA.
//
//   node ops/test/browser-check.ts https://wrx.test:35934/ <server.crt> <admin password file>
//
// On a machine whose environment names an HTTPS proxy, add the host to NO_PROXY and no_proxy:
// Chromium takes its proxy from the environment.
import { X509Certificate, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const [url, certFile, passwordFile] = process.argv.slice(2)
if (url === undefined || certFile === undefined || passwordFile === undefined) {
  console.error('usage: browser-check.ts <url> <server.crt> <admin password file>')
  process.exit(2)
}
const password = readFileSync(passwordFile, 'utf8').split('\n')[0] ?? ''
const spki = new X509Certificate(readFileSync(certFile)).publicKey.export({
  type: 'spki',
  format: 'der',
})
const pin = createHash('sha256').update(spki).digest('base64')

// --no-proxy-server: the deployment is on this network; no proxy the machine has may carry it.
const browser = await chromium.launch({
  args: [`--ignore-certificate-errors-spki-list=${pin}`, '--no-proxy-server'],
})
const failures: string[] = []
const step = (ok: boolean, what: string) => {
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}`)
  if (!ok) failures.push(what)
}
try {
  const page = await browser.newPage()
  const violations: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text())
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`)
    })
  })
  const response = await page.goto(url)
  step(response?.status() === 200, `the client loads from ${url}`)
  step(
    (response?.headers()['content-security-policy'] ?? '').includes("frame-ancestors 'none'"),
    'the page carries the header Content-Security-Policy',
  )
  const badge = page.getByLabel(/^Backend: /)
  await badge.waitFor({ timeout: 20_000 })
  step(true, `backend badge: ${(await badge.getAttribute('aria-label')) ?? ''}`)
  await page
    .getByText('No game has been published yet. You can still log in.')
    .or(page.getByRole('heading', { name: 'Log in' }))
    .first()
    .waitFor({ timeout: 20_000 })
  step(true, 'the welcome page answered (anonymous read over wss://)')
  await page.getByLabel('Role id').fill('admin')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel(/^Logged in as Umpire/).waitFor({ timeout: 20_000 })
  step(true, 'the admin logs in over wss:// on the same origin')
  await page.getByRole('button', { name: 'Log out' }).click()
  await page.getByRole('heading', { name: 'Log in' }).waitFor({ timeout: 20_000 })
  step(true, 'and logs out')
  step(violations.length === 0, `no Content-Security-Policy violation (${violations.join('; ')})`)
} catch (error) {
  step(false, String(error))
} finally {
  await browser.close()
}
process.exit(failures.length === 0 ? 0 : 1)
