// Audit and repair (WP 2.10, ADM-41, ADM-42): compare the live server with the design and fix
// what differs, through the publish planner's steps and AdminOps. Framework-free;
// `@wrx/admin-ui` draws it. Internal: not for the public site (DOC-2).
export * from './types.ts'
export { diffAudit, repairRank, voiceChecks } from './diff.ts'
export type { AuditInput, VoiceCheck, VoicePlan, VoiceProblem, VoiceReading } from './diff.ts'
export { runAudit } from './run.ts'
export type { AuditOptions, AuditPhase, AuditProgress, AuditRun } from './run.ts'
export { isDestructiveItem, repairAndAudit, repairItems } from './repair.ts'
export type {
  RepairAndAudit,
  RepairEvent,
  RepairOptions,
  RepairResult,
  RepairState,
} from './repair.ts'
