// Checks every blog post's front matter (DOC-24, DOC-26), that gate posts link their phase's
// work-in-progress posts (DOC-26), and that no post matches the deny-list (DOC-2, DOC-25).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Post } from './lib/blog.ts'
import { BLOG_DIR, checkPosts, parsePost } from './lib/blog.ts'
import { isAllowed, parseDenyList, scanText } from './lib/scan.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const files = readdirSync(`${root}${BLOG_DIR}`)
  .filter((f) => f.endsWith('.md') && f !== 'index.md')
  .map((f) => `${BLOG_DIR}${f}`)
const deny = parseDenyList(
  JSON.parse(readFileSync(new URL('deny-list.json', import.meta.url), 'utf8')),
)

const problems: string[] = []
const posts: Post[] = []
for (const file of files) {
  const text = readFileSync(`${root}${file}`, 'utf8')
  const parsed = parsePost(file, text)
  problems.push(...parsed.problems)
  if (parsed.post !== undefined) posts.push(parsed.post)
  for (const hit of scanText(file, text, deny.rules).filter((h) => !isAllowed(h, deny.allow))) {
    problems.push(
      `${file}:${hit.line}: matches deny-list term ${hit.rule}; needs human review (DOC-25)`,
    )
  }
}
problems.push(...checkPosts(posts))

if (problems.length > 0) {
  console.error(problems.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Blog: ${posts.length} posts checked.`)
}
