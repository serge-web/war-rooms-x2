// Message templates in the player client (Annex A, WP 4.2), also importable alone as
// `@wrx/player-ui/templates`, e.g. for the admin's live preview (WP 4.3):
//
//   TemplateForm      a template's form: RJSF with our theme and the receivers' validator
//   LazyTemplateForm  the same, loaded on first render (wrap it in Suspense)
//   TemplateCard      a templated message as a card (TD7), from `templateCard(body, template, …)`
//   pickerOptions     what a force or role picker offers, from live documents (TPL-8)
//
// Importing this module loads its stylesheet; the form itself loads RJSF.
import './templates.css'

export { cardClock, cardValueText, fieldLabel, orderedFieldNames, templateCard } from './card.ts'
export type { CardClock, CardField, CardValue, TemplateCardView } from './card.ts'
export { TemplateCard } from './card-view.tsx'
export type { TemplateCardProps } from './card-view.tsx'
export { TemplateForm, formUiSchema } from './form.tsx'
export type { TemplateFormProps } from './form.tsx'
export { LazyTemplateForm } from './lazy.tsx'
export { NO_PICKER_SOURCE, entityLabel, entityName, pickerOptions } from './pickers.ts'
export type { EntityName, PickerOption, PickerSource } from './pickers.ts'
export { PICKER_WIDGET, isoToLocalInput, localInputToIso } from './theme.tsx'
export type { TemplateFormContext } from './theme.tsx'
