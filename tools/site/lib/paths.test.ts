import { describe, expect, it } from 'vitest'
import {
  normaliseBase,
  pagesLocation,
  parseTarget,
  targetBase,
  targetDir,
  targetUrl,
} from './paths.ts'

describe('parseTarget', () => {
  it('reads every target', () => {
    expect(parseTarget('root')).toEqual({ kind: 'root' })
    expect(parseTarget('demo')).toEqual({ kind: 'demo' })
    expect(parseTarget('pr/42')).toEqual({ kind: 'pr', number: 42 })
    expect(parseTarget('snapshots/schemas-post')).toEqual({
      kind: 'snapshot',
      slug: 'schemas-post',
    })
  })
  it('rejects anything that could escape its folder', () => {
    for (const bad of ['pr/0', 'pr/../x', 'pr/1/x', 'snapshots/../demo', 'snapshots/A', 'x']) {
      expect(() => parseTarget(bad), bad).toThrow()
    }
  })
  it('maps targets to folders', () => {
    expect(targetDir(parseTarget('root'))).toBe('')
    expect(targetDir(parseTarget('pr/3'))).toBe('pr/3')
  })
})

describe('normaliseBase', () => {
  it('adds slashes and refuses unsafe paths', () => {
    expect(normaliseBase('wrx/pr/1')).toBe('/wrx/pr/1/')
    expect(normaliseBase('/')).toBe('/')
    expect(() => normaliseBase('/a/../b/')).toThrow()
    expect(() => normaliseBase('/a b/')).toThrow()
    expect(() => normaliseBase('/"onload=x/')).toThrow()
  })
})

describe('pagesLocation', () => {
  it('serves a project repo under its name', () => {
    const location = pagesLocation({ repository: 'serge-web/war-rooms-x2' })
    expect(location).toEqual({
      root: '/war-rooms-x2/',
      url: 'https://serge-web.github.io/war-rooms-x2/',
    })
    expect(targetBase(location, { kind: 'pr', number: 7 })).toBe('/war-rooms-x2/pr/7/')
    expect(targetUrl(location, { kind: 'demo' })).toBe(
      'https://serge-web.github.io/war-rooms-x2/demo/',
    )
  })
  it('serves the owner.github.io repo at the root', () => {
    expect(pagesLocation({ repository: 'Serge-Web/serge-web.github.io' })).toEqual({
      root: '/',
      url: 'https://serge-web.github.io/',
    })
  })
  it('takes overrides for a custom domain', () => {
    const location = pagesLocation({
      repository: 'serge-web/war-rooms-x2',
      root: '/',
      url: 'https://wrx.example.org',
    })
    expect(targetUrl(location, { kind: 'pr', number: 2 })).toBe('https://wrx.example.org/pr/2/')
  })
  it('builds for / with no repository, as a local build does', () => {
    const location = pagesLocation({})
    expect(location).toEqual({ root: '/', url: undefined })
    expect(targetUrl(location, { kind: 'pr', number: 2 })).toBe('/pr/2/')
  })
})
