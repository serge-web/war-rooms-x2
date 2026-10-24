import { describe, expect, it } from 'vitest'
import { touchesUi } from './changes.ts'

describe('touchesUi', () => {
  it.each([
    'apps/web/src/App.tsx',
    'site/pages/index.md',
    'packages/schemas/src/theme.ts',
    'tools/screenshots/scenarios/app.spec.ts',
    'pnpm-lock.yaml',
  ])('runs screenshots for %s', (path) => {
    expect(touchesUi([path])).toBe(true)
  })
  it('skips docs-only and tooling-only PRs', () => {
    expect(
      touchesUi([
        'WRX1-SRD.md',
        'plan/briefs/WP-1.1.md',
        'tools/check-mermaid.ts',
        'spike/s13/a.ts',
      ]),
    ).toBe(false)
  })
})
