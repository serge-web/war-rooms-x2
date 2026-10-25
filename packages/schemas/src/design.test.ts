import { describe, expect, it } from 'vitest'
import { LIMITS } from './common.ts'
import { checkDesign, designFileSchema, publicAssetIds } from './design.ts'
import type { DesignFile } from './design.ts'
import { pixelAsset, sampleDesign } from './fixtures.ts'

const T = '2026-10-24T12:00:00.000Z'

function messages(design: DesignFile) {
  return checkDesign(design).map((i) => `${i.severity} ${i.path}: ${i.message}`)
}

describe('design file (ADM-16)', () => {
  it('accepts the sample design', () => {
    expect(designFileSchema.safeParse(sampleDesign()).success).toBe(true)
    expect(checkDesign(sampleDesign())).toEqual([])
  })

  it('rejects a role carrying a password (§3 rule 9)', () => {
    const design = sampleDesign()
    const roles = design.roles.map((r) => ({ ...r, password: 'hunter2' }))
    expect(designFileSchema.safeParse({ ...design, roles }).success).toBe(false)
  })

  it('rejects other formats', () => {
    expect(designFileSchema.safeParse({ ...sampleDesign(), format: 'serge' }).success).toBe(false)
  })
})

describe('checkDesign', () => {
  it('finds duplicate ids', () => {
    const design = sampleDesign()
    design.roles.push({ ...design.roles[0]! })
    expect(messages(design)).toContain('error roles[4].id: duplicate id "blue-co"')
  })

  it('finds a role in an unknown force', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, forceId: 'green' }
    expect(messages(design)).toContain('error roles[0].forceId: unknown force "green"')
  })

  it('refuses reserved role ids', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, id: 'admin' }
    expect(messages(design)).toContain(
      'error roles[0].id: "admin" is reserved and cannot be a role id',
    )
  })

  it('refuses all-digit role ids of 16 or more, which ejabberd’s anonymous sessions use (F4)', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, id: '1234567890123456' }
    design.roles[1] = { ...design.roles[1]!, id: '123456789012345' }
    expect(messages(design)).toContain(
      'error roles[0].id: "1234567890123456" is reserved and cannot be a role id',
    )
    expect(messages(design).filter((m) => m.includes('roles[1].id'))).toEqual([])
  })

  it('finds participants that do not exist', () => {
    const design = sampleDesign()
    design.rooms[0]!.participants.push({ kind: 'role', id: 'ghost', access: 'read' })
    expect(messages(design)).toContain('error rooms[0].participants[1]: unknown role "ghost"')
  })

  it('finds missing assets in every theme', () => {
    const design = sampleDesign()
    design.assets = []
    design.forces[0] = {
      ...design.forces[0]!,
      iconAssetId: 'blue-icon',
      theme: { tokens: {}, logoAssetId: 'blue-logo' },
    }
    design.rooms[0] = { ...design.rooms[0]!, theme: { tokens: {}, iconAssetId: 'room-icon' } }
    expect(messages(design)).toEqual([
      'error game.theme.logoAssetId: unknown asset "game-logo"',
      'error forces[0].iconAssetId: unknown asset "blue-icon"',
      'error forces[0].theme.logoAssetId: unknown asset "blue-logo"',
      'error rooms[0].theme.iconAssetId: unknown asset "room-icon"',
    ])
  })

  it('warns about more than one umpire force (ADM-4)', () => {
    const design = sampleDesign()
    design.forces[1] = { ...design.forces[1]!, isUmpire: true }
    expect(messages(design)).toEqual([
      'warning forces: 2 umpire forces; at most one is expected (ADM-4)',
    ])
  })

  it('warns about a room nobody can join', () => {
    const design = sampleDesign()
    design.forces = design.forces.map((f) => ({ ...f, isUmpire: false }))
    design.rooms[0] = { ...design.rooms[0]!, participants: [] }
    expect(messages(design)).toEqual(['warning rooms[0].participants: room has no participants'])
  })

  it('finds objectives for unknown or repeated forces', () => {
    const design = sampleDesign()
    design.objectives.push({ schemaVersion: 1, forceId: 'blue', markdown: '', updatedAt: T })
    design.objectives.push({ schemaVersion: 1, forceId: 'green', markdown: '', updatedAt: T })
    expect(messages(design)).toEqual([
      'error objectives[2].forceId: second objectives document for force "blue"',
      'error objectives[3].forceId: unknown force "green"',
    ])
  })

  it('warns about assets over the admin limit', () => {
    const design = sampleDesign()
    const issues = checkDesign(design, { assetLimitBytes: 10 })
    expect(issues).toEqual([
      {
        severity: 'warning',
        path: 'assets[0].size',
        message: '68 bytes is over the 10-byte limit',
      },
    ])
    expect(LIMITS.assetDefaultBytes).toBe(102_400)
  })
})

describe('publicAssetIds (D20, NFR-21)', () => {
  it('lists only the game theme assets', () => {
    const design = sampleDesign()
    design.assets.push(pixelAsset('blue-logo'))
    design.forces[0] = { ...design.forces[0]!, theme: { tokens: {}, logoAssetId: 'blue-logo' } }
    expect(publicAssetIds(design.game)).toEqual(['game-logo'])
  })

  it('lists a shared logo and icon once', () => {
    const game = {
      ...sampleDesign().game,
      theme: { tokens: {}, logoAssetId: 'a', iconAssetId: 'a' },
    }
    expect(publicAssetIds(game)).toEqual(['a'])
  })
})
