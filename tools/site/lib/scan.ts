// Text scans of a built site: the deny-list (DOC-2) and the secrets and real-server endpoint
// scan (NFR-1, DOC-12).
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { arr, field, str } from './json.ts'

export interface Rule {
  readonly id: string
  readonly pattern: RegExp
  readonly why: string
}

export interface Allowance {
  /** Rule id. */
  readonly rule: string
  /** File path relative to the scanned folder; a trailing `/` covers a folder. */
  readonly file: string
  readonly reason: string
}

export interface Hit {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly excerpt: string
}

/** All files under `dir`, as `/`-separated paths relative to it. Skips symlinks. */
export function listFiles(dir: string): string[] {
  const out: string[] = []
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) out.push(relative(dir, path).split(sep).join('/'))
    }
  }
  visit(dir)
  return out.sort()
}

export const TEXT_FILE = /\.(?:html?|js|mjs|cjs|css|json|map|md|txt|svg|xml|webmanifest)$/i

export function scanText(file: string, text: string, rules: readonly Rule[]): Hit[] {
  const hits: Hit[] = []
  for (const rule of rules) {
    const global = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace('g', '')}g`)
    for (const match of text.matchAll(global)) {
      const index = match.index
      const line = text.slice(0, index).split('\n').length
      const from = Math.max(0, index - 30)
      const excerpt = text
        .slice(from, index + match[0].length + 30)
        .replace(/\s+/g, ' ')
        .trim()
      hits.push({ file, line, rule: rule.id, excerpt })
    }
  }
  return hits
}

export function isAllowed(hit: Hit, allow: readonly Allowance[]): boolean {
  return allow.some(
    (a) =>
      a.rule === hit.rule &&
      (a.file.endsWith('/') ? hit.file.startsWith(a.file) : a.file === hit.file),
  )
}

export interface ScanOptions {
  readonly rules: readonly Rule[]
  readonly allow?: readonly Allowance[]
  /** Which files to read, by relative path. */
  readonly include: (file: string) => boolean
}

export function scanDir(dir: string, options: ScanOptions): { files: number; hits: Hit[] } {
  const files = listFiles(dir).filter(options.include)
  const hits = files.flatMap((file) =>
    scanText(file, readFileSync(join(dir, file), 'utf8'), options.rules).filter(
      (hit) => !isAllowed(hit, options.allow ?? []),
    ),
  )
  return { files: files.length, hits }
}

export interface DenyList {
  readonly rules: Rule[]
  readonly allow: Allowance[]
}

/**
 * Reads `deny-list.json`: `{ terms: [{ id, pattern, flags?, why }], allow: [{ rule, file,
 * reason }] }`. Flags default to case-insensitive, so a reworded heading still matches.
 */
export function parseDenyList(json: unknown): DenyList {
  const rules = arr(field(json, 'terms'), 'terms').map((term, i) => {
    const flags = field(term, 'flags') ?? 'i'
    return {
      id: str(field(term, 'id'), `terms[${i}].id`),
      pattern: new RegExp(str(field(term, 'pattern'), `terms[${i}].pattern`), str(flags, 'flags')),
      why: str(field(term, 'why'), `terms[${i}].why`),
    }
  })
  const ids = new Set(rules.map((r) => r.id))
  if (ids.size !== rules.length) throw new Error('Duplicate deny-list term ids')
  const allow = arr(field(json, 'allow'), 'allow').map((entry, i) => ({
    rule: str(field(entry, 'rule'), `allow[${i}].rule`),
    file: str(field(entry, 'file'), `allow[${i}].file`),
    reason: str(field(entry, 'reason'), `allow[${i}].reason`),
  }))
  for (const entry of allow) {
    if (!ids.has(entry.rule)) throw new Error(`Allowance for unknown term ${entry.rule}`)
  }
  return { rules, allow }
}

/**
 * Built files that carry the site's own words: the HTML pages, VitePress's per-page chunks
 * (`*.md.<hash>.js`) and its search index. Library chunks and the app builds are left out:
 * minified code is full of accidental matches for short ids such as `R15`.
 */
export function isSiteContent(file: string): boolean {
  if (/^(?:app|demo|pr|snapshots)\//.test(file)) return false
  if (file.endsWith('.html')) return true
  return /^assets\/(?:.*\.md\.[\w-]+(?:\.lean)?\.js|chunks\/@localSearchIndex[\w-]*\.[\w-]+\.js)$/.test(
    file,
  )
}

/**
 * Secrets (NFR-1) and real-server endpoints (DOC-12). Previews, the demo and snapshots run on
 * the mock only, so none of these belongs in them.
 */
export const BUNDLE_RULES: readonly Rule[] = Object.freeze([
  {
    id: 'websocket-url',
    pattern: /\bwss?:\/\/[^\s"'`<>]/,
    why: 'A WebSocket URL: preview builds must not name a real server (DOC-12)',
  },
  {
    id: 'xmpp-uri',
    pattern: /(?<!urn:)\bxmpp:(?!\s)[^\s"'`<>]/,
    why: 'An XMPP URI names a real account or server (DOC-12)',
  },
  {
    id: 'xmpp-port',
    pattern: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+:(?:5222|5223|5269|5280|5443)\b/i,
    why: 'A host on an XMPP port (DOC-12)',
  },
  {
    id: 'xmpp-websocket-path',
    pattern: /\/xmpp-websocket\b|\/http-bind\b|\/bosh\b/,
    why: 'An XMPP WebSocket or BOSH endpoint path (DOC-12)',
  },
  {
    id: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    why: 'A private key (NFR-1)',
  },
  {
    id: 'token',
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/,
    why: 'An access token (NFR-1)',
  },
  {
    id: 'password-literal',
    pattern:
      /\b(?:password|passwd|pwd|secret|client_?secret|api_?key|access_?key)["'`]?\s*[:=]\s*["'`][^"'`\s]{4,}["'`]/i,
    why: 'A password or key assigned a literal value (NFR-1)',
  },
  {
    id: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`<>]+:[^\s/@"'`<>]+@[^\s"'`<>]/i,
    why: 'Credentials embedded in a URL (NFR-1)',
  },
])
