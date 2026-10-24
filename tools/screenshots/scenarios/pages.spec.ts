// Site page screenshots (DOC-19, DOC-20). Every page is shot; the comparison with main shows
// only those a PR adds or changes. The PR index is left out: its content changes with every PR.
import { expect, test } from '@playwright/test'
import { freezeClock, shoot } from '../lib/shoot.ts'

const PAGES: readonly { readonly name: string; readonly path: string; readonly heading: string }[] =
  Object.freeze([
    { name: 'page-home', path: './', heading: 'Try it' },
    { name: 'page-background', path: './background', heading: 'Background' },
    { name: 'page-architecture', path: './architecture', heading: 'Architecture' },
    { name: 'page-technical', path: './technical', heading: 'Technical details' },
    { name: 'page-data-dictionary', path: './data-dictionary', heading: 'Data dictionary' },
    { name: 'page-blog', path: './blog/', heading: 'Blog' },
  ])

for (const { name, path, heading } of PAGES) {
  test(name, { tag: '@screenshot' }, async ({ page }) => {
    await freezeClock(page)
    await page.goto(path)
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible()
    const diagrams = page.locator('.wrx-mermaid')
    for (const diagram of await diagrams.all())
      await expect(diagram).toHaveAttribute('data-rendered')
    if (path === './') {
      await expect(page.frameLocator('.wrx-demo iframe').getByLabel('Backend: MOCK')).toBeVisible()
    }
    await shoot(page, name)
  })
}
