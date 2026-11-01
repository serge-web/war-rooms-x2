// Template operations on the draft (WP 4.3): add, change, copy, delete, the room config's free
// text and entries, and the stored draft keeping a template that is being fixed.
import { checkDesign, designFileSchema, withTemplateLocks } from '@wrx/schemas'
import { describe, expect, it } from 'vitest'
import { FORCE, ROLE, ROOM, TEMPLATE, templatedDesign } from '../../../schemas/src/fixtures.ts'
import { exportDesign, importDesign } from '../publish/transfer.ts'
import {
  addTemplate,
  chatConfigOf,
  copyTemplate,
  deleteForce,
  deleteRole,
  deleteRoom,
  deleteTemplate,
  draftFromDesign,
  isTemplateLocked,
  roomsUsingTemplate,
  setFreeText,
  setTemplateEntry,
  updateTemplate,
} from './draft.ts'
import { parseStoredDraft, serialiseDraft } from './storage.ts'

const NOW = new Date('2026-11-01T10:00:00.000Z')
const NEW_ID = '00000000-0000-4000-8000-0000000000aa'

function templated() {
  return draftFromDesign(templatedDesign())
}

function locked() {
  return draftFromDesign(withTemplateLocks(templatedDesign(), []))
}

describe('templates in the draft', () => {
  it('adds a template with no fields yet', () => {
    const added = addTemplate(templated(), 'Logistics', NOW, () => NEW_ID)
    const template = added.draft.design.templates.at(-1)
    expect(added.id).toBe(NEW_ID)
    expect(template).toMatchObject({
      id: NEW_ID,
      name: 'Logistics',
      schema: { type: 'object', properties: {} },
      createdAt: NOW.toISOString(),
    })
    // No fields is a profile error until one is added.
    expect(checkDesign(added.draft.design)).toEqual([])
    expect(designFileSchema.safeParse(added.draft.design).success).toBe(false)
  })

  it('changes a template; a locked one keeps its schema', () => {
    const schema = { type: 'object', properties: { a: { type: 'boolean' } } }
    const free = updateTemplate(templated(), TEMPLATE.contact, { name: 'Contact', schema })
    expect(free.design.templates[1]).toMatchObject({ name: 'Contact', schema })
    const draft = locked()
    expect(isTemplateLocked(draft.design.templates[0]!)).toBe(true)
    const next = updateTemplate(draft, TEMPLATE.sitrep, {
      name: 'Sitrep',
      description: '',
      schema,
      uiSchema: null,
    })
    const sitrep = next.design.templates[0]!
    expect(sitrep.name).toBe('Sitrep')
    expect(sitrep.description).toBeUndefined()
    expect(sitrep.uiSchema).toBeUndefined()
    expect(sitrep.schema).toEqual(draft.design.templates[0]!.schema)
  })

  it('copies a locked template to a new, unlocked one', () => {
    const draft = locked()
    const copied = copyTemplate(draft, TEMPLATE.sitrep, NOW, () => NEW_ID)
    const copy = copied.draft.design.templates.at(-1)!
    expect(copy).toMatchObject({ id: NEW_ID, name: 'Copy of Situation report' })
    expect(copy.lockedAt).toBeUndefined()
    expect(copy.schema).toEqual(draft.design.templates[0]!.schema)
    const again = copyTemplate(copied.draft, TEMPLATE.sitrep, NOW, () => `${NEW_ID.slice(0, -1)}b`)
    expect(again.draft.design.templates.at(-1)!.name).toBe('Copy of Situation report (2)')
    expect(copyTemplate(draft, NEW_ID)).toEqual({ draft, id: '' })
  })

  it('refuses to delete a template a room offers', () => {
    const draft = templated()
    expect(roomsUsingTemplate(draft.design, TEMPLATE.sitrep).map((r) => r.id)).toEqual([
      ROOM.blueReports,
    ])
    const refused = deleteTemplate(draft, TEMPLATE.sitrep)
    expect(refused).toEqual({
      ok: false,
      error: 'Situation report is offered in Blue Reports; take it out of that room first',
    })
    const taken = setTemplateEntry(draft, ROOM.blueReports, 'force', FORCE.blue, [TEMPLATE.contact])
    const deleted = deleteTemplate(taken, TEMPLATE.sitrep)
    if (!deleted.ok) throw new Error(deleted.error)
    expect(deleted.value.design.templates.map((t) => t.id)).toEqual([
      TEMPLATE.contact,
      TEMPLATE.support,
    ])
    expect(checkDesign(deleted.value.design).filter((i) => i.severity === 'error')).toEqual([])
    // A room that goes takes its offers with it.
    const gone = deleteTemplate(deleteRoom(draft, ROOM.blueReports), TEMPLATE.sitrep)
    expect(gone.ok).toBe(true)
  })

  it('sets free text and entries in a chat room, version 2', () => {
    const draft = templated()
    const blueHq = draft.design.rooms.find((r) => r.id === ROOM.blueHq)!
    expect(chatConfigOf(blueHq)).toEqual({ schemaVersion: 2, freeText: true, templates: [] })
    let next = setFreeText(draft, ROOM.blueHq, false)
    next = setTemplateEntry(next, ROOM.blueHq, 'force', FORCE.blue, [TEMPLATE.sitrep])
    next = setTemplateEntry(next, ROOM.blueHq, 'role', ROLE.blueCo, [
      TEMPLATE.support,
      TEMPLATE.support,
    ])
    const config = next.design.rooms.find((r) => r.id === ROOM.blueHq)!.config
    expect(config).toEqual({
      schemaVersion: 2,
      freeText: false,
      templates: [
        { kind: 'force', id: FORCE.blue, templateIds: [TEMPLATE.sitrep] },
        { kind: 'role', id: ROLE.blueCo, templateIds: [TEMPLATE.support] },
      ],
    })
    // No templates removes the entry.
    next = setTemplateEntry(next, ROOM.blueHq, 'force', FORCE.blue, [])
    expect(chatConfigOf(next.design.rooms.find((r) => r.id === ROOM.blueHq)!)?.templates).toEqual([
      { kind: 'role', id: ROLE.blueCo, templateIds: [TEMPLATE.support] },
    ])
    expect(checkDesign(next.design).filter((i) => i.severity === 'error')).toEqual([])
    // An unknown room is ignored.
    expect(setFreeText(draft, NEW_ID, false)).toBe(draft)
  })

  it('drops a deleted force’s and role’s template entries', () => {
    let draft = templated()
    for (const role of draft.design.roles.filter((r) => r.forceId === FORCE.blue)) {
      draft = deleteRole(draft, role.id, NOW)
    }
    const deleted = deleteForce(draft, FORCE.blue, NOW)
    if (!deleted.ok) throw new Error(deleted.error)
    const reports = deleted.value.design.rooms.find((r) => r.id === ROOM.blueReports)!
    expect(chatConfigOf(reports)?.templates).toEqual([])
  })

  it('keeps a template outside the profile in the stored draft', () => {
    const draft = updateTemplate(templated(), TEMPLATE.contact, {
      schema: { type: 'object', properties: { a: { type: 'string' } } },
    })
    const stored = parseStoredDraft(serialiseDraft(draft))
    if (!stored.ok) throw new Error(stored.error)
    expect(stored.value.design.templates[1]!.schema).toEqual({
      type: 'object',
      properties: { a: { type: 'string' } },
    })
  })

  it('exports and imports templates with their locks', () => {
    const draft = locked()
    const file = exportDesign(draft, NOW)
    const imported = importDesign(file.text, templated())
    if (!imported.ok) throw new Error(JSON.stringify(imported.error))
    expect(imported.value.draft.design.templates).toEqual(draft.design.templates)
    expect(imported.value.draft.design.templates[0]!.lockedAt).toBeDefined()
  })
})
