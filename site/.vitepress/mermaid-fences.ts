import type { MarkdownRenderer } from 'vitepress'

/**
 * Turns ```mermaid fences into the <Mermaid> component, which renders them in the browser with
 * the bundled mermaid package (DOC-4, DOC-15). The source is URI-encoded so no character in it
 * can escape the attribute or reach Vue's template compiler.
 */
export function mermaidFences(md: MarkdownRenderer): void {
  const fallback = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (token?.info.trim() === 'mermaid') {
      return `<Mermaid code="${encodeURIComponent(token.content)}" />\n`
    }
    return fallback === undefined
      ? self.renderToken(tokens, idx, options)
      : fallback(tokens, idx, options, env, self)
  }
}
