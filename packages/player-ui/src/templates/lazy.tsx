// The template form, loaded on first use: RJSF and its utilities are fetched only once a room
// offers this role a template, so rooms without templates load nothing more.
import { lazyChunk } from '@wrx/ui'

export const LazyTemplateForm = lazyChunk(() => import('./form.tsx'))
