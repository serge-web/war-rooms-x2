// axe-core in the page (WP 3.2, NFR-14): WCAG 2.2 A and AA rules, colour contrast included, so
// the default theme is checked as it renders. A screen passes with no violation; findings that
// stay are listed in plan/reviews/phase-3-accessibility.md with the reason, and excluded here by
// rule and selector only, never wholesale.
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const

export interface ScanOptions {
  /** Only this part of the page, e.g. a dialog. */
  readonly include?: string
}

/** Runs axe on the page as it is now and fails on any violation, listing each. */
export async function expectNoViolations(
  page: Page,
  testInfo: TestInfo,
  screen: string,
  options: ScanOptions = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_TAGS])
  if (options.include !== undefined) builder = builder.include(options.include)
  const results = await builder.analyze()
  const found = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`),
  }))
  await testInfo.attach(`axe: ${screen}`, {
    body: JSON.stringify({ screen, violations: found, passes: results.passes.length }, null, 2),
    contentType: 'application/json',
  })
  expect(found, `axe violations on ${screen}`).toEqual([])
}
