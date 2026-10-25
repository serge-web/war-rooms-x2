// @wrx/admin-ui (WP 2.2): the admin backend's design editor. `apps/web` mounts `AdminApp` at
// `/admin` behind the admin login (ADM-1, ADM-2); WP 2.3 publishes from the same draft store.
export { ADMIN_SECTIONS, AdminApp, AdminAppCore } from './AdminApp.tsx'
export type { AdminAppCoreProps, AdminAppProps, AdminSection } from './AdminApp.tsx'
export { AccessMatrix, AccessMatrixCore, AccessSectionCore } from './sections/AccessSection.tsx'
export type { AccessMatrixCoreProps, AccessSectionCoreProps } from './sections/AccessSection.tsx'
export type { SectionProps } from './sections/common.tsx'
export type { ThemesSlot, ThemesSlotProps } from './sections/ThemesSection.tsx'
export { useDraft, useDraftValidation } from './useDraft.ts'
export * from './draft/index.ts'
