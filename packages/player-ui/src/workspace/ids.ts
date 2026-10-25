// Tab ids. A tab's *logical* id names what it shows (`room:<roomId>` or `panel:<panelId>`) and
// is what saved layouts hold. Its *model* id is the logical id behind a per-instance prefix.
// FlexLayout derives DOM ids from node ids and moves focus with getElementById, so two
// workspaces showing the same room (two panes, possibly of the same role: D15, D22) would share
// ids and send focus to the wrong pane (layout-library.md, weakness 1). The prefix is stripped on
// save and added on load, so a saved layout is portable between instances.

/** What a tab shows. */
export type TabRef =
  | { readonly kind: 'room'; readonly roomId: string }
  | { readonly kind: 'panel'; readonly panelId: string }

export type TabKind = TabRef['kind']

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function roomTabId(roomId: string): string {
  return `room:${roomId}`
}

export function panelTabId(panelId: string): string {
  return `panel:${panelId}`
}

/** A logical id's meaning, or undefined if it is not one of ours (e.g. from bad storage). */
export function parseTabId(logicalId: string): TabRef | undefined {
  const colon = logicalId.indexOf(':')
  if (colon < 0) return undefined
  const kind = logicalId.slice(0, colon)
  const id = logicalId.slice(colon + 1)
  if (!SLUG.test(id)) return undefined
  if (kind === 'room') return { kind, roomId: id }
  if (kind === 'panel') return { kind, panelId: id }
  return undefined
}

/** Maps between logical and model ids for one workspace instance. */
export interface TabIds {
  readonly prefix: string
  toModel(logicalId: string): string
  /** The logical id, or undefined for a node that is not this instance's tab. */
  toLogical(modelId: string): string | undefined
}

/** The ids of one workspace instance. `instance` should be unique on the page, e.g. `useId()`. */
export function tabIds(instance: string): TabIds {
  const prefix = `wrx-${instance.replace(/[^A-Za-z0-9_-]/g, '')}/`
  return Object.freeze({
    prefix,
    toModel: (logicalId: string) => prefix + logicalId,
    toLogical: (modelId: string) =>
      modelId.startsWith(prefix) ? modelId.slice(prefix.length) : undefined,
  })
}
