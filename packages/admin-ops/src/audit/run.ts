// Running the audit (WP 2.10, ADM-41): read everything the comparison needs, then compare.
// Reading changes nothing on the server, though the voice checks briefly show each read-only
// role's presence in its rooms (they log in as the role, as the vault route does, ADM-37).
//
// 1. the planner's server view: rooms, nodes with items, online roles, the vault (WP 2.3);
// 2. registered accounts (XEP-0133 §4.17);
// 3. the message count of every room the repair would destroy (R-F, ADM-40);
// 4. stored roles, one login per role, through `AdminOps.readJoinRoles`.
import type { DesignFile } from '@wrx/schemas'
import { opsErr, opsOk } from '../errors.ts'
import type { AdminOpsErrorCode, OpsOutcome } from '../errors.ts'
import type { AdminOps } from '../ops.ts'
import { planPublish, roomsToDestroy } from '../publish/plan.ts'
import { readServerView } from '../publish/view.ts'
import type { ServerView } from '../publish/view.ts'
import type { ObserverVault } from '../vault.ts'
import { diffAudit, voiceChecks } from './diff.ts'
import type { VoiceCheck, VoiceProblem, VoiceReading } from './diff.ts'
import type { AuditReport } from './types.ts'

export type AuditPhase = 'server' | 'accounts' | 'counts' | 'voice'

export interface AuditProgress {
  readonly phase: AuditPhase
  /** Steps done in this phase, and how many there are (voice: role logins). */
  readonly done: number
  readonly total: number
  /** What is being read, e.g. a role id. */
  readonly target?: string
}

export interface AuditOptions {
  /**
   * The unlocked vault, which must be the one `ops` uses: it says whose passwords are known, so
   * which stored roles can be read. Without it (or locked), read-only roles are reported as not
   * checked.
   */
  readonly vault?: ObserverVault
  readonly onProgress?: (progress: AuditProgress) => void
}

export interface AuditRun {
  readonly report: AuditReport
  /** What was read, for a caller that wants to show more. */
  readonly view: ServerView
}

/** Audits the server against `design`. Fails only if the server cannot be read. */
export async function runAudit(
  ops: AdminOps,
  design: DesignFile,
  options: AuditOptions = {},
): OpsOutcome<AuditRun> {
  const progress = options.onProgress ?? (() => undefined)
  progress({ phase: 'server', done: 0, total: 1 })
  const read = await readServerView(
    ops,
    options.vault === undefined ? {} : { vault: options.vault },
  )
  if (!read.ok) return read
  const view = read.value
  progress({ phase: 'server', done: 1, total: 1 })

  progress({ phase: 'accounts', done: 0, total: 1 })
  const registered = await ops.session.admin.registeredUsers()
  if (!registered.ok) {
    return opsErr('refused', 'listing registered users failed', {
      op: 'runAudit',
      step: 'registered users',
      cause: registered.error,
    })
  }
  progress({ phase: 'accounts', done: 1, total: 1 })

  const toCount = roomsToDestroy(planPublish(design, { ...view, marker: undefined }))
  const messageCounts = new Map<string, number>()
  for (const [i, roomId] of toCount.entries()) {
    progress({ phase: 'counts', done: i, total: toCount.length, target: roomId })
    const count = await ops.roomMessageCount(roomId)
    // An uncounted room is reported but not offered for destruction.
    if (count.ok) messageCounts.set(roomId, count.value)
  }

  const voice = await readVoice(ops, view, voiceChecks(design, view).checks, progress)
  return opsOk({
    report: diffAudit(design, { view, registered: registered.value, voice, messageCounts }),
    view,
  })
}

/** How `readJoinRoles` failing before any join reads in the report. */
const LOGIN_PROBLEM: Partial<Record<AdminOpsErrorCode, VoiceProblem>> = Object.freeze({
  'login-failed': 'login-failed',
  invalid: 'no-login',
  'vault-locked': 'vault-locked',
  'no-password': 'no-password',
})

async function readVoice(
  ops: AdminOps,
  view: ServerView,
  checks: readonly VoiceCheck[],
  progress: (p: AuditProgress) => void,
): Promise<VoiceReading[]> {
  const byRole = new Map<string, VoiceCheck[]>()
  for (const check of checks) byRole.set(check.roleId, [...(byRole.get(check.roleId) ?? []), check])
  const inVault = new Set(view.vault.roles ?? [])
  const readings: VoiceReading[] = []
  const unread = (list: readonly VoiceCheck[], problem: VoiceProblem, detail?: string) => {
    for (const c of list)
      readings.push({ ...c, problem, ...(detail === undefined ? {} : { detail }) })
  }
  let done = 0
  for (const [roleId, list] of byRole) {
    progress({ phase: 'voice', done, total: byRole.size, target: roleId })
    done++
    if (!view.vault.exists) unread(list, 'vault-missing')
    else if (view.vault.roles === undefined) unread(list, 'vault-locked')
    else if (!inVault.has(roleId)) unread(list, 'no-password')
    else {
      const result = await ops.readJoinRoles(
        roleId,
        list.map((c) => c.roomId),
      )
      if (!result.ok) {
        unread(
          list,
          LOGIN_PROBLEM[result.error.code] ?? 'login-failed',
          result.error.cause?.condition ?? result.error.message,
        )
        continue
      }
      for (const c of list) {
        const reading = result.value.find((r) => r.roomId === c.roomId)
        if (reading?.role !== undefined) readings.push({ ...c, role: reading.role })
        else unread([c], 'join-refused', reading?.error.condition)
      }
    }
  }
  if (byRole.size > 0) progress({ phase: 'voice', done, total: byRole.size })
  return readings
}
