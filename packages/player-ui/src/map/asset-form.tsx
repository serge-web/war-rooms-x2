// The admin's asset form (ADM-44; WP 5.6): every fixed field of an asset (§3 rule 17), checked by
// `worldAssetSchema` (the symbol code by `sidcSchema`) with each error at its field, and a live
// preview of the symbol. Inline in the map room's side panel rather than a modal, so it works in a
// popped-out map too (PLY-4). Used to add an asset and to edit one.
import { WORLD_ASSET_FIELDS } from '@wrx/domain'
import type { WorldAssetField } from '@wrx/domain'
import { LIMITS, sidcSchema, worldAssetSchema } from '@wrx/schemas'
import type { Force, WorldAsset } from '@wrx/schemas'
import { Button, ChunkBoundary, Spinner, TextField } from '@wrx/ui'
import { Suspense, useEffect, useId, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { LazySymbolPreview } from './lazy.tsx'

/** The form's values: text as typed, so a half-typed number is not lost. */
type Values = Record<WorldAssetField, string>

const LABELS: Readonly<Record<WorldAssetField, string>> = Object.freeze({
  title: 'Title',
  forceId: 'Force',
  category: 'Category',
  sidc: 'Symbol code (SIDC)',
  lat: 'Latitude',
  lon: 'Longitude',
  state: 'State',
  health: 'Health (%)',
  fuel: 'Fuel (%)',
})

const HINTS: Partial<Readonly<Record<WorldAssetField, string>>> = Object.freeze({
  category: 'What kind of asset, e.g. armour or frigate.',
  sidc: 'MIL-STD-2525 or APP-6: 15 letter-based characters, e.g. SFGPUCA---*****, or 20 or 30 digits.',
  lat: 'Decimal degrees, −90 to 90; north is positive.',
  lon: 'Decimal degrees, −180 to 180; east is positive.',
  state: 'Its condition in words, e.g. operational or damaged.',
  health: '0 (destroyed) to 100 (full).',
  fuel: '0 (empty) to 100 (full).',
})

const isNumberField = (field: WorldAssetField): boolean =>
  field === 'lat' || field === 'lon' || field === 'health' || field === 'fuel'

function valuesOf(asset: WorldAsset): Values {
  return {
    title: asset.title,
    forceId: asset.forceId,
    category: asset.category,
    sidc: asset.sidc,
    lat: String(asset.lat),
    lon: String(asset.lon),
    state: asset.state,
    health: String(asset.health),
    fuel: String(asset.fuel),
  }
}

/** The values as an asset, or the message for each field that is not valid. */
export function readAssetForm(
  id: string,
  values: Values,
):
  | { ok: true; asset: WorldAsset }
  | { ok: false; errors: Partial<Record<WorldAssetField, string>> } {
  const number = (text: string) => (text.trim() === '' ? Number.NaN : Number(text))
  const candidate = {
    id,
    title: values.title.trim(),
    forceId: values.forceId,
    category: values.category.trim(),
    sidc: values.sidc.trim().toUpperCase(),
    lat: number(values.lat),
    lon: number(values.lon),
    state: values.state.trim(),
    health: number(values.health),
    fuel: number(values.fuel),
  }
  const parsed = worldAssetSchema.safeParse(candidate)
  if (parsed.success) return { ok: true, asset: parsed.data }
  const errors: Partial<Record<WorldAssetField, string>> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || !(WORLD_ASSET_FIELDS as readonly string[]).includes(field)) {
      continue
    }
    const key = field as WorldAssetField
    if (errors[key] !== undefined) continue
    errors[key] = fieldMessage(key, candidate[key])
  }
  return { ok: false, errors }
}

function fieldMessage(field: WorldAssetField, value: string | number): string {
  if (isNumberField(field) && (typeof value !== 'number' || Number.isNaN(value))) {
    return 'Enter a number.'
  }
  switch (field) {
    case 'lat':
      return 'Enter a latitude from −90 to 90.'
    case 'lon':
      return 'Enter a longitude from −180 to 180.'
    case 'health':
    case 'fuel':
      return 'Enter a value from 0 to 100.'
    case 'sidc':
      return 'Enter a MIL-STD-2525/APP-6 code: 15 letter-based characters, or 20 or 30 digits.'
    case 'forceId':
      return 'Choose a force.'
    case 'title':
      return value === '' ? 'Enter a title.' : `At most ${LIMITS.nameChars} characters.`
    default:
      return value === '' ? 'Enter some text.' : `At most ${LIMITS.worldLabelChars} characters.`
  }
}

