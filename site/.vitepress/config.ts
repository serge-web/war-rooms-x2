import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfigWithTheme } from 'vitepress'
import type { DefaultTheme } from 'vitepress'
import { mermaidFences } from './mermaid-fences.ts'
import type { SiteTheme } from './theme/site-theme.ts'

// Set by tools/site/build-site.ts for each deploy target (DOC-6, DOC-11).
const base = process.env.WRX_SITE_BASE ?? '/'
const pagesRoot = process.env.WRX_PAGES_ROOT ?? base

const blogDir = fileURLToPath(new URL('../pages/blog/', import.meta.url))

/** Blog sidebar from the posts' front matter, so a blog-only PR touches only the blog folder (DOC-23). */
function blogSidebar(): DefaultTheme.SidebarItem[] {
  return readdirSync(blogDir)
    .filter((file) => file.endsWith('.md') && file !== 'index.md')
    .map((file) => {
      const text = readFileSync(`${blogDir}${file}`, 'utf8')
      const title = /^title:\s*["']?(.*?)["']?\s*$/m.exec(text)?.[1] ?? file
      const date = /^date:\s*["']?(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1] ?? ''
      return { date, item: { text: title, link: `/blog/${file.replace(/\.md$/, '')}` } }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((post) => post.item)
}

export default defineConfigWithTheme<SiteTheme>({
  title: 'War Rooms X1',
  description: 'A browser-based tool for chat-based wargames, built on XMPP.',
  lang: 'en-GB',
  base,
  srcDir: 'pages',
  outDir: 'dist',
  // Out of the source tree, so lint and format never see it.
  cacheDir: 'node_modules/.vitepress',
  markdown: {
    config: (md) => {
      mermaidFences(md)
    },
  },
  // Mermaid's diagram chunks are large but load only on pages with a diagram.
  vite: { build: { chunkSizeWarningLimit: 2000 } },
  themeConfig: {
    pagesRoot,
    nav: [
      { text: 'Background', link: '/background' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Technical details', link: '/technical' },
      { text: 'Data dictionary', link: '/data-dictionary' },
      { text: 'Blog', link: '/blog/' },
      { text: 'PR index', link: '/prs' },
    ],
    sidebar: {
      '/blog/': [{ text: 'Blog', link: '/blog/', items: blogSidebar() }],
      '/': [
        {
          text: 'About WRX1',
          items: [
            { text: 'Background', link: '/background' },
            { text: 'Architecture', link: '/architecture' },
            { text: 'Technical details', link: '/technical' },
            { text: 'Data dictionary', link: '/data-dictionary' },
          ],
        },
        {
          text: 'Progress',
          items: [
            { text: 'Blog', link: '/blog/' },
            { text: 'PR index', link: '/prs' },
          ],
        },
      ],
    },
    // Built into the site; no external search service (NFR-7).
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: { message: 'War Rooms X1. Released under the Apache 2.0 licence.' },
  },
})
