import { describe, expect, it } from 'vitest'
import { LIMITS, slugSchema } from './common.ts'
import {
  announcementSchema,
  assetSchema,
  base64DecodedLength,
  forceSchema,
  gameSetupSchema,
  gameStateSchema,
  objectivesSchema,
  roleSchema,
  roomSchema,
} from './documents.ts'
import { pixelAsset, sampleDesign } from './fixtures.ts'
import { chatMessageBodySchema, messageBodySchema } from './message.ts'
import { themeSchema } from './theme.ts'

const design = sampleDesign()
const blue = design.forces[0]!
const blueCo = design.roles[0]!
const blueHq = design.rooms[0]!

describe('slugs (§3 rule 1)', () => {
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
    ['asset', assetSchema, pixelAsset('logo')],
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
  it('references assets by slug', () => {
    expect(themeSchema.safeParse({ tokens: {}, logoAssetId: 'Logo.png' }).success).toBe(false)
  })
})

describe('roles', () => {
  it('drops any password field when read from the network (§3 rule 9)', () => {
    const parsed = roleSchema.parse({ ...blueCo, password: 'secret' })
    expect(parsed).not.toHaveProperty('password')
  })
})

describe('rooms (§3 rule 4)', () => {
  it('accepts mixed force and role entries', () => {
    const participants = [
      { kind: 'force', id: 'blue', access: 'write' },
      { kind: 'role', id: 'red-co', access: 'read' },
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
      { kind: 'force', id: 'blue', access: 'write' },
      { kind: 'role', id: 'blue', access: 'read' },
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
    expect(assetSchema.safeParse({ ...pixelAsset('a'), mimeType: 'image/webp' }).success).toBe(true)
    expect(assetSchema.safeParse({ ...pixelAsset('a'), mimeType: 'image/gif' }).success).toBe(false)
  })
  it('requires size to match the decoded data', () => {
    expect(assetSchema.safeParse({ ...pixelAsset('a'), size: 69 }).success).toBe(false)
  })
  it('rejects data that is not base64', () => {
    expect(assetSchema.safeParse({ ...pixelAsset('a'), data: 'not base64!' }).success).toBe(false)
  })
  it('rejects assets too large for one PubSub item', () => {
    const size = LIMITS.assetHardBytes + 3
    const data = 'A'.repeat((size / 3) * 4)
    expect(assetSchema.safeParse({ ...pixelAsset('a'), size, data }).success).toBe(false)
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
