// Fails if any Mermaid block in the repo's Markdown doesn't parse (DOC-22). The README plan
// chart is one of them. Parses in Chromium, with the same mermaid build the site will use.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { markdownFiles, mermaidBlocks } from './lib/markdown.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const mermaidPath = require.resolve('mermaid/dist/mermaid.min.js')

const blocks = markdownFiles(root).flatMap((file) =>
  mermaidBlocks(file, readFileSync(`${root}/${file}`, 'utf8')),
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: mermaidPath })
  const failures: string[] = []
  for (const block of blocks) {
    const error = await page.evaluate(async (source) => {
      const mermaid = (window as unknown as { mermaid: { parse(s: string): Promise<unknown> } })
        .mermaid
      try {
        await mermaid.parse(source)
        return null
      } catch (e) {
        return e instanceof Error ? e.message : String(e)
      }
    }, block.source)
    if (error !== null) failures.push(`${block.file}:${block.line}\n${error}`)
  }
  console.log(
    `Checked ${blocks.length} Mermaid blocks in ${new Set(blocks.map((b) => b.file)).size} files.`,
  )
  if (failures.length > 0) {
    console.error(`\n${failures.length} failed to parse:\n\n${failures.join('\n\n')}`)
    process.exitCode = 1
  }
} finally {
  await browser.close()
}
