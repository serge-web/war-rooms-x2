import { describe, expect, it } from 'vitest'
import { LIMITS } from './common.ts'
import { checkDesign, designFileSchema, templatesInRooms, withTemplateLocks } from './design.ts'
import {
  FORCE,
  ROLE,
  ROOM,
  TEMPLATE,
  blueReportsConfig,
  sampleDesign,
  sampleTemplates,
  templatedDesign,
} from './fixtures.ts'
import { messageBodySchema } from './message.ts'
import { parseDocument } from './parse.ts'
import {
  TEMPLATE_LIMITS,
  checkTemplateProfile,
  chatRoomConfigReader,
  profilePath,
  templateFields,
  templateMessageBodySchema,
  templateSchema,
  unsafePattern,
} from './template.ts'
import type { Template } from './template.ts'

const T = '2026-10-24T12:00:00.000Z'

/** The profile's complaints about a schema whose only field is `field`. */
function fieldIssues(field: unknown, uiSchema?: unknown): string[] {
  return checkTemplateProfile({ type: 'object', properties: { f: field } }, uiSchema).map(
    (i) => `${profilePath(i)}: ${i.message}`,
  )
}

function rootIssues(schema: unknown): string[] {
  return checkTemplateProfile(schema).map((i) => `${profilePath(i)}: ${i.message}`)
}

const TEXT = { type: 'string', maxLength: 20 }

