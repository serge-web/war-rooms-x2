// @wrx/admin-ops (WP 2.1): every admin change to the server goes through here (ADM-35).
// Internal: its rules and the vault are not for the public site (DOC-2).
export * from './errors.ts'
export * from './target.ts'
export { AdminOps } from './ops.ts'
export type {
  AdminOpsOptions,
  Ensured,
  NodeAccessChange,
  NodeSnapshot,
  RoleAccessPlan,
  RoleLogin,
  RoleScope,
  RoomAccessChange,
  RoomSnapshot,
  RoomSpec,
  ServerSnapshot,
} from './ops.ts'
export { MIN_PASSPHRASE_CHARS, ObserverVault, VAULT_KDF, VAULT_STORAGE_KEY } from './vault.ts'
export type { VaultOptions } from './vault.ts'
// WP 2.3: publish planning and execution over these primitives.
export * from './publish/index.ts'
