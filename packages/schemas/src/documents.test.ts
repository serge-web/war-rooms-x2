import { describe, expect, it } from 'vitest'
import { LIMITS, idSchema, isId, newEntityId, slugSchema } from './common.ts'
import {
  announcementSchema,
  assetSchema,
  base64DecodedLength,
  forceSchema,
  gameSetupSchema,
  gameStateSchema,
  objectivesSchema,
  retiredSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import { ASSET, FORCE, ROLE, pixelAsset, sampleDesign } from './fixtures.ts'
import { chatMessageBodySchema, messageBodySchema } from './message.ts'
import { themeSchema } from './theme.ts'

const design = sampleDesign()
const blue = design.forces[0]!
const blueCo = design.roles[0]!
const blueHq = design.rooms[0]!

const A = ASSET.gameLogo

describe('ids are lowercase GUIDs (§3 rule 1)', () => {
  it.each([FORCE.blue, '0f8fad5b-d9cb-469f-a165-70867728950e'])('accepts %s', (id) => {
    expect(idSchema.safeParse(id).success).toBe(true)
  })
  it.each([
    'blue',
    'blue-co',
    '0F8FAD5B-D9CB-469F-A165-70867728950E',
    '0f8fad5b-d9cb-469f-a165-70867728950',
    '{0f8fad5b-d9cb-469f-a165-70867728950e}',
    '0f8fad5bd9cb469fa16570867728950e',
  ])('rejects %j', (id) => {
    expect(idSchema.safeParse(id).success).toBe(false)
  })

  it('makes new ids with crypto.randomUUID in a secure context', () => {
    const id = newEntityId()
    expect(isId(id)).toBe(true)
    expect(newEntityId()).not.toBe(id)
  })

  it('makes version 4 ids from getRandomValues where there is no randomUUID (NFR-8)', () => {
    // A page served over plain http: no randomUUID, getRandomValues only.
    const insecure = {
      getRandomValues: (array: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(array),
    }
    const ids = new Set(Array.from({ length: 200 }, () => newEntityId(insecure)))
    expect(ids.size).toBe(200)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
    const zeros = { getRandomValues: (array: Uint8Array<ArrayBuffer>) => array }
    expect(newEntityId(zeros)).toBe('00000000-0000-4000-8000-000000000000')
  })
})

describe('slugs: room types and login names', () => {
  it.each(['blue', 'blue-co', 'a1', 'x'.repeat(64)])('accepts %s', (id) => {
    expect(slugSchema.safeParse(id).success).toBe(true)
  })
  it.each(['', 'Blue', 'blue_co', '-blue', 'blue-', 'blue--co', 'blue co', 'x'.repeat(65), 'é'])(
    'rejects %j',
    (id) => {
      expect(slugSchema.safeParse(id).success).toBe(false)
    },
  )
})

describe('every document carries schemaVersion 1', () => {
  it.each([
    ['game-setup', gameSetupSchema, design.game],
    ['force', forceSchema, blue],
    ['role', roleSchema, blueCo],
    ['room', roomSchema, blueHq],
    ['objectives', objectivesSchema, design.objectives[0]!],
    ['asset', assetSchema, pixelAsset(A)],
    [
      'retired',
      retiredSchema,
      {
        schemaVersion: 1,
        id: ROLE.redCo,
        kind: 'role',
        name: 'Red CO',
        loginName: 'red-co',
        colour: '#b91c1c',
        deletedAt: '2026-11-01T10:00:00Z',
      },
    ],
    [
      'announcement',
      announcementSchema,
      { schemaVersion: 1, text: 'Break', postedAt: '2026-10-24T10:00:00Z' },
    ],
    ['game-state', gameStateSchema, { schemaVersion: 1 }],
  ] as const)('%s', (_name, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse({ ...valid, schemaVersion: 2 }).success).toBe(false)
    const { schemaVersion: _v, ...withoutVersion } = valid
    expect(schema.safeParse(withoutVersion).success).toBe(false)
  })
})

describe('game setup', () => {
  it('requires a positive designVersion', () => {
    expect(gameSetupSchema.safeParse({ ...design.game, designVersion: 0 }).success).toBe(false)
    expect(gameSetupSchema.safeParse({ ...design.game, designVersion: 1.5 }).success).toBe(false)
  })
  it('caps the briefing', () => {
    const briefing = 'x'.repeat(LIMITS.briefingChars + 1)
    expect(gameSetupSchema.safeParse({ ...design.game, briefing }).success).toBe(false)
  })
  it('rejects an empty or whitespace-only name', () => {
    expect(gameSetupSchema.safeParse({ ...design.game, name: '   ' }).success).toBe(false)
  })
})

describe('themes (§3 rules 10–11)', () => {
  it('allows every token to be unset, so it inherits', () => {
    expect(themeSchema.safeParse({ tokens: {} }).success).toBe(true)
  })
  it.each(['red', '#fff', '#12345g', 'rgb(0,0,0)'])('rejects colour %s', (primary) => {
    expect(themeSchema.safeParse({ tokens: { primary } }).success).toBe(false)
  })
  it('accepts only bundled fonts', () => {
    expect(themeSchema.safeParse({ tokens: { fontFamily: 'serif' } }).success).toBe(true)
    expect(themeSchema.safeParse({ tokens: { fontFamily: 'Comic Sans' } }).success).toBe(false)
  })
  it('references assets by GUID', () => {
    expect(themeSchema.safeParse({ tokens: {}, logoAssetId: 'game-logo' }).success).toBe(false)
    expect(themeSchema.safeParse({ tokens: {}, logoAssetId: A }).success).toBe(true)
  })
})

describe('roles', () => {
  it('drops any password field when read from the network (§3 rule 9)', () => {
    const parsed = roleSchema.parse({ ...blueCo, password: 'secret' })
    expect(parsed).not.toHaveProperty('password')
  })
  it('has a GUID id and a separate, slug-shaped login name (§3 rule 1)', () => {
    expect(roleSchema.safeParse({ ...blueCo, id: 'blue-co' }).success).toBe(false)
    expect(roleSchema.safeParse({ ...blueCo, loginName: 'Blue CO' }).success).toBe(false)
    const { loginName: _l, ...withoutLogin } = blueCo
    expect(roleSchema.safeParse(withoutLogin).success).toBe(false)
  })
})

describe('retired records (§3 rule 1, ADM-14)', () => {
  const role = {
    schemaVersion: 1,
    id: ROLE.redCo,
    kind: 'role',
    name: 'Red CO',
    loginName: 'red-co',
    deletedAt: '2026-11-01T10:00:00Z',
  } as const
  it('needs a login name for a role, and none for a force', () => {
    expect(retiredSchema.safeParse(role).success).toBe(true)
    const { loginName: _l, ...noLogin } = role
    expect(retiredSchema.safeParse(noLogin).success).toBe(false)
    expect(retiredSchema.safeParse({ ...noLogin, kind: 'force', id: FORCE.red }).success).toBe(true)
    expect(retiredSchema.safeParse({ ...role, kind: 'force' }).success).toBe(false)
  })
})

describe('rooms (§3 rule 4)', () => {
  it('accepts mixed force and role entries', () => {
    const participants = [
      { kind: 'force', id: FORCE.blue, access: 'write' },
      { kind: 'role', id: ROLE.redCo, access: 'read' },
    ]
    expect(roomSchema.safeParse({ ...blueHq, participants }).success).toBe(true)
  })
  it('rejects the same participant twice', () => {
    const participants = [
      { kind: 'force', id: 'blue', access: 'write' },
      { kind: 'force', id: 'blue', access: 'read' },
    ]
    expect(roomSchema.safeParse({ ...blueHq, participants }).success).toBe(false)
  })
  it('allows a force and a role with the same id', () => {
    const participants = [
      { kind: 'force', id: FORCE.blue, access: 'write' },
      { kind: 'role', id: FORCE.blue, access: 'read' },
    ]
    expect(roomSchema.safeParse({ ...blueHq, participants }).success).toBe(true)
  })
  it.each([{ kind: 'group' }, { access: 'admin' }])('rejects participant field %j', (bad) => {
    const participants = [{ kind: 'force', id: 'blue', access: 'write', ...bad }]
    expect(roomSchema.safeParse({ ...blueHq, participants }).success).toBe(false)
  })
})

describe('assets (§3 rule 12)', () => {
  it('accepts PNG, WebP and SVG only', () => {
    expect(assetSchema.safeParse({ ...pixelAsset(A), mimeType: 'image/webp' }).success).toBe(true)
    expect(assetSchema.safeParse({ ...pixelAsset(A), mimeType: 'image/gif' }).success).toBe(false)
  })
  it('requires size to match the decoded data', () => {
    expect(assetSchema.safeParse({ ...pixelAsset(A), size: 69 }).success).toBe(false)
  })
  it('rejects data that is not base64', () => {
    expect(assetSchema.safeParse({ ...pixelAsset(A), data: 'not base64!' }).success).toBe(false)
  })
  it('rejects assets too large for one PubSub item', () => {
    const size = LIMITS.assetHardBytes + 3
    const data = 'A'.repeat((size / 3) * 4)
    expect(assetSchema.safeParse({ ...pixelAsset(A), size, data }).success).toBe(false)
  })
  it('computes decoded length with and without padding', () => {
    expect(base64DecodedLength('AAAA')).toBe(3)
    expect(base64DecodedLength('AAA=')).toBe(2)
    expect(base64DecodedLength('AA==')).toBe(1)
  })
  it('keeps the hard limit within the PubSub item limit once base64-encoded', () => {
    expect((LIMITS.assetHardBytes * 4) / 3 + LIMITS.pubsubItemOverheadBytes).toBeLessThan(
      LIMITS.pubsubItemBytes,
    )
  })
})

describe('announcements (PLY-37)', () => {
  const valid = { schemaVersion: 1, text: 'Lunch at 12:30', postedAt: '2026-10-24T10:00:00+01:00' }
  it('requires a timestamp with an offset', () => {
    expect(announcementSchema.safeParse(valid).success).toBe(true)
    expect(announcementSchema.safeParse({ ...valid, postedAt: '24/10/2026' }).success).toBe(false)
  })
  it('caps the text', () => {
    const text = 'x'.repeat(LIMITS.announcementTextChars + 1)
    expect(announcementSchema.safeParse({ ...valid, text }).success).toBe(false)
  })
})

describe('message bodies (§3, PLY-53)', () => {
  const valid = { type: 'chat', schemaVersion: 1, content: { text: 'Hello' } }
  it('accepts a chat message', () => {
    expect(messageBodySchema.parse(valid)).toEqual(valid)
  })
  it('rejects unknown types', () => {
    expect(messageBodySchema.safeParse({ ...valid, type: 'form' }).success).toBe(false)
  })
  it('rejects empty and oversized text', () => {
    expect(chatMessageBodySchema.safeParse({ ...valid, content: { text: '' } }).success).toBe(false)
    const text = 'x'.repeat(LIMITS.messageTextChars + 1)
    expect(chatMessageBodySchema.safeParse({ ...valid, content: { text } }).success).toBe(false)
  })
  it('keeps the largest text, escaped and wrapped in JSON, inside the stanza cap', () => {
    // Worst case per character: `"` becomes `\"` in JSON, then `\&quot;` in XML: 7 bytes.
    const body = JSON.stringify({
      ...valid,
      content: { text: '"'.repeat(LIMITS.messageTextChars) },
    })
    const escaped = body.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    const stanzaOverhead = 1_000
    expect(new TextEncoder().encode(escaped).length + stanzaOverhead).toBeLessThan(
      LIMITS.messageStanzaBytes,
    )
  })
  it('strips a sender claimed in the body (§3 rule 3, R9)', () => {
    const parsed = messageBodySchema.parse({ ...valid, from: 'umpire-1' })
    expect(parsed).not.toHaveProperty('from')
  })
})