describe('the WRX template profile', () => {
  it('accepts the sample templates, every field type the profile has', () => {
    for (const template of sampleTemplates()) {
      expect(checkTemplateProfile(template.schema, template.uiSchema), template.name).toEqual([])
      expect(templateSchema.safeParse(template).success).toBe(true)
    }
  })

  it('lists the fields, with picker settings', () => {
    const [sitrep, , support] = sampleTemplates()
    expect(templateFields(sitrep!.schema).map((f) => [f.name, f.type, f.picker, f.scope])).toEqual([
      ['force', 'string', 'force', 'room'],
      ['summary', 'string', undefined, undefined],
      ['readiness', 'integer', undefined, undefined],
      ['asOf', 'string', undefined, undefined],
      ['threat', 'string', undefined, undefined],
    ])
    expect(templateFields(support!.schema).find((f) => f.name === 'to')).toMatchObject({
      picker: 'role',
      scope: 'game',
      forceFilter: FORCE.blue,
    })
  })

  it('needs an object of named fields at the root', () => {
    expect(rootIssues('x')).toEqual(['schema: must be a JSON Schema object'])
    expect(rootIssues({ type: 'array', items: TEXT })).toEqual([
      'schema.items: "items" is not in the WRX template profile',
      'schema.type: must be "object"',
      'schema.properties: must be an object of fields',
    ])
    expect(rootIssues({ type: 'object', properties: {} })).toEqual([
      'schema.properties: a template needs at least one field',
    ])
    expect(
      rootIssues({ type: 'object', properties: { a: TEXT }, additionalProperties: true }),
    ).toEqual([
      'schema.additionalProperties: must be false or left out: a message holds declared fields only',
    ])
    expect(
      rootIssues({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: { a: TEXT },
      }),
    ).toEqual([
      'schema.$schema: must be "https://json-schema.org/draft/2020-12/schema" or left out',
    ])
  })

  it.each([
    ['$ref', { $ref: '#/definitions/x', type: 'object', properties: { a: TEXT } }],
    ['$defs', { $defs: {}, type: 'object', properties: { a: TEXT } }],
    [
      'patternProperties',
      { type: 'object', properties: { a: TEXT }, patternProperties: { '.*': TEXT } },
    ],
    [
      'unevaluatedProperties',
      { type: 'object', properties: { a: TEXT }, unevaluatedProperties: false },
    ],
  ])('refuses %s at the root', (keyword, schema) => {
    expect(rootIssues(schema)).toContain(
      `schema.${keyword}: "${keyword}" is not in the WRX template profile`,
    )
  })

  it('refuses nesting: objects, arrays and `$ref` in a field', () => {
    expect(fieldIssues({ type: 'object', properties: { b: TEXT } })).toEqual([
      'schema.properties.f.type: must be "string", "number", "integer" or "boolean"',
    ])
    expect(fieldIssues({ type: 'array', items: TEXT })).toEqual([
      'schema.properties.f.type: must be "string", "number", "integer" or "boolean"',
    ])
    expect(fieldIssues({ $ref: '#' })).toEqual([
      'schema.properties.f.type: must be "string", "number", "integer" or "boolean"',
    ])
    expect(fieldIssues({ type: 'string', maxLength: 5, $ref: '#' })).toEqual([
      'schema.properties.f.$ref: "$ref" is not allowed on a string field',
    ])
    expect(fieldIssues({ type: ['string', 'null'], maxLength: 5 })).toHaveLength(1)
  })

  it('refuses deep nesting without walking it', () => {
    let deep: Record<string, unknown> = TEXT
    for (let i = 0; i < 10_000; i++) deep = { type: 'object', properties: { x: deep } }
    expect(fieldIssues(deep)).toEqual([
      'schema.properties.f.type: must be "string", "number", "integer" or "boolean"',
    ])
  })

  it('needs a maxLength on every text field, within the message limit', () => {
    expect(fieldIssues({ type: 'string' })).toEqual([
      `schema.properties.f.maxLength: a text field needs a maxLength from 1 to ${TEMPLATE_LIMITS.stringMaxLength}`,
    ])
    expect(fieldIssues({ type: 'string', maxLength: 1e9 })).toHaveLength(1)
    expect(fieldIssues({ type: 'string', maxLength: 0 })).toHaveLength(1)
    expect(fieldIssues({ type: 'string', maxLength: 2.5 })).toHaveLength(1)
    expect(fieldIssues({ type: 'string', maxLength: '20' })).toHaveLength(1)
    expect(fieldIssues({ type: 'string', maxLength: 5, minLength: 6 })).toEqual([
      'schema.properties.f.minLength: must not be more than `maxLength`',
    ])
    expect(fieldIssues({ type: 'string', maxLength: 5, default: 'too long' })).toEqual([
      'schema.properties.f.default: must be text within `maxLength`',
    ])
    expect(fieldIssues({ type: 'string', maxLength: 5, format: 'email' })).toEqual([
      'schema.properties.f.format: must be "date" or "date-time"',
    ])
  })

  it('takes drop-downs as `enum` or `oneOf` of `{const, title}`, without a maxLength', () => {
    expect(fieldIssues({ type: 'string', enum: ['a', 'b'] })).toEqual([])
    expect(fieldIssues({ type: 'integer', oneOf: [{ const: 1, title: 'One' }] })).toEqual([])
    expect(fieldIssues({ type: 'string', enum: [] })).toHaveLength(1)
    expect(fieldIssues({ type: 'string', enum: ['a', 'a'] })).toEqual([
      'schema.properties.f.enum.1: "a" is listed twice',
    ])
    expect(fieldIssues({ type: 'string', enum: ['a', 1] })).toHaveLength(1)
    expect(fieldIssues({ type: 'integer', enum: [1.5] })).toHaveLength(1)
    expect(fieldIssues({ type: 'string', oneOf: [{ const: 'a', title: 'A', extra: 1 }] })).toEqual([
      'schema.properties.f.oneOf.0: must be `{const, title}`',
    ])
    expect(fieldIssues({ type: 'string', enum: ['a'], maxLength: 3 })).toEqual([
      'schema.properties.f.maxLength: a drop-down takes no "maxLength"',
    ])
    const many = Array.from({ length: TEMPLATE_LIMITS.options + 1 }, (_, i) => `o${i}`)
    expect(fieldIssues({ type: 'string', enum: many })).toHaveLength(1)
  })

  it('checks numbers: finite bounds, a positive step', () => {
    expect(fieldIssues({ type: 'number', minimum: 0, maximum: 10, multipleOf: 0.5 })).toEqual([])
    expect(fieldIssues({ type: 'number', minimum: 10, maximum: 0 })).toEqual([
      'schema.properties.f.maximum: must not be less than `minimum`',
    ])
    expect(fieldIssues({ type: 'number', multipleOf: 0 })).toHaveLength(1)
    expect(fieldIssues({ type: 'number', multipleOf: -1 })).toHaveLength(1)
    expect(fieldIssues({ type: 'number', minimum: '0' })).toHaveLength(1)
    expect(fieldIssues({ type: 'integer', default: 1.5 })).toHaveLength(1)
    expect(fieldIssues({ type: 'number', maxLength: 3 })).toEqual([
      'schema.properties.f.maxLength: "maxLength" is not allowed on a number field',
    ])
    expect(fieldIssues({ type: 'boolean', default: 'yes' })).toHaveLength(1)
  })

  it('takes force and role pickers, with scope and a role picker’s force filter', () => {
    expect(fieldIssues({ type: 'string', 'x-wrx-picker': 'force' })).toEqual([])
    expect(
      fieldIssues({
        type: 'string',
        'x-wrx-picker': 'role',
        'x-wrx-scope': 'room',
        'x-wrx-force': FORCE.red,
      }),
    ).toEqual([])
    expect(fieldIssues({ type: 'string', 'x-wrx-picker': 'asset' })).toEqual([
      'schema.properties.f.x-wrx-picker: must be "force" or "role"',
    ])
    expect(
      fieldIssues({ type: 'string', 'x-wrx-picker': 'force', 'x-wrx-force': FORCE.red }),
    ).toEqual(['schema.properties.f.x-wrx-force: filters a role picker only'])
    expect(fieldIssues({ type: 'string', 'x-wrx-picker': 'role', 'x-wrx-force': 'blue' })).toEqual([
      'schema.properties.f.x-wrx-force: must be a force GUID',
    ])
    expect(
      fieldIssues({ type: 'string', 'x-wrx-picker': 'role', 'x-wrx-scope': 'world' }),
    ).toHaveLength(1)
    expect(fieldIssues({ type: 'string', 'x-wrx-picker': 'role', enum: ['x'] })).toEqual([
      'schema.properties.f.enum: a role picker takes no "enum": its value is a GUID',
    ])
    expect(fieldIssues({ type: 'string', maxLength: 3, 'x-wrx-scope': 'room' })).toEqual([
      'schema.properties.f.x-wrx-scope: needs `x-wrx-picker`',
    ])
    expect(fieldIssues({ type: 'number', 'x-wrx-picker': 'force' })).toEqual([
      'schema.properties.f.x-wrx-picker: "x-wrx-picker" is not allowed on a number field',
    ])
  })

  it('refuses field names that are not plain identifiers', () => {
    for (const name of [
      '__proto__',
      'constructor',
      'prototype',
      '1st',
      'a-b',
      'a b',
      '',
      'x'.repeat(65),
    ]) {
      const issues = checkTemplateProfile({ type: 'object', properties: { [name]: TEXT } })
      expect(issues.length, name).toBeGreaterThan(0)
    }
    // A JSON key `__proto__` is an own property after JSON.parse, and is refused too.
    const parsed: unknown = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string","maxLength":3}}}',
    )
    expect(checkTemplateProfile(parsed).map(profilePath)).toEqual(['schema.properties.__proto__'])
  })

  it('caps the number of fields and refuses a duplicate in `required`', () => {
    const properties = Object.fromEntries(
      Array.from({ length: TEMPLATE_LIMITS.fields + 1 }, (_, i) => [`f${i}`, TEXT]),
    )
    expect(rootIssues({ type: 'object', properties })).toEqual([
      `schema.properties: has ${TEMPLATE_LIMITS.fields + 1} fields; the limit is ${TEMPLATE_LIMITS.fields}`,
    ])
    expect(
      rootIssues({ type: 'object', properties: { a: TEXT }, required: ['a', 'a', 'b'] }),
    ).toEqual([
      'schema.required.1: "a" is listed twice',
      'schema.required.2: "b" is not a declared field',
    ])
  })

  describe('linked drop-downs', () => {
    const base = {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['air', 'land'] },
        detail: { type: 'string', enum: ['a', 'b', 'c'] },
      },
    }

    it('accepts `dependencies` with `oneOf` branches and `if`/`then` in `allOf`', () => {
      expect(rootIssues(sampleTemplates()[2]!.schema)).toEqual([])
      expect(
        rootIssues({
          ...base,
          allOf: [
            {
              if: { properties: { kind: { const: 'air' } }, required: ['kind'] },
              then: { properties: { detail: { enum: ['a'] } } },
              else: { properties: { detail: { enum: ['b', 'c'] } } },
            },
          ],
        }),
      ).toEqual([])
      expect(rootIssues({ ...base, dependencies: { kind: ['detail'] } })).toEqual([])
    })

    it('refuses branches naming undeclared fields, nesting, or other keywords', () => {
      expect(
        rootIssues({
          ...base,
          dependencies: {
            kind: {
              oneOf: [{ properties: { kind: { const: 'air' }, hidden: { type: 'string' } } }],
            },
          },
        }),
      ).toEqual([
        'schema.dependencies.kind.oneOf.0.properties.hidden: "hidden" is not a declared field: declare every field in the root `properties`',
      ])
      expect(
        rootIssues({
          ...base,
          allOf: [{ if: { properties: { kind: { const: 'air' } } }, then: { allOf: [] } }],
        }),
      ).toEqual(['schema.allOf.0.then.allOf: a branch holds only `properties` and `required`'])
      expect(
        rootIssues({
          ...base,
          allOf: [{ if: { properties: { kind: { pattern: '.*' } } }, then: { properties: {} } }],
        }),
      ).toEqual([
        'schema.allOf.0.if.properties.kind.pattern: "pattern" is not allowed in a condition',
      ])
      expect(rootIssues({ ...base, then: { properties: {} } })).toEqual([
        'schema: `then` and `else` need an `if`',
      ])
      expect(rootIssues({ ...base, dependencies: { other: ['kind'] } })).toEqual([
        'schema.dependencies.other: "other" is not a declared field',
      ])
      expect(
        rootIssues({
          ...base,
          allOf: [{ if: { properties: {} }, then: { properties: {} }, not: {} }],
        }),
      ).toEqual(['schema.allOf.0.not: an `allOf` entry holds only `if`, `then` and `else`'])
    })

    it('caps the number of conditions', () => {
      const allOf = Array.from({ length: TEMPLATE_LIMITS.conditions + 1 }, () => ({
        if: { properties: { kind: { const: 'air' } } },
        then: { properties: { detail: { enum: ['a'] } } },
      }))
      expect(rootIssues({ ...base, allOf })).toEqual([
        `schema.allOf.${TEMPLATE_LIMITS.conditions}: more than ${TEMPLATE_LIMITS.conditions} conditions`,
      ])
    })
  })

  describe('patterns (T-R1)', () => {
    it.each([
      '^[A-Z]{2}[0-9]{4,8}$',
      '^\\d+$',
      '^[a-z]+(?:-[a-z]+)?$',
      '^(north|south)$',
      '^\\p{L}+$',
      'a{3}b{2}c*',
    ])('accepts %s', (pattern) => {
      expect(unsafePattern(pattern)).toBeUndefined()
    })

    it.each([
      ['(a+)+$', 'a group may not repeat'],
      ['(a|a)*$', 'a group may not repeat'],
      ['(?:ab)+', 'a group may not repeat'],
      ['(a)\\1', 'backreferences'],
      ['(?<x>a)\\k<x>', 'backreferences'],
      ['a(?=b)', 'lookahead'],
      ['(?<!a)b', 'lookbehind'],
      ['a*b*c*d*', 'at most 3'],
      ['a{1,5}b{2,}c+d?e*', 'at most 3'],
      ['[', 'not a valid regular expression'],
      ['x'.repeat(201), 'at most 200 characters'],
    ])('refuses %s', (pattern, reason) => {
      expect(unsafePattern(pattern)).toContain(reason)
    })

    it('needs a short maxLength on a field with a pattern', () => {
      expect(fieldIssues({ type: 'string', maxLength: 500, pattern: '^a+$' })).toEqual([
        `schema.properties.f.maxLength: a text field needs a maxLength from 1 to ${TEMPLATE_LIMITS.patternMaxLength} when it has a pattern`,
      ])
      expect(fieldIssues({ type: 'string', maxLength: 20, pattern: '(a+)+' })).toHaveLength(1)
    })

    it('keeps the worst accepted pattern fast on the longest value', () => {
      const pattern = new RegExp('^a*a*a*$'.replace('$', 'b$'), 'u')
      expect(unsafePattern(pattern.source)).toBeUndefined()
      const value = 'a'.repeat(TEMPLATE_LIMITS.patternMaxLength)
      const started = performance.now()
      expect(pattern.test(value)).toBe(false)
      expect(performance.now() - started).toBeLessThan(1_000)
    })
  })

  describe('UI schema', () => {
    it('accepts order, widgets that fit, hints and textarea rows', () => {
      const [sitrep] = sampleTemplates()
      expect(checkTemplateProfile(sitrep!.schema, sitrep!.uiSchema)).toEqual([])
      expect(fieldIssues({ type: 'boolean' }, { f: { 'ui:widget': 'radio' } })).toEqual([])
    })

    it('refuses widgets that do not fit, unknown fields and other options', () => {
      expect(fieldIssues(TEXT, { f: { 'ui:widget': 'range' } })).toEqual([
        'uiSchema.f.ui:widget: "range" is for number fields',
      ])
      expect(fieldIssues(TEXT, { f: { 'ui:widget': 'MyCustomWidget' } })).toHaveLength(1)
      expect(fieldIssues(TEXT, { f: { 'ui:field': 'x' } })).toEqual([
        'uiSchema.f.ui:field: "ui:field" is not in the WRX template profile',
      ])
      expect(fieldIssues(TEXT, { f: { 'ui:options': { classNames: 'x' } } })).toEqual([
        'uiSchema.f.ui:options.classNames: only `rows` is allowed',
      ])
      expect(fieldIssues(TEXT, { g: {} })).toEqual([
        'uiSchema.g: "g" is not a declared field or "ui:order"',
      ])
      expect(fieldIssues(TEXT, { 'ui:order': ['f', 'f', 'g'] })).toEqual([
        'uiSchema.ui:order.1: "f" is listed twice',
        'uiSchema.ui:order.2: "g" is not a declared field or "*"',
      ])
      expect(fieldIssues(TEXT, 'x')).toEqual(['uiSchema: must be an object'])
    })
  })
})

