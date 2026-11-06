import { describe, expect, it } from 'vitest'
import { touchesPython } from './python-changes.ts'

describe('touchesPython (PR previews and py/, owner Nov 6, 2026)', () => {
  it.each([
    'packages/py-runner/src/worker.ts',
    'packages/py-runner/src/packaging.ts',
    'packages/py-runner/pyodide.lock.json',
    'python/wrx/game.py',
    'python/pyproject.toml',
    'packages/schemas/src/bridge.ts',
    'tools/python/generate_models.py',
  ])('includes py/ for %s', (path) => {
    expect(touchesPython([path])).toBe(true)
  })

  it('leaves py/ out of a preview that touches none of them', () => {
    expect(
      touchesPython([
        'apps/web/src/App.tsx',
        'packages/player-ui/src/scripts/scripts-panel.tsx',
        'packages/schemas/src/world.ts',
        'site/pages/umpires.md',
        'WRX1-SRD.md',
      ]),
    ).toBe(false)
  })
})
