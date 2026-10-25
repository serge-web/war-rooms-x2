// React binding for the PublishController: one controller per connection and draft store, kept
// across renders. The admin app holds it, so issued passwords and the open vault survive moving
// between sections; it is disposed (vault locked, passwords forgotten) when the connection or
// store changes or the app unmounts.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DraftStore } from '../draft/index.ts'
import { PublishController } from './controller.ts'
import type { PublishConnection, PublishSnapshot } from './controller.ts'

const DISCONNECTED: PublishSnapshot = Object.freeze({
  busy: undefined,
  plan: undefined,
  checks: [],
  progress: new Map(),
  result: undefined,
  remaining: undefined,
  error: undefined,
  vault: 'unknown',
  credentials: [],
  online: [],
  plannedFrom: undefined,
})

const noSubscription = () => () => undefined
const disconnected = () => DISCONNECTED

export function usePublish(
  connection: PublishConnection | undefined,
  store: DraftStore,
): { readonly snapshot: PublishSnapshot; readonly controller: PublishController | undefined } {
  const [state, setState] = useState<{
    readonly connection: PublishConnection | undefined
    readonly store: DraftStore
    readonly controller: PublishController | undefined
  }>(() => ({ connection, store, controller: create(connection, store) }))
  let current = state
  if (state.connection !== connection || state.store !== store) {
    current = { connection, store, controller: create(connection, store) }
    setState(current)
  }
  const controller = current.controller
  useEffect(
    () => () => {
      controller?.dispose()
    },
    [controller],
  )
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    controller?.getSnapshot ?? disconnected,
    controller?.getSnapshot ?? disconnected,
  )
  return { snapshot, controller }
}

function create(
  connection: PublishConnection | undefined,
  store: DraftStore,
): PublishController | undefined {
  if (connection === undefined) return undefined
  return new PublishController({
    connection,
    getDraft: () => store.getSnapshot().draft,
    commit: store.commit,
  })
}