describe('template document (TPL-1)', () => {
  const sitrep = (): Template => sampleTemplates()[0]!

  it('reads as the `template` document kind', () => {
    const parsed = parseDocument('template', JSON.stringify(sitrep()))
    expect(parsed.ok).toBe(true)
  })

  it('refuses a schema outside the profile, with the path to the problem', () => {
    const bad = { ...sitrep(), schema: { type: 'object', properties: { a: { type: 'string' } } } }
    const parsed = parseDocument('template', bad)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error.issues?.[0]?.path).toEqual(['schema', 'properties', 'a', 'maxLength'])
    }
  })

  it('refuses a template over the PubSub item limit', () => {
    const description = 'x'.repeat(TEMPLATE_LIMITS.descriptionChars)
    const properties = Object.fromEntries(
      Array.from({ length: TEMPLATE_LIMITS.fields }, (_, i) => [
        `f${i}`,
        { type: 'string', enum: Array.from({ length: 20 }, (_, j) => `${'o'.repeat(180)}${j}`) },
      ]),
    )
    const big = {
      ...sitrep(),
      description,
      schema: { type: 'object', properties },
      uiSchema: undefined,
    }
    const parsed = templateSchema.safeParse(big)
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((i) => i.message)).toContain(
      'the template does not fit in one PubSub item',
    )
    expect(JSON.stringify(big).length).toBeGreaterThan(LIMITS.pubsubItemBytes)
  })
})

