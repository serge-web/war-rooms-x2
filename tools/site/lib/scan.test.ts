import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLE_RULES, TEXT_FILE, isSiteContent, parseDenyList, scanDir, scanText } from './scan.ts'

const deny = parseDenyList(
  JSON.parse(readFileSync(new URL('../deny-list.json', import.meta.url), 'utf8')),
)
const denyIds = (text: string) => scanText('page.html', text, deny.rules).map((h) => h.rule)
const bundleIds = (text: string) => scanText('a.js', text, BUNDLE_RULES).map((h) => h.rule)

describe('deny-list (DOC-2)', () => {
  it('flags the topics the SRD keeps off the site', () => {
    expect(denyIds('<p>Rule ADM-37 needs care</p>')).toEqual(['admin-rule-ids'])
    expect(denyIds('see rules R-A to R-F')).toEqual(['admin-rule-labels', 'admin-rule-labels'])
    expect(denyIds('Risk R15 and R13.')).toEqual(['risk-ids', 'risk-ids'])
    expect(denyIds('the AdminOps module')).toEqual(['admin-ops-module'])
    expect(denyIds('Voice revocation is kept')).toEqual(['voice-revocation'])
    expect(denyIds('the stored visitor role')).toEqual(['stored-role'])
    expect(denyIds('set max_stanza_size')).toEqual(['stanza-cap'])
    expect(denyIds('Destroying a room deletes its history')).toEqual(['room-history-loss'])
    expect(denyIds('anonymous users can list node names')).toEqual(['node-name-listing'])
    expect(denyIds('auth uses SCRAM-SHA-256')).toEqual(['sasl-hardening'])
    expect(denyIds('in-band registration off')).toEqual(['registration-and-admin-surfaces'])
    expect(denyIds('a per-player rate limit')).toEqual(['rate-limits'])
    expect(denyIds('edit ejabberd.yml')).toEqual(['server-config'])
  })
  it('leaves ordinary text alone', () => {
    expect(
      denyIds(
        'Observers read but cannot post. ADM-3 edits the game. The admin publishes rooms. R2 and R150 differ.',
      ),
    ).toEqual([])
  })
  it('matches ids case-sensitively and topics in any case', () => {
    expect(denyIds('adm-37 r15')).toEqual([])
    expect(denyIds('VOICE REVOCATION')).toEqual(['voice-revocation'])
  })
  it('has unique ids and checks its allowances', () => {
    expect(() =>
      parseDenyList({
        terms: [{ id: 'a', pattern: 'x', why: 'w' }],
        allow: [{ rule: 'b', file: 'f', reason: 'r' }],
      }),
    ).toThrow(/unknown term/)
    expect(() =>
      parseDenyList({
        terms: [
          { id: 'a', pattern: 'x', why: 'w' },
          { id: 'a', pattern: 'y', why: 'w' },
        ],
        allow: [],
      }),
    ).toThrow(/Duplicate/)
  })
})

describe('isSiteContent', () => {
  it('reads pages, page chunks and the search index, not libraries or app builds', () => {
    expect(isSiteContent('index.html')).toBe(true)
    expect(isSiteContent('blog/post.html')).toBe(true)
    expect(isSiteContent('assets/architecture.md.B_6liSuL.js')).toBe(true)
    expect(isSiteContent('assets/blog_post.md.BCdk-Oty.lean.js')).toBe(true)
    expect(isSiteContent('assets/chunks/@localSearchIndexroot.Ng8zd68x.js')).toBe(true)
    expect(isSiteContent('assets/chunks/mermaid.core.RqE9MLoX.js')).toBe(false)
    expect(isSiteContent('app/index.html')).toBe(false)
    expect(isSiteContent('pr/3/index.html')).toBe(false)
  })
})

describe('bundle rules (NFR-1, DOC-12)', () => {
  it('flags real-server endpoints', () => {
    expect(bundleIds('const url="wss://xmpp.example.org/ws"')).toEqual(['websocket-url'])
    expect(bundleIds('connect("xmpp:admin@example.org")')).toEqual(['xmpp-uri'])
    expect(bundleIds('host:"chat.example.org:5222"')).toEqual(['xmpp-port'])
    expect(bundleIds('path:"/xmpp-websocket"')).toEqual(['xmpp-websocket-path'])
  })
  it('flags secrets', () => {
    expect(bundleIds('password:"hunter22"')).toEqual(['password-literal'])
    expect(bundleIds("const apiKey = 'abcd1234efgh'")).toEqual(['password-literal'])
    expect(bundleIds('{password:`hunter22`}')).toEqual(['password-literal'])
    // Autocomplete values are not passwords.
    expect(bundleIds('autoComplete:e===`create`?`new-password`:`current-password`')).toEqual([])
    expect(bundleIds(`t="ghp_${'a'.repeat(36)}"`)).toEqual(['token'])
    expect(bundleIds('-----BEGIN RSA PRIVATE KEY-----')).toEqual(['private-key'])
    expect(bundleIds('fetch("https://bob:pa55@host.example/")')).toEqual(['url-credentials'])
  })
  it('leaves XMPP namespaces and ordinary code alone', () => {
    expect(
      bundleIds(
        'ns="urn:xmpp:mam:2";type:"password";label:"Password";a={password:e.password};x="https://example.org/a"',
      ),
    ).toEqual([])
  })
})

describe('scanDir', () => {
  it('scans the included files and skips allowed hits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<p>line one</p>\n<p>see ADM-40</p>')
    writeFileSync(join(dir, 'assets', 'lib.js'), 'ADM-40')
    writeFileSync(join(dir, 'logo.png'), 'ADM-40')
    const result = scanDir(dir, { rules: deny.rules, include: isSiteContent })
    expect(result.files).toBe(1)
    expect(result.hits).toEqual([
      {
        file: 'index.html',
        line: 2,
        rule: 'admin-rule-ids',
        excerpt: '<p>line one</p> <p>see ADM-40</p>',
      },
    ])
    const allowed = scanDir(dir, {
      rules: deny.rules,
      include: isSiteContent,
      allow: [{ rule: 'admin-rule-ids', file: 'index.html', reason: 'test' }],
    })
    expect(allowed.hits).toEqual([])
    expect(scanDir(dir, { rules: deny.rules, include: (f) => TEXT_FILE.test(f) }).files).toBe(2)
  })
})
