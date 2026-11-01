import { describe, expect, it } from 'vitest'
import type { ChatRoomConfig, Role } from '@wrx/schemas'
import {
  FORCE,
  ROLE,
  TEMPLATE,
  blueReportsConfig,
  sampleDesignWithWhiteCell,
} from '@wrx/schemas/fixtures'
import { mayUseFreeText, mayUseTemplate, templatesFor } from './permissions.ts'

const design = sampleDesignWithWhiteCell()
const forces = design.forces
const role = (id: string): Role => {
  const found = design.roles.find((r) => r.id === id)
  if (found === undefined) throw new Error(id)
  return found
}
const as = (id: string) => ({ isAdmin: false, role: role(id) })
const ALL = [TEMPLATE.sitrep, TEMPLATE.contact, TEMPLATE.support]

describe('who may use which template (TD4, provisional answer 4)', () => {
  const config = blueReportsConfig()

  it('gives a role its force’s templates, and its own entry’s besides', () => {
    expect(templatesFor(config, as(ROLE.blueCo), forces)).toEqual(ALL)
  })

  it('gives a force entry alone to a role with no entry of its own', () => {
    const other: Role = {
      ...role(ROLE.blueCo),
      id: '20000000-0000-4000-8000-0000000000aa',
      loginName: 'blue-2',
    }
    expect(templatesFor(config, { isAdmin: false, role: other }, forces)).toEqual([
      TEMPLATE.sitrep,
      TEMPLATE.contact,
    ])
  })

  it('never lets a role entry take away its force’s templates', () => {
    const narrowed: ChatRoomConfig = {
      ...config,
      templates: [
        { kind: 'force', id: FORCE.blue, templateIds: [TEMPLATE.sitrep] },
        { kind: 'role', id: ROLE.blueCo, templateIds: [] },
      ],
    }
    expect(templatesFor(narrowed, as(ROLE.blueCo), forces)).toEqual([TEMPLATE.sitrep])
  })

  it('gives another force’s roles nothing from Blue’s entries', () => {
    expect(templatesFor(config, as(ROLE.redCo), forces)).toEqual([])
  })

  it('gives the admin every template the room names', () => {
    expect(templatesFor(config, { isAdmin: true, role: undefined }, forces)).toEqual(ALL)
  })

  it('gives White Force roles that are not observers every template the room names', () => {
    expect(templatesFor(config, as(ROLE.whiteCell), forces)).toEqual(ALL)
  })

  it('gives observers none, the White Force’s and those with an entry included', () => {
    expect(templatesFor(config, as(ROLE.whiteObserver), forces)).toEqual([])
    const withEntry: ChatRoomConfig = {
      ...config,
      templates: [...config.templates, { kind: 'role', id: ROLE.blueObserver, templateIds: ALL }],
    }
    expect(templatesFor(withEntry, as(ROLE.blueObserver), forces)).toEqual([])
  })

  it('gives an unknown user, or a role of an unknown force, none', () => {
    expect(templatesFor(config, { isAdmin: false, role: undefined }, forces)).toEqual([])
    const lost: Role = { ...role(ROLE.blueCo), forceId: '10000000-0000-4000-8000-0000000000aa' }
    expect(templatesFor(config, { isAdmin: false, role: lost }, forces)).toEqual([])
  })

  it('gives nothing from an entry naming an unknown force or role (§3 rule 4)', () => {
    const ghost: ChatRoomConfig = {
      ...config,
      templates: [{ kind: 'force', id: '10000000-0000-4000-8000-0000000000aa', templateIds: ALL }],
    }
    expect(templatesFor(ghost, as(ROLE.blueCo), forces)).toEqual([])
  })

  it('lists each template once, in the config’s order', () => {
    const twice: ChatRoomConfig = {
      ...config,
      templates: [
        { kind: 'role', id: ROLE.blueCo, templateIds: [TEMPLATE.contact, TEMPLATE.sitrep] },
        { kind: 'force', id: FORCE.blue, templateIds: [TEMPLATE.sitrep] },
      ],
    }
    expect(templatesFor(twice, as(ROLE.blueCo), forces)).toEqual([
      TEMPLATE.sitrep,
      TEMPLATE.contact,
    ])
    expect(templatesFor(twice, { isAdmin: true, role: undefined }, forces)).toEqual([
      TEMPLATE.contact,
      TEMPLATE.sitrep,
    ])
  })

  it('answers for one template, and for free text', () => {
    expect(mayUseTemplate(config, as(ROLE.blueCo), forces, TEMPLATE.support)).toBe(true)
    expect(mayUseTemplate(config, as(ROLE.redCo), forces, TEMPLATE.sitrep)).toBe(false)
    expect(mayUseFreeText(config)).toBe(false)
    expect(mayUseFreeText({ ...config, freeText: true })).toBe(true)
  })
})