describe('chat room config version 2 (TPL-2)', () => {
  it('reads version 1 (`{}`) as free text and no templates', () => {
    for (const v1 of [{}, { schemaVersion: 1 }, { anything: true }]) {
      expect(chatRoomConfigReader.parse(v1)).toEqual({
        schemaVersion: 2,
        freeText: true,
        templates: [],
      })
    }
  })

  it('reads version 2 as it is', () => {
    expect(chatRoomConfigReader.parse(blueReportsConfig())).toEqual(blueReportsConfig())
  })

  it('refuses a broken version 2 and later versions', () => {
    expect(
      chatRoomConfigReader.safeParse({ schemaVersion: 2, freeText: 'yes', templates: [] }).success,
    ).toBe(false)
    expect(
      chatRoomConfigReader.safeParse({ schemaVersion: 3, freeText: true, templates: [] }).success,
    ).toBe(false)
    const twice = {
      schemaVersion: 2,
      freeText: true,
      templates: [
        { kind: 'force', id: FORCE.blue, templateIds: [] },
        { kind: 'force', id: FORCE.blue, templateIds: [] },
      ],
    }
    expect(chatRoomConfigReader.safeParse(twice).success).toBe(false)
    const repeated = {
      schemaVersion: 2,
      freeText: true,
      templates: [
        { kind: 'force', id: FORCE.blue, templateIds: [TEMPLATE.sitrep, TEMPLATE.sitrep] },
      ],
    }
    expect(chatRoomConfigReader.safeParse(repeated).success).toBe(false)
  })
})

