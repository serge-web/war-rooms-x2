import { createContentLoader } from 'vitepress'

export interface PostSummary {
  readonly url: string
  readonly title: string
  readonly date: string
  readonly status: string
  readonly phase: string
}

declare const data: PostSummary[]
export { data }

/** Every post in this folder, newest first, for the blog index. */
export default createContentLoader('blog/*.md', {
  transform(pages): PostSummary[] {
    return pages
      .filter((page) => !page.url.endsWith('/blog/'))
      .map((page) => {
        const fm = page.frontmatter as Record<string, unknown>
        // YAML reads an unquoted date as a Date.
        const date = fm.date instanceof Date ? fm.date.toISOString().slice(0, 10) : text(fm.date)
        return {
          url: page.url,
          title: text(fm.title),
          date,
          status: text(fm.status),
          phase: text(fm.phase),
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title))
  },
})

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}
