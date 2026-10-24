// The production bundles (vite build) running in headless Chromium against the reference ejabberd over wss://.
// Proves both libraries work in a real browser with only the polyfills listed in package.json (`events`).
// The test CA is trusted by pinning the server key (--ignore-certificate-errors-spki-list), not by turning
// certificate checks off. Fails (never skips) when the server or the browser is unavailable.

import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';
import { adminPassword, assertReachable, endpoints as ep, setupOrFail } from './env.ts';

const root = resolve(import.meta.dirname, '..');
let server: PreviewServer;
let browser: Browser;

function serverKeyPin(): string {
  const cert = new X509Certificate(readFileSync(resolve(root, 'docker/tls-out/server.crt')));
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('base64');
}

setupOrFail(async () => {
  await assertReachable();
  await build({ root, logLevel: 'warn' });
  server = await preview({ root, logLevel: 'warn', preview: { port: 0, host: '127.0.0.1' } });
  browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${serverKeyPin()}`] });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function login(pageName: string, user: string, password: string): Promise<{ text: string; errors: string[] }> {
  const base = server.resolvedUrls?.local[0];
  if (!base) throw new Error('vite preview has no URL');
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(new URL(`${pageName}.html`, base).href);
  await page.fill('[name=url]', ep.websocketUrl);
  await page.fill('[name=domain]', ep.domain);
  await page.fill('[name=user]', user);
  await page.fill('[name=password]', password);
  await page.click('button');
  await page.waitForFunction(() => (document.querySelector('output')?.textContent ?? '').length > 0, undefined, { timeout: 15_000 });
  const text = (await page.textContent('output')) ?? '';
  await page.close();
  return { text, errors };
}

describe('production bundles in Chromium over wss://', () => {
  it('StanzaJS bundle logs in with SCRAM-SHA-256', async () => {
    const r = await login('stanza', 'admin', adminPassword);
    expect(r.errors).toEqual([]);
    expect(r.text).toMatch(/^stanza: online as admin@localhost\/\S+ via SCRAM-SHA-256$/);
  });

  it('StanzaJS bundle logs in anonymously', async () => {
    const r = await login('stanza', '', '');
    expect(r.errors).toEqual([]);
    expect(r.text).toMatch(/via ANONYMOUS$/);
  });

  it('@xmpp/client bundle logs in, but only with PLAIN (no SCRAM in its browser build)', async () => {
    const r = await login('xmppjs', 'admin', adminPassword);
    expect(r.errors).toEqual([]);
    expect(r.text).toMatch(/^xmpp\.js: online as admin@localhost\/\S+ via PLAIN;/);
  });
});