describe('template message body (TPL-3)', () => {
  const body = (values: unknown) => ({
    type: 'template',
    schemaVersion: 1,
    content: { templateId: TEMPLATE.sitrep, values },
  })

  it('joins the message body union', () => {
    expect(
      messageBodySchema.safeParse(body({ summary: 'ok', readiness: 50, urgent: true })).success,
    ).toBe(true)
  })

  it('refuses nested values, null, unknown names and long text', () => {
    for (const values of [
      { a: { b: 1 } },
      { a: [1] },
      { a: null },
      { __proto__x: 1, ['1a']: 2 },
      { a: 'x'.repeat(LIMITS.messageTextChars + 1) },
    ]) {
      expect(
        templateMessageBodySchema.safeParse(body(values)).success,
        JSON.stringify(values),
      ).toBe(false)
    }
    const parsed: unknown = JSON.parse('{"constructor": "x"}')
    expect(templateMessageBodySchema.safeParse(body(parsed)).success).toBe(false)
    const many = Object.fromEntries(
      Array.from({ length: TEMPLATE_LIMITS.fields + 1 }, (_, i) => [`f${i}`, 1]),
    )
    expect(templateMessageBodySchema.safeParse(body(many)).success).toBe(false)
  })

  it('refuses a template id that is not a GUID', () => {
    expect(
      templateMessageBodySchema.safeParse({
        ...body({}),
        content: { templateId: 'sitrep', values: {} },
      }).success,
    ).toBe(false)
  })
})

