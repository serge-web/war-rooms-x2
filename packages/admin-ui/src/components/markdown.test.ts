// @vitest-environment jsdom
// The admin's Markdown preview renders exactly what players see (security review F8): the same
// sanitiser, so raw HTML, remote images and forms never reach the admin page either.
import { renderMarkdown as playerRender } from '@wrx/ui'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown.tsx'

const SAMPLES = [
  '## Brief\n\nThe **exercise** starts. [Map](https://example.com/map)',
  '<img src="https://example.com/x.png"> <form action="https://example.com"><input></form>',
  '<div style="position:fixed" class="wrx-admin-notice">overlay</div>',
  '![map](https://example.com/m.png) [x](javascript:alert(1))',
]

describe('admin Markdown preview', () => {
  it('is the player rendering, for every sample', () => {
    for (const md of SAMPLES) expect(renderMarkdown(md)).toBe(playerRender(md))
  })

  it('shows raw HTML as text and fetches nothing', () => {
    const html = renderMarkdown(SAMPLES[1]!)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
    expect(html).toContain('&lt;img')
  })
})
