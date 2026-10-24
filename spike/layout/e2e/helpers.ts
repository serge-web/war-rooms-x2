import type { Locator, Page } from '@playwright/test'
import type { Library, TabsetInfo, WorkspaceHarness } from '../src/shared/harness.ts'

export const libraries: Library[] = ['flexlayout', 'dockview']
export const WORKSPACES = ['ws0', 'ws1', 'ws2', 'ws3'] as const

type Async<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => Promise<R>
    : never
}

/** Calls into a workspace's window.wrx harness from the test. */
export function harness(page: Page, wsId: string): Async<WorkspaceHarness> {
  return new Proxy({} as Async<WorkspaceHarness>, {
    get:
      (_, method: string) =>
      (...args: unknown[]) =>
        page.evaluate(
          ({ wsId, method, args }) => {
            const h = window.wrx.workspaces[wsId] as unknown as Record<
              string,
              (...a: unknown[]) => unknown
            >
            const fn = h[method]
            if (fn === undefined) throw new Error(`no harness method ${method}`)
            return fn(...args)
          },
          { wsId, method, args },
        ),
  })
}

export interface Opened {
  /** console errors and uncaught exceptions seen so far */
  errors: string[]
}

export async function open(
  page: Page,
  library: Library,
  { rooms = 4, ws = 4, flags = '' }: { rooms?: number; ws?: number; flags?: string } = {},
): Promise<Opened> {
  const opened: Opened = { errors: [] }
  page.on('console', (m) => {
    if (m.type() === 'error') opened.errors.push(m.text())
  })
  page.on('pageerror', (e) => opened.errors.push(e.message))
  await page.goto(`${library}.html?rooms=${rooms}&ws=${ws}${flags}`)
  await page.waitForFunction((n) => Object.keys(window.wrx?.workspaces ?? {}).length === n, ws)
  return opened
}

export const tabsOf = (s: TabsetInfo[]) => s.map((t) => t.tabs)
export const selectedOf = (s: TabsetInfo[]) => s.map((t) => t.selected)

export const workspace = (page: Page, wsId: string) => page.locator(`[data-ws="${wsId}"]`)

/** A tab button by its accessible name, matched exactly so Room 1 never matches Room 10. */
export const tab = (scope: Locator | Page, name: string) =>
  scope.getByRole('tab', { name, exact: true })

export const panel = (scope: Locator | Page, roomId: string) =>
  scope.locator(`[data-room="${roomId}"]`)

/** A user-like mouse drag: press, move in steps so dragenter and dragover fire, release. */
export async function drag(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (from === null || to === null) throw new Error('drag: element not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.mouse.up()
}

/** Ids that appear more than once in the document. */
export function duplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id)
    return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  })
}
