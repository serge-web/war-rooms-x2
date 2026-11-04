// The receiver's check of a templated message (TPL-6, T-R1; Phase 4 provisional answer 3).
import { isId, templateFields } from '@wrx/schemas'
import type {
  ChatRoomConfig,
  Force,
  Retired,
  Role,
  Template,
  TemplateMessageBody,
} from '@wrx/schemas'
import { templatesFor } from './permissions.ts'
import { createTemplateValidator } from './validate.ts'
import type { TemplateError, TemplateValidator } from './validate.ts'

/** Who sent the message, from the stanza alone (§3 rule 3): the store's `Sender` fits. */
export interface TemplateSender {
  /** The sender's login name on this game's domain; `undefined` for the admin or an outsider. */
  readonly loginName: string | undefined
  readonly isAdmin: boolean
}

/** The documents the check resolves the sender and picker values against. */
export interface TemplateEntities {
  readonly forces: readonly Force[]
  readonly roles: readonly Role[]
  /** Deleted forces and roles: their GUIDs stay valid picker values (TPL-9). */
  readonly retired: readonly Retired[]
}

export type TemplateCheck =
  /** Show the card (TD7). */
  | { readonly status: 'valid'; readonly template: Template }
  /**
   * Show the message as plain text with a warning (TPL-6): the template is unknown, the values
   * do not fit its schema, or a picker names no known or deleted force or role.
   */
  | {
      readonly status: 'invalid'
      readonly reason: 'unknown-template' | 'schema' | 'picker'
      readonly template: Template | undefined
      readonly errors: readonly TemplateError[]
      /** One line for the warning. */
      readonly message: string
    }
  /**
   * Show the card with a warning (provisional answer 3): the values fit, but the room's config
   * does not let the sender use this template, now. The config may have changed since it was
   * sent, so this is not treated as invalid.
   */
  | {
      readonly status: 'not-permitted'
      readonly template: Template
      readonly message: string
    }

export interface CheckOptions {
  /** A validator to reuse (its per-schema cache); a new one otherwise. */
  readonly validator?: TemplateValidator
}

/**
 * Checks a received `template` message (already a valid body, `templateMessageBodySchema`)
 * against its template and the room's config, in this order: the template is known; the values
 * fit its schema; force and role picker values are GUIDs of known or deleted forces and roles
 * (TPL-8, TPL-9); the sender may use the template in this room (`templatesFor`). The composer
 * runs the same validator before sending, so a message from an unmodified client is `valid`
 * unless the room's config changed.
 *
 * A picker's scope (`x-wrx-scope: room`) and force filter are the composer's restrictions and
 * are not checked here: room participants and forces change after a message is sent, and a
 * check against today's would turn old, valid messages into plain text.
 */
export function checkTemplatedMessage(
  message: TemplateMessageBody,
  template: Template | undefined,
  roomConfig: ChatRoomConfig,
  sender: TemplateSender,
  entities: TemplateEntities,
  options: CheckOptions = {},
): TemplateCheck {
  if (template?.id !== message.content.templateId) {
    return {
      status: 'invalid',
      reason: 'unknown-template',
      template: undefined,
      errors: [],
      message: 'This message names a template this game does not have.',
    }
  }
  const validator = options.validator ?? createTemplateValidator()
  const values = message.content.values
  const result = validator.validate(template.schema, values)
  if (!result.valid) {
    return {
      status: 'invalid',
      reason: 'schema',
      template,
      errors: result.errors,
      message: `This message does not fit the template ${template.name}.`,
    }
  }

  const pickerErrors: TemplateError[] = []
  for (const field of templateFields(template.schema)) {
    if (field.picker === undefined || !Object.prototype.hasOwnProperty.call(values, field.name)) {
      continue
    }
    const value = values[field.name]
    const ok =
      typeof value === 'string' &&
      isId(value) &&
      ((field.picker === 'force'
        ? entities.forces.some((f) => f.id === value)
        : entities.roles.some((r) => r.id === value)) ||
        entities.retired.some((r) => r.id === value && r.kind === field.picker))
    if (!ok) {
      pickerErrors.push({
        field: field.name,
        keyword: 'x-wrx-picker',
        message: `is not a ${field.picker} of this game`,
        schemaPath: `#/properties/${field.name}/x-wrx-picker`,
      })
    }
  }
  if (pickerErrors.length > 0) {
    return {
      status: 'invalid',
      reason: 'picker',
      template,
      errors: pickerErrors,
      message: 'This message names a force or role this game does not have.',
    }
  }

  const role =
    sender.isAdmin || sender.loginName === undefined
      ? undefined
      : entities.roles.find((r) => r.loginName === sender.loginName)
  const allowed = templatesFor(roomConfig, { isAdmin: sender.isAdmin, role }, entities.forces)
  if (!allowed.includes(template.id)) {
    const deleted =
      role === undefined &&
      !sender.isAdmin &&
      entities.retired.some((r) => r.kind === 'role' && r.loginName === sender.loginName)
    return {
      status: 'not-permitted',
      template,
      message: deleted
        ? `The sender's role has been deleted, so this room no longer offers it ${template.name}.`
        : `This room does not offer ${template.name} to the sender now.`,
    }
  }
  return { status: 'valid', template }
}

/**
 * A templated message as one line of plain text (TPL-6: how an invalid message is shown, and
 * what a client without cards shows): the template's name, then each value with its field's
 * title, in the schema's order, then any value the template does not declare. `nameOf` turns
 * a picker's GUID into a name (TPL-8); a GUID it does not know is shown as it is. Plain text
 * only (PLY-14): the caller renders it as text, never HTML.
 */
export function templatePlainText(
  message: TemplateMessageBody,
  template?: Template,
  nameOf?: (kind: 'force' | 'role', id: string) => string | undefined,
): string {
  const values = message.content.values
  const fields = template === undefined ? [] : templateFields(template.schema)
  const properties: unknown = template?.schema.properties
  const titleOf = (name: string): string => {
    const declared: unknown =
      typeof properties === 'object' && properties !== null && Object.hasOwn(properties, name)
        ? (properties as Record<string, unknown>)[name]
        : undefined
    const title: unknown =
      typeof declared === 'object' && declared !== null && 'title' in declared
        ? declared.title
        : undefined
    return typeof title === 'string' && title !== '' ? title : name
  }
  const parts: string[] = []
  const shown = new Set<string>()
  const show = (name: string, picker: 'force' | 'role' | undefined) => {
    if (!Object.hasOwn(values, name)) return
    shown.add(name)
    const value = values[name]
    const text =
      typeof value === 'boolean'
        ? value
          ? 'yes'
          : 'no'
        : picker !== undefined && typeof value === 'string'
          ? (nameOf?.(picker, value) ?? value)
          : String(value)
    parts.push(`${titleOf(name)}: ${text}`)
  }
  for (const field of fields) show(field.name, field.picker)
  for (const name of Object.keys(values)) if (!shown.has(name)) show(name, undefined)
  const head = template?.name ?? 'A templated message'
  return parts.length === 0 ? head : `${head}. ${parts.join('; ')}`
}
