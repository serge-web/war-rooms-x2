// Markdown for admin-written text: the briefing and objectives (PLY-35, PLY-46). Raw HTML in the
// source is shown as text, never parsed, and the rendered HTML is sanitised with DOMPurify
// before it reaches the DOM (D24). Images are dropped: theme images are assets (§3 rule 12),
// and a remote image would be a runtime fetch from outside the build (NFR-7). Message text is
// never Markdown (PLY-14).
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { useMemo } from 'react'

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const FORBID_TAGS = Object.freeze(['img', 'picture', 'video', 'audio', 'style', 'form', 'input'])

/** Markdown to sanitised HTML. Raw HTML in the source comes out escaped, as text. */
export function renderMarkdown(markdown: string): string {
  const marked = new Marked({
    gfm: true,
    async: false,
    renderer: {
      html: ({ text }) => escapeHtml(text),
      image: ({ text }) => escapeHtml(text),
    },
  })
  const html = marked.parse(markdown, { async: false })
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [...FORBID_TAGS],
    FORBID_ATTR: ['style'],
  })
}

export interface MarkdownViewProps {
  readonly markdown: string
  /** Accessible label for the region, e.g. "Briefing". */
  readonly label?: string
  /**
   * A fixed height (any CSS length) with its own scrollbar, so what follows stays in view
   * (PLY-47). The box is focusable so keyboard users can scroll it.
   */
  readonly maxHeight?: string
  readonly className?: string
}

export function MarkdownView({ markdown, label, maxHeight, className }: MarkdownViewProps) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  const scrolls = maxHeight !== undefined
  return (
    <div
      className={['wrx-markdown', scrolls ? 'wrx-markdown--scroll' : null, className]
        .filter(Boolean)
        .join(' ')}
      role={label === undefined ? undefined : 'region'}
      aria-label={label}
      tabIndex={scrolls ? 0 : undefined}
      style={scrolls ? { height: maxHeight } : undefined}
      // Sanitised by DOMPurify in renderMarkdown, with raw HTML already escaped.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
