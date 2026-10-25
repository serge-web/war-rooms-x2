// @vitest-environment jsdom
// jsdom, not happy-dom: DOMPurify needs a DOM it supports, and happy-dom drops elements.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownView, renderMarkdown } from './markdown.tsx'

afterEach(cleanup)

describe('MarkdownView', () => {
  it('renders Markdown', () => {
    expect(renderMarkdown('## Briefing\n\nThe **exercise** starts.')).toBe(
      '<h2>Briefing</h2>\n<p>The <strong>exercise</strong> starts.</p>\n',
    )
  })

  it('shows raw HTML as text, never as markup', () => {
    const html = renderMarkdown(
      'Hi <script>alert(1)</script> <b onclick="x()">bold</b>\n\n<div>x</div>',
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b')
    expect(html).not.toContain('<div')
    expect(html).toContain('&lt;script&gt;')
  })

  it('drops script URLs and images', () => {
    const html = renderMarkdown('[click](javascript:alert(1)) ![map](https://example.com/m.png)')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('example.com')
  })

  it('is a focusable, labelled, fixed-height region when it scrolls (PLY-47)', () => {
    render(<MarkdownView markdown="Text" label="Briefing" maxHeight="12rem" />)
    const region = screen.getByRole('region', { name: 'Briefing' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.style.height).toBe('12rem')
  })
})
