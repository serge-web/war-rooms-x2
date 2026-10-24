import { execFileSync } from 'node:child_process'

export interface MermaidBlock {
  readonly file: string
  /** 1-based line of the opening fence. */
  readonly line: number
  readonly source: string
}

/** Extracts every ```mermaid fenced block from Markdown text. */
export function mermaidBlocks(file: string, text: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  const lines = text.split('\n')
  let start = -1
  let body: string[] = []
  lines.forEach((line, i) => {
    if (start < 0 && /^```mermaid\s*$/.test(line)) {
      start = i
      body = []
    } else if (start >= 0 && /^```\s*$/.test(line)) {
      blocks.push({ file, line: start + 1, source: body.join('\n') })
      start = -1
    } else if (start >= 0) {
      body.push(line)
    }
  })
  return blocks
}

/** Markdown files tracked by git, plus new ones not yet ignored. */
export function markdownFiles(root: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.md', '**/*.md'],
    { cwd: root, encoding: 'utf8' },
  )
  return [...new Set(out.split('\n').filter((f) => f !== ''))].sort()
}