describe('templates in the design (Annex A)', () => {
  it('reads a design file from before templates with none', () => {
    const { templates: _none, ...old } = sampleDesign()
    const parsed = designFileSchema.parse(old)
    expect(parsed.templates).toEqual([])
  })

  it('accepts the templated design', () => {
    const design = designFileSchema.parse(templatedDesign())
    expect(checkDesign(design)).toEqual([])
  })

  it('refuses unknown templates, forces and roles in a room’s config, and duplicate ids', () => {
    const design = templatedDesign()
    const ghost = '90000000-0000-4000-8000-000000000009'
    const rooms = design.rooms.map((r) =>
      r.id === ROOM.blueReports
        ? {
            ...r,
            config: {
              schemaVersion: 2,
              freeText: true,
              templates: [
                { kind: 'force', id: ghost, templateIds: [TEMPLATE.sitrep] },
                { kind: 'role', id: ROLE.blueCo, templateIds: [ghost] },
              ],
            },
          }
        : r,
    )
    const templates = [...design.templates, { ...design.templates[0]!, name: 'Copy' }]
    expect(
      checkDesign({ ...design, rooms, templates }).map(
        (i) => `${i.severity} ${i.path}: ${i.message}`,
      ),
    ).toEqual([
      `error templates[3].id: duplicate id "${TEMPLATE.sitrep}"`,
      `error rooms[3].config.templates[0]: unknown force "${ghost}"`,
      `error rooms[3].config.templates[1].templateIds[0]: unknown template "${ghost}"`,
    ])
  })

  it('refuses a template id another entity has, and an invalid config', () => {
    const design = templatedDesign()
    const templates = design.templates.map((t, i) => (i === 0 ? { ...t, id: FORCE.blue } : t))
    const rooms = design.rooms.map((r) =>
      r.id === ROOM.blueHq ? { ...r, config: { schemaVersion: 2, freeText: 'no' } } : r,
    )
    const issues = checkDesign({ ...design, templates, rooms }).map((i) => i.path)
    expect(issues).toContain('templates[0].id')
    expect(issues).toContain('rooms[0].config')
  })

  it('warns of a role picker filtered by an unknown force, and of a room nobody can post in', () => {
    const design = templatedDesign()
    const support = design.templates[2]!
    const ghost = '90000000-0000-4000-8000-000000000009'
    const properties = {
      ...(support.schema.properties as object),
      to: { type: 'string', 'x-wrx-picker': 'role', 'x-wrx-force': ghost },
    }
    const templates = [
      design.templates[0]!,
      design.templates[1]!,
      { ...support, schema: { ...support.schema, properties } },
    ]
    const rooms = design.rooms.map((r) =>
      r.id === ROOM.blueReports
        ? { ...r, config: { schemaVersion: 2, freeText: false, templates: [] } }
        : r,
    )
    expect(
      checkDesign({ ...design, templates, rooms }).map((i) => `${i.severity} ${i.path}`),
    ).toEqual(['warning templates[2].schema.properties.to', 'warning rooms[3].config'])
  })

  describe('locks (TD6, provisional answer 2)', () => {
    it('finds the templates the rooms make available', () => {
      expect([...templatesInRooms(templatedDesign())].sort()).toEqual(
        [TEMPLATE.sitrep, TEMPLATE.contact, TEMPLATE.support].sort(),
      )
      expect(templatesInRooms(sampleDesign()).size).toBe(0)
    })

    it('locks the templates a room makes available, at the design’s export time', () => {
      const design = templatedDesign()
      const unused = {
        ...sampleTemplates()[0]!,
        id: '50000000-0000-4000-8000-0000000000ff',
        name: 'Unused',
      }
      const locked = withTemplateLocks({ ...design, templates: [...design.templates, unused] }, [])
      expect(locked.templates.map((t) => t.lockedAt)).toEqual([
        design.exportedAt,
        design.exportedAt,
        design.exportedAt,
        undefined,
      ])
    })

    it('keeps the server’s lock, then the design’s, and never removes one', () => {
      const design = sampleDesign()
      const [a, b, c] = sampleTemplates()
      const withLocks = {
        ...design,
        templates: [a!, { ...b!, lockedAt: T }, c!],
      }
      const published = [{ id: a!.id, lockedAt: '2026-01-01T00:00:00.000Z' }, { id: b!.id }]
      const result = withTemplateLocks(withLocks, published)
      expect(result.templates.map((t) => t.lockedAt)).toEqual([
        '2026-01-01T00:00:00.000Z',
        T,
        undefined,
      ])
      expect(withTemplateLocks(result, published)).toBe(result)
    })
  })
})
