// Deployment isolation (DOC-10): previews, the demo and snapshots share one origin on GitHub
// Pages (`/war-rooms-x2/pr/<n>/app/`, `/war-rooms-x2/demo/`, `/war-rooms-x2/snapshots/<slug>/`),
// so every browser-wide name the mock uses is prefixed with the deployment's base path. Two
// deployments then never open the same database, worker, channel, lock or storage key.

/** Prefix shared by every name; bump the suffix only if the naming scheme itself changes. */
export const NAMESPACE_PREFIX = 'wrx1-mock'

/**
 * The deployment's base path from a document URL: the folder of the page, with a leading and
 * trailing slash, without query or hash, `.`, `..` or repeated slashes. `index.html` and any
 * other file name are dropped, so `/demo/` and `/demo/index.html` are the same deployment.
 */
export function basePathOf(url: string | URL): string {
  let parsed: URL
  try {
    parsed = new URL('.', url)
  } catch {
    return '/'
  }
  return normaliseBasePath(parsed.pathname)
}

/** Normalises a base path given as an option, e.g. `demo`, `/demo` or `/demo//`. */
export function normaliseBasePath(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.length === 0 ? '/' : `/${parts.join('/')}/`
}

/** The namespace for a base path: `wrx1-mock:/war-rooms-x2/demo/`. */
export function mockNamespace(basePath: string): string {
  return `${NAMESPACE_PREFIX}:${normaliseBasePath(basePath)}`
}

/** Every browser-wide name the host uses, all under one namespace. */
export interface HostNames {
  readonly namespace: string
  /** The IndexedDB database holding the mock state. */
  readonly database: string
  /** The SharedWorker's name; it also tells the worker its namespace. */
  readonly worker: string
  /** The BroadcastChannel between tabs when there is no SharedWorker. */
  readonly channel: string
  /** The Web Lock held by whichever context hosts the server. */
  readonly leaderLock: string
  /** The Web Lock a tab holds while it is open, so the host notices when it closes. */
  tabLock(tabId: string): string
  /** A localStorage key. */
  storageKey(key: string): string
}

export function hostNames(namespace: string): HostNames {
  return Object.freeze({
    namespace,
    database: `${namespace}:db`,
    worker: `${namespace}:worker`,
    channel: `${namespace}:bus`,
    leaderLock: `${namespace}:leader`,
    tabLock: (tabId: string) => `${namespace}:tab:${tabId}`,
    storageKey: (key: string) => `${namespace}:${key}`,
  })
}

/** The namespace a worker name was made from, or undefined if it is not one of ours. */
export function namespaceOfWorkerName(name: string): string | undefined {
  if (!name.startsWith(`${NAMESPACE_PREFIX}:`) || !name.endsWith(':worker')) return undefined
  return name.slice(0, -':worker'.length)
}
