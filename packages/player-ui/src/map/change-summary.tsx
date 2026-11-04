// The world-state change summary (ADM-46; WP 5.6): what a publish changes against the latest
// published state, asset by asset — added, removed, and changed with the fields that changed —
// shown before every publish, on its own or with a phase change (in the turn panel's
// confirmation). Also the message's size against the 500 KB cap (PLY-53) and the note that every
// publish is the whole state as one message (R26).
import { diffSize, formatKilobytes, worldStateSize } from '@wrx/domain'
import type { WorldAssetChange, WorldAssetField, WorldStateDiff } from '@wrx/domain'
import type { Force, WorldAsset, WorldState } from '@wrx/schemas'
import { useId } from 'react'
import { forceNameOf, formatPercent, formatPosition } from './view.ts'

/** Most assets listed per group; a longer list ends with "and N more". */
const LIST_LIMIT = 40

const FIELD_LABELS: Readonly<Record<WorldAssetField, string>> = Object.freeze({
  title: 'title',
  forceId: 'force',
  category: 'category',
  sidc: 'symbol code',
  lat: 'position',
  lon: 'position',
  state: 'state',
  health: 'health',
  fuel: 'fuel',
})

function fieldValue(asset: WorldAsset, field: WorldAssetField, forces: readonly Force[]): string {
  switch (field) {
    case 'forceId':
      return forceNameOf(asset.forceId, forces)
    case 'lat':
    case 'lon':
      return formatPosition(asset)
    case 'health':
    case 'fuel':
      return formatPercent(asset[field])
    default:
      return asset[field]
  }
}

/** "health 100% → 40%; position 52.1000° N, 1.0000° E → …", position once for lat and lon. */
export function describeChange(change: WorldAssetChange, forces: readonly Force[]): string {
  const fields = change.fields.filter((f, i) => !(f === 'lon' && change.fields[i - 1] === 'lat'))
  return fields
    .map((field) => {
      const label = FIELD_LABELS[field]
      return `${label} ${fieldValue(change.before, field, forces)} → ${fieldValue(change.after, field, forces)}`
    })
    .join('; ')
}

/** "3 changes: 1 added, 1 removed, 1 changed". */
export function summaryLine(diff: WorldStateDiff): string {
  const n = diffSize(diff)
  return `${n.toLocaleString('en-GB')} ${n === 1 ? 'asset' : 'assets'}: ${diff.added.length.toLocaleString('en-GB')} added, ${diff.removed.length.toLocaleString('en-GB')} removed, ${diff.changed.length.toLocaleString('en-GB')} changed`
}

function Group({
  title,
  items,
}: {
  readonly title: string
  readonly items: readonly { readonly id: string; readonly text: string }[]
}) {
  const id = useId()
  if (items.length === 0) return null
  const shown = items.slice(0, LIST_LIMIT)
  return (
    <section className="wrx-world-summary__group" aria-labelledby={id}>
      <h3 id={id} className="wrx-world-summary__heading">
        {title} ({items.length.toLocaleString('en-GB')})
      </h3>
      <ul className="wrx-world-summary__list">
        {shown.map((item) => (
          <li key={item.id}>{item.text}</li>
        ))}
        {items.length > shown.length ? (
          <li className="wrx-world-summary__more">
            and {(items.length - shown.length).toLocaleString('en-GB')} more
          </li>
        ) : null}
      </ul>
    </section>
  )
}

export interface WorldStateSummaryProps {
  readonly diff: WorldStateDiff
  /** The state that would be published, for its size. */
  readonly state: WorldState
  readonly forces: readonly Force[]
}

/** The summary of a publish (ADM-46), with the message's size and the R26 note. */
export function WorldStateSummary({ diff, state, forces }: WorldStateSummaryProps) {
  const size = worldStateSize(state)
  const assetLine = (a: WorldAsset) => `${a.title} (${forceNameOf(a.forceId, forces)})`
  return (
    <div className="wrx-world-summary" role="group" aria-label="World-state changes">
      <p className="wrx-world-summary__line">{summaryLine(diff)}.</p>
      <Group title="Added" items={diff.added.map((a) => ({ id: a.id, text: assetLine(a) }))} />
      <Group title="Removed" items={diff.removed.map((a) => ({ id: a.id, text: assetLine(a) }))} />
      <Group
        title="Changed"
        items={diff.changed.map((c) => ({
          id: c.after.id,
          text: `${c.after.title}: ${describeChange(c, forces)}`,
        }))}
      />
      <p className="wrx-world-summary__help">
        Every publish sends the whole world state, all{' '}
        {Object.keys(state.assets).length.toLocaleString('en-GB')} assets, as one message of{' '}
        {formatKilobytes(size.bytes)} (the limit is {formatKilobytes(size.limitBytes)}). Each
        player’s map replaces what it shows with it, and the room’s history keeps every publish.
      </p>
    </div>
  )
}
