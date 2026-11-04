// Who may use which template in a room (TD4, TPL-2; Phase 4 provisional answer 4). Advisory
// only: the server enforces membership and voice, never template rules (D2, T-R1), so the
// composer offers these templates and every receiver checks against the same rule (TPL-6).
import type { ChatRoomConfig, Force, Role } from '@wrx/schemas'

/** Who is using the room: the admin (the umpire), or a role, or nobody known. */
export interface TemplateUser {
  /** The server's `admin` account, playing as the umpire (D8). */
  readonly isAdmin: boolean
  /** The user's role document; `undefined` for the admin, or a role not (or no longer) known. */
  readonly role: Role | undefined
}

/**
 * The templates `user` may use in a room with `config`, in the order the config names them:
 *
 * - the admin, and the White Force's roles (the force with the umpire flag) that are not
 *   observers: every template any entry of the room names;
 * - observers, the White Force's included: none (they never post, D8);
 * - any other role: the templates of its force's entry, plus those of its own role entry (a
 *   role entry adds to its force's, never takes away; provisional answer 4);
 * - an unknown user, or a role whose force is unknown: none, as an entry naming an unknown force
 *   or role grants nothing (§3 rule 4).
 *
 * Ids are as the config holds them; a caller drops those of templates it cannot find.
 */
export function templatesFor(
  config: ChatRoomConfig,
  user: TemplateUser,
  forces: readonly Force[],
): string[] {
  const ids: string[] = []
  const add = (list: readonly string[]) => {
    for (const id of list) if (!ids.includes(id)) ids.push(id)
  }
  if (user.isAdmin) {
    for (const entry of config.templates) add(entry.templateIds)
    return ids
  }
  const role = user.role
  if (role === undefined || role.isObserver) return ids
  const force = forces.find((f) => f.id === role.forceId)
  if (force === undefined) return ids
  if (force.isUmpire) {
    for (const entry of config.templates) add(entry.templateIds)
    return ids
  }
  for (const entry of config.templates) {
    if (entry.kind === 'force' && entry.id === force.id) add(entry.templateIds)
  }
  for (const entry of config.templates) {
    if (entry.kind === 'role' && entry.id === role.id) add(entry.templateIds)
  }
  return ids
}

/** Whether `user` may use the template in a room with `config` (`templatesFor`). */
export function mayUseTemplate(
  config: ChatRoomConfig,
  user: TemplateUser,
  forces: readonly Force[],
  templateId: string,
): boolean {
  return templatesFor(config, user, forces).includes(templateId)
}

/**
 * Whether free text may be posted in the room (TD3): the config decides, for everyone, the
 * admin included. Voice is still the server's. A receiver cannot tell a modified client's free
 * text in a templates-only room from an older message, so this is the composer's rule only.
 */
export function mayUseFreeText(config: ChatRoomConfig): boolean {
  return config.freeText
}
