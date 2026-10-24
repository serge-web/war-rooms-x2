// Where each deployment lives on gh-pages, and the base path it is built for (DOC-6, DOC-11,
// DOC-16, DOC-24).

export type Target =
  | { readonly kind: 'root' }
  | { readonly kind: 'demo' }
  | { readonly kind: 'pr'; readonly number: number }
  | { readonly kind: 'snapshot'; readonly slug: string }

/** Top-level gh-pages folders that a root deploy must leave alone. */
export const RESERVED: readonly string[] = Object.freeze(['pr', 'demo', 'snapshots'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSlug(value: string): boolean {
  return value.length <= 80 && SLUG.test(value)
}

/** Parses `root`, `demo`, `pr/<n>` or `snapshots/<slug>`. */
export function parseTarget(value: string): Target {
  if (value === 'root' || value === '.' || value === '') return { kind: 'root' }
  if (value === 'demo') return { kind: 'demo' }
  const pr = /^pr\/([1-9]\d{0,6})$/.exec(value)
  if (pr) return { kind: 'pr', number: Number(pr[1]) }
  const snapshot = /^snapshots\/(.+)$/.exec(value)
  if (snapshot?.[1] !== undefined && isSlug(snapshot[1])) {
    return { kind: 'snapshot', slug: snapshot[1] }
  }
  throw new Error(`Not a deploy target: ${JSON.stringify(value)}`)
}

/** The target's folder on gh-pages, relative to its root; `''` for the root. */
export function targetDir(target: Target): string {
  switch (target.kind) {
    case 'root':
      return ''
    case 'demo':
      return 'demo'
    case 'pr':
      return `pr/${target.number}`
    case 'snapshot':
      return `snapshots/${target.slug}`
  }
}

/** A URL path that starts and ends with `/` and holds only safe characters. */
export function normaliseBase(value: string): string {
  const withSlashes = `/${value}/`.replace(/\/{2,}/g, '/')
  if (!/^[A-Za-z0-9._~/-]+$/.test(withSlashes) || withSlashes.split('/').includes('..')) {
    throw new Error(`Unsafe base path: ${JSON.stringify(value)}`)
  }
  return withSlashes
}

export interface PagesLocation {
  /** URL path of the gh-pages root on its host, e.g. `/war-rooms-x2/`. */
  readonly root: string
  /** Absolute URL of the gh-pages root, when it can be known. */
  readonly url: string | undefined
}

export interface PagesSettings {
  /** `owner/name`, as in GITHUB_REPOSITORY. */
  readonly repository?: string | undefined
  /** Overrides, from the SITE_PAGES_ROOT and SITE_PAGES_URL repo variables. */
  readonly root?: string | undefined
  readonly url?: string | undefined
}

/**
 * GitHub serves a project site at `https://<owner>.github.io/<name>/`, and the
 * `<owner>.github.io` repo at the domain root. A custom domain needs both overrides.
 */
export function pagesLocation(settings: PagesSettings): PagesLocation {
  const [owner, name] = (settings.repository ?? '').split('/')
  const known = owner !== undefined && owner !== '' && name !== undefined && name !== ''
  const userSite = known && name.toLowerCase() === `${owner.toLowerCase()}.github.io`
  const root = nonEmpty(settings.root)
    ? normaliseBase(settings.root)
    : known && !userSite
      ? normaliseBase(name)
      : '/'
  let url: string | undefined
  if (nonEmpty(settings.url)) {
    url = settings.url.endsWith('/') ? settings.url : `${settings.url}/`
    if (!/^https?:\/\/[^/\s]+\//.test(url)) throw new Error(`Not a URL: ${settings.url}`)
  } else if (known) {
    url = `https://${owner.toLowerCase()}.github.io${root}`
  }
  return { root, url }
}

/** The base path a target is built for. */
export function targetBase(location: PagesLocation, target: Target): string {
  const dir = targetDir(target)
  return dir === '' ? location.root : `${location.root}${dir}/`
}

/** The public URL of a target, or its path when the host is unknown. */
export function targetUrl(location: PagesLocation, target: Target): string {
  const dir = targetDir(target)
  const prefix = location.url ?? location.root
  return dir === '' ? prefix : `${prefix}${dir}/`
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== ''
}
