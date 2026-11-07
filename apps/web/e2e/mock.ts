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
  /** Joins a room as the admin and posts each text as a chat message, in order. */
  | { readonly op: 'post'; readonly room: string; readonly texts: readonly string[] }

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
        if (op.op === 'post') {
          const jid = `${op.room}@${admin.services.muc}`
          const joined = await admin.muc.join(jid, 'admin')
          if (!joined.ok) return `join ${op.room}: ${joined.error.condition}`
          for (const text of op.texts) {
            const body = JSON.stringify({ type: 'chat', schemaVersion: 1, content: { text } })
            const sent = await admin.muc.send(jid, body)
            if (!sent.ok) return `post: ${sent.error.condition}`
          }
          await admin.muc.leave(jid)
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
  await mockSaved(page)
}

/**
 * Waits until the mock host has written all it holds to IndexedDB. The host saves after each
 * change, but asynchronously, and the SharedWorker holding the newer state ends with the last tab:
 * a reload before the write lands starts a new worker from the older stored state. On a loaded
 * CI runner that lost the tail of the 130 messages PLY-49 posts (the newest after the reload was
 * item 069). Compares the stored document with a fresh export until they match.
 */
export async function mockSaved(page: Page): Promise<void> {
  const failed = await page.evaluate(async () => {
    const host = window.wrxMock
    if (host === undefined) return 'no mock host'
    const name = host.names.database
    const stored = () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onerror = () => {
          reject(open.error ?? new Error(`cannot open ${name}`))
        }
        open.onsuccess = () => {
          const db = open.result
          try {
            const get = db.transaction('state', 'readonly').objectStore('state').get('current')
            get.onsuccess = () => {
              db.close()
              resolve(get.result)
            }
            get.onerror = () => {
              db.close()
              reject(get.error ?? new Error('cannot read the stored state'))
            }
          } catch (error) {
            db.close()
            reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })
    const deadline = performance.now() + 15_000
    for (;;) {
      const current = await host.exportDatabase()
      if (!current.ok) return `export: ${current.error}`
      if ((await stored()) === current.value) return undefined
      if (performance.now() > deadline) return 'the mock host did not save within 15 s'
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })
  expect(failed).toBeUndefined()
}

/** Logs in on the welcome page with a role id and password. */
export async function logIn(page: Page, roleId: string, password: string): Promise<void> {
  await page.getByLabel('Login name').fill(roleId)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

/**
 * The room tabs in the workspace's docked area, in DOM order (WP 2.5): every tab but the
 * out-of-game column's, which a narrow client adds (FT-1).
 */
export function roomTabs(scope: Page | Locator): Locator {
  return scope.locator('.flexlayout__layout_main [role="tab"]:not(.wrx-tab-special)')
}

/** FT-1: the out-of-game column's tab, present while the client is narrow. */
export function columnTab(scope: Page | Locator): Locator {
  return scope.getByRole('tab', { name: 'Out of game', exact: true })
}
