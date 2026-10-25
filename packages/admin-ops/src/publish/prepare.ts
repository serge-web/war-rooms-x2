// Planning against a live server: read the view, count the messages of every room the plan
// would destroy (R-F, ADM-40), and plan again with the counts. Also the server checks run
// before and after a publish (NFR-4).
import type { DesignFile } from '@wrx/schemas'
import type { RoomConfig } from '@wrx/transport'
import { opsOk } from '../errors.ts'
import type { OpsOutcome } from '../errors.ts'
import type { AdminOps } from '../ops.ts'
import { planPublish, planReset, roomsToDestroy } from './plan.ts'
import type { PublishPlan } from './plan.ts'
import { readServerView } from './view.ts'
import type { ReadViewOptions, ServerView } from './view.ts'

export interface Prepared {
  readonly view: ServerView
  readonly plan: PublishPlan
}

async function counted(
  ops: AdminOps,
  draft: PublishPlan,
  replan: (counts: ReadonlyMap<string, number>) => PublishPlan,
): OpsOutcome<PublishPlan> {
  const counts = new Map<string, number>()
  for (const roomId of roomsToDestroy(draft)) {
    const count = await ops.roomMessageCount(roomId)
    if (!count.ok) return count
    counts.set(roomId, count.value)
  }
  return opsOk(counts.size === 0 ? draft : replan(counts))
}

/** Reads the server and plans publishing `design` (ADM-10). */
export async function preparePublish(
  ops: AdminOps,
  design: DesignFile,
  options: ReadViewOptions = {},
): OpsOutcome<Prepared> {
  const view = await readServerView(ops, options)
  if (!view.ok) return view
  const plan = await counted(ops, planPublish(design, view.value), (messageCounts) =>
    planPublish(design, view.value, { messageCounts }),
  )
  return plan.ok ? opsOk({ view: view.value, plan: plan.value }) : plan
}

/** Reads the server and plans a reset (ADM-15). */
export async function prepareReset(
  ops: AdminOps,
  options: ReadViewOptions = {},
): OpsOutcome<Prepared> {
  const view = await readServerView(ops, options)
  if (!view.ok) return view
  const plan = await counted(ops, planReset(view.value), (messageCounts) =>
    planReset(view.value, { messageCounts }),
  )
  return plan.ok ? opsOk({ view: view.value, plan: plan.value }) : plan
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped'

export interface ServerCheck {
  readonly id: 'admin' | 'room-defaults' | 'mam'
  readonly label: string
  readonly status: CheckStatus
  readonly detail: string
}

/** The room settings NFR-3 relies on, without the name. */
const ROOM_DEFAULTS = {
  membersOnly: true,
  moderated: true,
  persistent: true,
  public: false,
  whois: 'anyone',
  archive: true,
} as const satisfies Omit<RoomConfig, 'name' | 'description'>

/**
 * NFR-4: checks what can be checked over XMPP. Admin commands answered (the view was read);
 * every existing room has the NFR-3 defaults (before a publish, a difference is a warning, since
 * the publish reconfigures it); MAM answers for a game room. With no rooms yet, the room checks
 * are skipped; run them again after publishing.
 */
export async function checkServer(ops: AdminOps, view: ServerView): Promise<ServerCheck[]> {
  const checks: ServerCheck[] = [
    {
      id: 'admin',
      label: 'Admin commands',
      status: 'pass',
      detail:
        'The admin account lists online users, rooms and nodes (XEP-0133, MUC and PubSub owner).',
    },
  ]
  if (view.rooms.length === 0) {
    checks.push(
      {
        id: 'room-defaults',
        label: 'Room defaults',
        status: 'skipped',
        detail: 'No rooms yet; checked after publishing.',
      },
      { id: 'mam', label: 'Message archive (MAM)', status: 'skipped', detail: 'No rooms yet.' },
    )
    return checks
  }
  const off = view.rooms.flatMap((room) => {
    const wrong = (Object.keys(ROOM_DEFAULTS) as (keyof typeof ROOM_DEFAULTS)[]).filter(
      (key) => room.config[key] !== ROOM_DEFAULTS[key],
    )
    return wrong.length === 0 ? [] : [`${room.roomId} (${wrong.join(', ')})`]
  })
  checks.push({
    id: 'room-defaults',
    label: 'Room defaults',
    status: off.length === 0 ? 'pass' : 'warn',
    detail:
      off.length === 0
        ? `All ${view.rooms.length} rooms are members-only, moderated, non-anonymous, persistent, unlisted and archived.`
        : `Not as NFR-3 requires, and reconfigured by the publish: ${off.join('; ')}.`,
  })
  const probe = view.rooms[0]
  if (probe !== undefined) {
    const count = await ops.roomMessageCount(probe.roomId)
    checks.push({
      id: 'mam',
      label: 'Message archive (MAM)',
      status: count.ok && probe.config.archive ? 'pass' : 'fail',
      detail: count.ok
        ? probe.config.archive
          ? `The archive of ${probe.roomId} answers (${count.value} messages).`
          : `${probe.roomId} answers, but archiving is off in its config.`
        : `Querying the archive of ${probe.roomId} failed: ${count.error.cause?.condition ?? count.error.code}. History needs mod_mam (PLY-49).`,
    })
  }
  return checks
}
