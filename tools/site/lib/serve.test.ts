import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvePath } from './serve.ts'

describe('resolvePath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'serve-'))
  mkdirSync(join(dir, 'app'))
  writeFileSync(join(dir, 'index.html'), '')
  writeFileSync(join(dir, 'prs.html'), '')
  writeFileSync(join(dir, 'app', 'index.html'), '')

  it('maps paths under the base as GitHub Pages does', () => {
    expect(resolvePath(dir, '/x/pr/1/', '/x/pr/1/')).toBe(join(dir, 'index.html'))
    expect(resolvePath(dir, '/x/pr/1/', '/x/pr/1/prs')).toBe(join(dir, 'prs.html'))
    expect(resolvePath(dir, '/x/pr/1/', '/x/pr/1/prs.html?q=1')).toBe(join(dir, 'prs.html'))
    expect(resolvePath(dir, '/x/pr/1/', '/x/pr/1/app/')).toBe(join(dir, 'app', 'index.html'))
  })
  it('serves nothing outside the base or the folder', () => {
    expect(resolvePath(dir, '/x/', '/y/index.html')).toBeUndefined()
    expect(resolvePath(dir, '/x/', '/x/../index.html')).toBeUndefined()
    expect(resolvePath(dir, '/x/', '/x/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined()
    expect(resolvePath(dir, '/x/', '/x/%E0%A4%A')).toBeUndefined()
  })
})
