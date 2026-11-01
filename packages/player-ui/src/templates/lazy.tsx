// The template form, loaded on first use: RJSF and its utilities are fetched only once a room
// offers this role a template, so rooms without templates load nothing more.
import { lazy } from 'react'

export const LazyTemplateForm = lazy(() => import('./form.tsx'))
