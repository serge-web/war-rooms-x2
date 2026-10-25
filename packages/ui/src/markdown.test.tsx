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

  it('opens web links in a new tab, with no opener, referrer or follow (security review F8)', () => {
    const html = renderMarkdown('[map](https://example.com/m) and <https://example.org>')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const links = [...doc.querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/m',
      'https://example.org',
    ])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    }
  })

  it('keeps only http, https and mailto links (F8)', () => {
    const html = renderMarkdown(
      '[a](tel:123) [b](xmpp:x@y) [c](sms:1) [d](/inside) [e](#top) [f](mailto:u@example.com) [g](data:text/html,x)',
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const hrefs = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs.filter((h) => h !== null)).toEqual(['mailto:u@example.com'])
  })

  it('strips class and id, so text cannot dress up as the app’s own UI (F8)', () => {
    const html = renderMarkdown('```wrx-admin-notice\nfake\n```')
    expect(html).not.toContain('class=')
    expect(html).not.toContain('wrx-admin-notice')
    expect(html).toContain('fake')
  })

  it('leaves the shared DOMPurify instance alone', async () => {
    const { default: DOMPurify } = await import('dompurify')
    renderMarkdown('[x](https://example.com)')
    expect(DOMPurify.sanitize('<a href="https://e.com" class="k">x</a>')).toBe(
      '<a href="https://e.com" class="k">x</a>',
    )
  })

  it('is a focusable, labelled, fixed-height region when it scrolls (PLY-47)', () => {
    render(<MarkdownView markdown="Text" label="Briefing" maxHeight="12rem" />)
    const region = screen.getByRole('region', { name: 'Briefing' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.style.height).toBe('12rem')
  })
})
