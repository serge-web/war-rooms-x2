// Screenshot manifests and the before/after comparison against main (DOC-19, DOC-21).
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isObject } from '../../site/lib/json.ts'

export const MANIFEST = 'manifest.json'
export const BEFORE_DIR = 'before'

/** Shot name → SHA-256 of its PNG. Shots are compared by hash, so captures must be repeatable. */
export interface Manifest {
  readonly version: 1
  readonly shots: Readonly<Record<string, string>>
}

export type ShotStatus = 'new' | 'changed' | 'unchanged' | 'removed'

export interface ShotChange {
  readonly name: string
  readonly status: ShotStatus
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isShotName(name: string): boolean {
  return name.length <= 80 && NAME.test(name)
}

/** Hashes every `<name>.png` directly in `dir`. */
export function hashDir(dir: string): Manifest {
  const shots: Record<string, string> = {}
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.png')) continue
    const name = file.slice(0, -'.png'.length)
    if (!isShotName(name)) throw new Error(`Bad screenshot name: ${file}`)
    shots[name] = createHash('sha256')
      .update(readFileSync(join(dir, file)))
      .digest('hex')
  }
  return { version: 1, shots }
}

/** Reads a manifest, or `undefined` if there is none or it is unreadable (main has no shots yet). */
export function readManifest(dir: string): Manifest | undefined {
  const path = join(dir, MANIFEST)
  if (!existsSync(path)) return undefined
  try {
    return parseManifest(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return undefined
  }
}

export function parseManifest(value: unknown): Manifest | undefined {
  if (!isObject(value) || value.version !== 1 || !isObject(value.shots)) return undefined
  const shots: Record<string, string> = {}
  for (const [name, hash] of Object.entries(value.shots)) {
    if (!isShotName(name) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      return undefined
    }
    shots[name] = hash
  }
  return { version: 1, shots }
}

/** Every shot in either manifest, with how it changed; sorted by name. */
export function compare(base: Manifest | undefined, head: Manifest): ShotChange[] {
  const before = base?.shots ?? {}
  const names = [...new Set([...Object.keys(before), ...Object.keys(head.shots)])].sort()
  return names.map((name) => {
    const was = before[name]
    const now = head.shots[name]
    const status: ShotStatus =
      now === undefined
        ? 'removed'
        : was === undefined
          ? 'new'
          : was === now
            ? 'unchanged'
            : 'changed'
    return { name, status }
  })
}

export interface SectionOptions {
  /** URL of the PR preview's `screenshots/` folder, ending in `/`. */
  readonly shotsUrl: string
  /** False when main has no screenshots yet, so nothing can be compared. */
  readonly hasBase: boolean
}

/** The screenshots section of the PR's bot comment (DOC-19, DOC-21). */
export function commentSection(changes: readonly ShotChange[], options: SectionOptions): string {
  const count = (status: ShotStatus) => changes.filter((c) => c.status === status).length
  const lines = ['### Screenshots', '']
  if (!options.hasBase) {
    lines.push('main has no screenshots yet, so every shot is shown as new.', '')
  }
  lines.push(
    `${count('changed')} changed, ${count('new')} new, ${count('removed')} removed, ${count('unchanged')} unchanged.`,
  )
  const image = (path: string, alt: string) =>
    `<img src="${options.shotsUrl}${path}" alt="${alt}" width="400">`
  for (const change of changes) {
    if (change.status === 'changed') {
      lines.push(
        '',
        `#### ${change.name} (changed)`,
        '',
        '| main | this PR |',
        '| --- | --- |',
        `| ${image(`${BEFORE_DIR}/${change.name}.png`, `${change.name} on main`)} | ${image(`${change.name}.png`, `${change.name} in this PR`)} |`,
      )
    } else if (change.status === 'new') {
      lines.push('', `#### ${change.name} (new)`, '', image(`${change.name}.png`, change.name))
    }
  }
  const removed = changes.filter((c) => c.status === 'removed').map((c) => `\`${c.name}\``)
  if (removed.length > 0) lines.push('', `Removed: ${removed.join(', ')}.`)
  return lines.join('\n')
}

/** The section when the PR touches no UI or site files, so nothing was captured. */
export function skippedSection(): string {
  return [
    '### Screenshots',
    '',
    'This PR changes no UI or site files, so no screenshots were taken.',
  ].join('\n')
}