export interface AssetFormProps {
  /** The asset being edited, or the new asset's starting values. */
  readonly asset: WorldAsset
  /** Adding a new asset, or editing one. */
  readonly mode: 'add' | 'edit'
  readonly forces: readonly Force[]
  /** Applies the asset; returns why it was refused, if it was. */
  readonly onSave: (asset: WorldAsset) => string | undefined
  readonly onCancel: () => void
}

export function AssetForm({ asset, mode, forces, onSave, onCancel }: AssetFormProps) {
  const [values, setValues] = useState<Values>(() => valuesOf(asset))
  const [errors, setErrors] = useState<Partial<Record<WorldAssetField, string>>>({})
  const [refused, setRefused] = useState<string | undefined>(undefined)
  const headingId = useId()
  const forceId = useId()
  // The form takes focus when it opens, as the confirmations do, so a keyboard user who chose
  // "Add asset…" or "Edit…" is in it, not left on the button (NFR-14; WP 5.7 review).
  // When it closes and focus would be lost with it, focus goes back to the button that opened it
  // if it is still there ("Add asset…"), else to the first action of the panel that replaces the
  // form (the asset's "Edit…").
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    const panel = heading.current?.closest('.wrx-map')
    heading.current?.focus()
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body
      if (!lost) return
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
        opener.focus()
        return
      }
      panel?.querySelector<HTMLElement>('.wrx-map__details button')?.focus()
    }
  }, [])
  const set = (field: WorldAssetField) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field] !== undefined) setErrors((e) => ({ ...e, [field]: undefined }))
  }
  const sidc = sidcSchema.safeParse(values.sidc.trim().toUpperCase())
  const submit = (event: SyntheticEvent) => {
    event.preventDefault()
    const read = readAssetForm(asset.id, values)
    if (!read.ok) {
      setErrors(read.errors)
      setRefused(undefined)
      return
    }
    const problem = onSave(read.asset)
    setRefused(problem)
  }
  const text = (field: WorldAssetField, extra: Record<string, string | number> = {}) => (
    <TextField
      label={LABELS[field]}
      value={values[field]}
      onChange={(event) => {
        set(field)(event.target.value)
      }}
      error={errors[field]}
      {...(HINTS[field] === undefined ? {} : { hint: HINTS[field] })}
      {...(isNumberField(field) ? { inputMode: 'decimal' } : {})}
      {...extra}
    />
  )
  const forceError = errors.forceId
  const known = forces.some((f) => f.id === values.forceId)
  return (
    <form className="wrx-asset-form" aria-labelledby={headingId} onSubmit={submit} noValidate>
      <h3 id={headingId} ref={heading} tabIndex={-1} className="wrx-map__details-title">
        {mode === 'add' ? 'Add an asset' : `Edit ${asset.title}`}
      </h3>
      {text('title', { maxLength: LIMITS.nameChars })}
      <div className="wrx-field">
        <label className="wrx-field__label" htmlFor={forceId}>
          {LABELS.forceId}
        </label>
        <select
          id={forceId}
          className="wrx-field__input"
          value={values.forceId}
          aria-invalid={forceError === undefined ? undefined : true}
          aria-describedby={forceError === undefined ? undefined : `${forceId}-error`}
          onChange={(event) => {
            set('forceId')(event.target.value)
          }}
        >
          {known ? null : <option value={values.forceId}>Unknown force</option>}
          {forces.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        {forceError === undefined ? null : (
          <p id={`${forceId}-error`} className="wrx-field__error" role="alert">
            {forceError}
          </p>
        )}
      </div>
      {text('category', { maxLength: LIMITS.worldLabelChars })}
      {text('sidc', { spellCheck: 'false', autoCapitalize: 'characters' })}
      <div className="wrx-asset-form__preview" aria-live="polite">
        <ChunkBoundary what="the symbol preview" onRetry={LazySymbolPreview.reset}>
          <Suspense fallback={<Spinner label="Loading the symbol" />}>
            <LazySymbolPreview
              sidc={sidc.success ? sidc.data : undefined}
              label={`Symbol preview for ${sidc.success ? sidc.data : 'the code'}`}
            />
          </Suspense>
        </ChunkBoundary>
      </div>
      <div className="wrx-asset-form__pair">
        {text('lat')}
        {text('lon')}
      </div>
      {text('state', { maxLength: LIMITS.worldLabelChars })}
      <div className="wrx-asset-form__pair">
        {text('health')}
        {text('fuel')}
      </div>
      {refused === undefined ? null : (
        <p className="wrx-field__error" role="alert">
          Not saved: {refused}
        </p>
      )}
      <div className="wrx-map__details-actions">
        <Button type="submit" size="small" variant="primary">
          {mode === 'add' ? 'Add to the draft' : 'Save to the draft'}
        </Button>
        <Button size="small" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
