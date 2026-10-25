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
// WP 2.3: publish, reset, import / export and the credentials sheet.
export { PublishController, describeError } from './publish/controller.ts'
export type {
  PublishConnection,
  PublishControllerOptions,
  PublishSnapshot,
  StepProgress,
  VaultState,
} from './publish/controller.ts'
export { CredentialsSheet, PublishSection, PublishSectionCore } from './publish/PublishSection.tsx'
export type {
  CredentialsSheetProps,
  PublishSectionCoreProps,
  PublishSectionProps,
} from './publish/PublishSection.tsx'
export { ApplyDialog, VaultDialog } from './publish/dialogs.tsx'
export type { Acknowledgement, ApplyDialogProps, VaultDialogProps } from './publish/dialogs.tsx'
export { usePublish } from './publish/usePublish.ts'
export { IMPORT_LIMIT_BYTES, exportDesign, importDesign } from './publish/transfer.ts'
