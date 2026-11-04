import { describe, expect, it } from 'vitest'
import { LIMITS, templateMessageBodySchema } from '@wrx/schemas'
import type { Retired, TemplateMessageBody } from '@wrx/schemas'
import {
  FORCE,
  LOGIN,
  ROLE,
  TEMPLATE,
  blueReportsConfig,
  sampleDesignWithWhiteCell,
  sampleTemplates,
} from '@wrx/schemas/fixtures'
import { checkTemplatedMessage } from './check.ts'
import { createTemplateValidator } from './validate.ts'

const design = sampleDesignWithWhiteCell()
const DELETED_FORCE = '10000000-0000-4000-8000-0000000000dd'
const DELETED_ROLE = '20000000-0000-4000-8000-0000000000dd'
const retired: Retired[] = [
  {
    schemaVersion: 1,
    id: DELETED_FORCE,
    kind: 'force',
    name: 'Green',
    colour: '#00aa00',
    deletedAt: '2026-10-24T08:00:00.000Z',
  },
  {
    schemaVersion: 1,
    id: DELETED_ROLE,
    kind: 'role',
    name: 'Old CO',
    loginName: 'old-co',
    deletedAt: '2026-10-24T08:00:00.000Z',
  },
]
const entities = { forces: design.forces, roles: design.roles, retired }
const [sitrep, , support] = sampleTemplates()
const config = blueReportsConfig()
const blueCo = { loginName: LOGIN.blueCo, isAdmin: false }

function sitrepMessage(values: Record<string, unknown>): TemplateMessageBody {
  return templateMessageBodySchema.parse({
    type: 'template',
    schemaVersion: 1,
    content: {
      templateId: TEMPLATE.sitrep,
      values: {
        force: FORCE.blue,
        summary: 'Holding',
        readiness: 50,
        asOf: '2026-10-24',
        ...values,
      },
    },
  })
}

describe('checking a templated message on receipt (TPL-6)', () => {
  it('is valid when the template fits and the sender may use it', () => {
    expect(checkTemplatedMessage(sitrepMessage({}), sitrep, config, blueCo, entities)).toEqual({
      status: 'valid',
      template: sitrep,
    })
  })

  it('is invalid, shown as plain text, for an unknown template', () => {
    const check = checkTemplatedMessage(sitrepMessage({}), undefined, config, blueCo, entities)
    expect(check).toMatchObject({ status: 'invalid', reason: 'unknown-template' })
    // A template whose id is not the message's is unknown too.
    expect(
      checkTemplatedMessage(sitrepMessage({}), support, config, blueCo, entities),
    ).toMatchObject({
      status: 'invalid',
      reason: 'unknown-template',
    })
  })

  it('is invalid for values that do not fit, with each field named', () => {
    const check = checkTemplatedMessage(
      sitrepMessage({ readiness: 500, summary: 'x'.repeat(LIMITS.messageTextChars) }),
      sitrep,
      config,
      blueCo,
      entities,
    )
    expect(check.status).toBe('invalid')
    if (check.status !== 'invalid') return
    expect(check.reason).toBe('schema')
    expect(check.errors.map((e) => e.field).sort()).toEqual(['readiness', 'summary'])
    expect(check.message).toBe('This message does not fit the template Situation report.')
  })

  it('takes a deleted force or role as a picker value (TPL-9), and refuses one never in the game', () => {
    expect(
      checkTemplatedMessage(
        sitrepMessage({ force: DELETED_FORCE }),
        sitrep,
        config,
        blueCo,
        entities,
      ).status,
    ).toBe('valid')
    const ghost = checkTemplatedMessage(
      sitrepMessage({ force: '10000000-0000-4000-8000-0000000000ee' }),
      sitrep,
      config,
      blueCo,
      entities,
    )
    expect(ghost).toMatchObject({ status: 'invalid', reason: 'picker' })
    // A role's GUID is not a force.
    expect(
      checkTemplatedMessage(sitrepMessage({ force: ROLE.blueCo }), sitrep, config, blueCo, entities)
        .status,
    ).toBe('invalid')
    expect(
      checkTemplatedMessage(
        sitrepMessage({ force: DELETED_ROLE }),
        sitrep,
        config,
        blueCo,
        entities,
      ).status,
    ).toBe('invalid')
  })

  it('does not check a picker’s room scope or force filter, which change after sending', () => {
    // Red is not in Blue Reports and the sitrep's force picker is scoped to the room.
    expect(
      checkTemplatedMessage(sitrepMessage({ force: FORCE.red }), sitrep, config, blueCo, entities)
        .status,
    ).toBe('valid')
    const toRed = templateMessageBodySchema.parse({
      type: 'template',
      schemaVersion: 1,
      content: {
        templateId: TEMPLATE.support,
        values: { kind: 'air', detail: 'strike', to: ROLE.redCo },
      },
    })
    expect(checkTemplatedMessage(toRed, support, config, blueCo, entities).status).toBe('valid')
  })

  it('is not permitted, shown as a card with a warning, when the room does not offer the template to the sender', () => {
    const red = { loginName: LOGIN.redCo, isAdmin: false }
    expect(checkTemplatedMessage(sitrepMessage({}), sitrep, config, red, entities)).toEqual({
      status: 'not-permitted',
      template: sitrep,
      message: 'This room does not offer Situation report to the sender now.',
    })
    // An observer, and a sender from another domain (no login name).
    expect(
      checkTemplatedMessage(
        sitrepMessage({}),
        sitrep,
        config,
        { loginName: LOGIN.blueObserver, isAdmin: false },
        entities,
      ).status,
    ).toBe('not-permitted')
    expect(
      checkTemplatedMessage(
        sitrepMessage({}),
        sitrep,
        config,
        { loginName: undefined, isAdmin: false },
        entities,
      ).status,
    ).toBe('not-permitted')
  })

  it('says so when the sender’s role has been deleted', () => {
    const check = checkTemplatedMessage(
      sitrepMessage({}),
      sitrep,
      config,
      { loginName: 'old-co', isAdmin: false },
      entities,
    )
    expect(check).toMatchObject({ status: 'not-permitted' })
    if (check.status === 'not-permitted') expect(check.message).toContain('deleted')
  })

  it('lets the admin and the White Cell use every template in the room', () => {
    expect(
      checkTemplatedMessage(
        sitrepMessage({}),
        sitrep,
        config,
        { loginName: undefined, isAdmin: true },
        entities,
      ).status,
    ).toBe('valid')
    expect(
      checkTemplatedMessage(
        sitrepMessage({}),
        sitrep,
        config,
        { loginName: LOGIN.whiteCell, isAdmin: false },
        entities,
      ).status,
    ).toBe('valid')
  })

  it('checks the schema before permission, so an invalid message is never a card', () => {
    const red = { loginName: LOGIN.redCo, isAdmin: false }
    expect(
      checkTemplatedMessage(sitrepMessage({ readiness: -1 }), sitrep, config, red, entities).status,
    ).toBe('invalid')
  })

  it('agrees with a shared validator', () => {
    const validator = createTemplateValidator()
    for (let i = 0; i < 3; i++) {
      expect(
        checkTemplatedMessage(sitrepMessage({}), sitrep, config, blueCo, entities, { validator })
          .status,
      ).toBe('valid')
    }
  })
})
