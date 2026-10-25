// Drives the shared mock server as its admin, through the page's own mock host
// (`window.wrxMock`), standing in for the admin backend until WP 2.2. Each Playwright test has
// a fresh browser context, so a fresh mock seeded with the demo (D17, DOC-10).
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

export type AdminOp =
  | { readonly op: 'end-sessions'; readonly jid: string }
  | { readonly op: 'delete-user'; readonly jid: string }
  | { readonly op: 'delete-node'; readonly node: string }
  /**
   * Creates a whitelist node as a publish does, which announces its deletion. A bare `publish`
   * to a missing node auto-creates it with the server's defaults instead, and deleting such a
   * node tells no subscriber (ejabberd's `notify_delete` default).
   */
  | { readonly op: 'create-node'; readonly node: string; readonly members: readonly string[] }
  | { readonly op: 'publish'; readonly node: string; readonly payload: string }

export const DOMAIN = 'wrx.mock'

export async function asMockAdmin(page: Page, ops: readonly AdminOp[]): Promise<void> {
  await page.waitForFunction(() => window.wrxMock !== undefined)
  const failed = await page.evaluate(
    async ({ ops, domain }) => {
      const host = window.wrxMock
      if (host === undefined) return 'no mock host'
      const login = await host.connect({
        endpoint: { websocketUrl: '', domain },
        credentials: { kind: 'password', username: 'admin', password: 'demo-admin' },
        resource: 'e2e-admin',
      })
      if (!login.ok) return `admin login: ${login.error.condition}`
      const admin = login.value
      for (const op of ops) {
        if (op.op === 'create-node') {
          const created = await admin.pubsub.createNode(op.node, {
            accessModel: 'whitelist',
            publishModel: 'publishers',
            maxItems: 1,
            notifyRetract: true,
          })
          if (!created.ok) return `create-node: ${created.error.condition}`
          const members = op.members.map((id) => ({
            jid: `${id}@${domain}`,
            affiliation: 'member' as const,
          }))
          const granted = await admin.pubsub.setAffiliations(op.node, members)
          if (!granted.ok) return `create-node: ${granted.error.condition}`
          continue
        }
        const result =
          op.op === 'end-sessions'
            ? await admin.admin.endUserSessions(op.jid)
            : op.op === 'delete-user'
              ? await admin.admin.deleteUser(op.jid)
              : op.op === 'publish'
                ? await admin.pubsub.publish(op.node, 'current', op.payload)
                : await admin.pubsub.deleteNode(op.node)
        if (!result.ok) return `${op.op}: ${result.error.condition}`
      }
      await admin.disconnect()
      return undefined
    },
    { ops, domain: DOMAIN },
  )
  expect(failed).toBeUndefined()
}

/** Logs in on the welcome page with a role id and password. */
export async function logIn(page: Page, roleId: string, password: string): Promise<void> {
  await page.getByLabel('Role id').fill(roleId)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

/** The tabs in the workspace's docked area, in DOM order (WP 2.5). */
export function roomTabs(page: Page): Locator {
  return page.locator('.flexlayout__layout_main').getByRole('tab')
}
