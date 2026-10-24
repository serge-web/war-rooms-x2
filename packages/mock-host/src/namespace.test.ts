import { describe, expect, it } from 'vitest'
import {
  basePathOf,
  hostNames,
  mockNamespace,
  namespaceOfWorkerName,
  normaliseBasePath,
} from './namespace.ts'

describe('deployment namespace (DOC-10)', () => {
  it('takes the base path from the page URL', () => {
    const origin = 'https://serge-web.github.io'
    expect(basePathOf(`${origin}/war-rooms-x2/pr/12/app/`)).toBe('/war-rooms-x2/pr/12/app/')
    expect(basePathOf(`${origin}/war-rooms-x2/pr/12/app/index.html`)).toBe(
      '/war-rooms-x2/pr/12/app/',
    )
    expect(basePathOf(`${origin}/war-rooms-x2/demo/?mock=1#/game`)).toBe('/war-rooms-x2/demo/')
    expect(basePathOf(`${origin}/war-rooms-x2/snapshots/first-light/`)).toBe(
      '/war-rooms-x2/snapshots/first-light/',
    )
    expect(basePathOf(`${origin}/`)).toBe('/')
    expect(basePathOf('http://localhost:4173')).toBe('/')
  })

  it('treats an unparseable URL as the root', () => {
    expect(basePathOf('not a url')).toBe('/')
  })

  it('normalises base paths given as options', () => {
    expect(normaliseBasePath('demo')).toBe('/demo/')
    expect(normaliseBasePath('/demo')).toBe('/demo/')
    expect(normaliseBasePath('//demo//pr/./3/')).toBe('/demo/pr/3/')
    expect(normaliseBasePath('/a/b/../c/')).toBe('/a/c/')
    expect(normaliseBasePath('')).toBe('/')
    expect(normaliseBasePath('/../..')).toBe('/')
  })

  it('gives each deployment on the origin its own namespace', () => {
    const paths = [
      '/war-rooms-x2/demo/',
      '/war-rooms-x2/pr/1/app/',
      '/war-rooms-x2/pr/12/app/',
      '/war-rooms-x2/snapshots/first-light/',
    ]
    const namespaces = paths.map(mockNamespace)
    expect(new Set(namespaces).size).toBe(paths.length)
    expect(mockNamespace('/war-rooms-x2/demo')).toBe(mockNamespace('/war-rooms-x2/demo/'))
    // A deployment's namespace is not a prefix of a nested one's database name.
    expect(hostNames(mockNamespace('/a/')).database).not.toBe(
      hostNames(mockNamespace('/a/b/')).database,
    )
  })

  it('prefixes every browser-wide name with the namespace', () => {
    const ns = mockNamespace('/war-rooms-x2/demo/')
    expect(ns).toBe('wrx1-mock:/war-rooms-x2/demo/')
    const names = hostNames(ns)
    const all = [
      names.database,
      names.worker,
      names.channel,
      names.leaderLock,
      names.tabLock('t1'),
      names.storageKey('hosting'),
    ]
    for (const name of all) expect(name.startsWith(`${ns}:`)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })

  it('recovers the namespace from the worker name', () => {
    const ns = mockNamespace('/war-rooms-x2/pr/3/app/')
    expect(namespaceOfWorkerName(hostNames(ns).worker)).toBe(ns)
    expect(namespaceOfWorkerName('something-else')).toBeUndefined()
  })
})
