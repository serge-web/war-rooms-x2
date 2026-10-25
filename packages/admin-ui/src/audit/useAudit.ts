// React binding for the AuditController: one per connection and publish controller, kept across
// renders and sections, so a report survives moving away and back. It borrows the publish
// controller's vault and credentials book, which `usePublish` disposes.
import { useState, useSyncExternalStore } from 'react'
import type { DraftStore } from '../draft/index.ts'
import type { PublishConnection, PublishController } from '../publish/controller.ts'
import { AuditController, IDLE_AUDIT } from './controller.ts'
import type { AuditSnapshot } from './controller.ts'

const noSubscription = () => () => undefined
const idle = () => IDLE_AUDIT

export function useAudit(
  connection: PublishConnection | undefined,
  publish: PublishController | undefined,
  store: DraftStore,
): { readonly snapshot: AuditSnapshot; readonly controller: AuditController | undefined } {
  const [state, setState] = useState<{
    readonly connection: PublishConnection | undefined
    readonly publish: PublishController | undefined
    readonly controller: AuditController | undefined
  }>(() => ({ connection, publish, controller: create(connection, publish, store) }))
  let current = state
  if (state.connection !== connection || state.publish !== publish) {
    current = { connection, publish, controller: create(connection, publish, store) }
    setState(current)
  }
  const controller = current.controller
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    controller?.getSnapshot ?? idle,
    controller?.getSnapshot ?? idle,
  )
  return { snapshot, controller }
}

function create(
  connection: PublishConnection | undefined,
  publish: PublishController | undefined,
  store: DraftStore,
): AuditController | undefined {
  if (connection === undefined || publish === undefined) return undefined
  return new AuditController({
    ops: connection.ops,
    getDesign: () => store.getSnapshot().draft.design,
    vault: {
      current: () => publish.currentVault(),
      unlock: (passphrase) => publish.unlockVault(passphrase),
    },
    issuePassword: (roleId) => publish.book.issue(roleId),
  })
}
