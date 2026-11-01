import { describe, expect, it } from 'vitest'
import { LIMITS, isId } from './common.ts'
import { checkDesign, designFileSchema, publicAssetIds } from './design.ts'
import type { DesignFile } from './design.ts'
import { ASSET, FORCE, ROLE, ROOM, pixelAsset, sampleDesign, sampleDesignV1 } from './fixtures.ts'
import { convertDesignV1, readDesignFile } from './legacy.ts'

/** Ids that no entity of the sample design has. */
const GHOST = '90000000-0000-4000-8000-000000000001'
const GREEN = '90000000-0000-4000-8000-000000000002'
const OTHER = '90000000-0000-4000-8000-000000000003'

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
    expect(messages(design)).toContain(`error roles[4].id: duplicate id "${ROLE.blueCo}"`)
  })

  it('finds a role in an unknown force', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, forceId: GREEN }
    expect(messages(design)).toContain(`error roles[0].forceId: unknown force "${GREEN}"`)
  })

  it('refuses reserved login names', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, loginName: 'admin' }
    expect(messages(design)).toContain(
      'error roles[0].loginName: "admin" is reserved and cannot be a login name',
    )
  })

  it('refuses all-digit login names of 16 or more, which ejabberd’s anonymous sessions use (F4)', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, loginName: '1234567890123456' }
    design.roles[1] = { ...design.roles[1]!, loginName: '123456789012345' }
    expect(messages(design)).toContain(
      'error roles[0].loginName: "1234567890123456" looks like an anonymous session and cannot be a login name',
    )
    expect(messages(design).filter((m) => m.includes('roles[1].loginName'))).toEqual([])
  })

  it('refuses a login name two roles share (§3 rule 1)', () => {
    const design = sampleDesign()
    design.roles[1] = { ...design.roles[1]!, loginName: 'blue-co' }
    expect(messages(design)).toEqual([
      'error roles[1].loginName: another role has the login name "blue-co"',
    ])
  })

  it('refuses a deleted role’s login name or id for another role (§3 rule 1)', () => {
    const design = sampleDesign()
    design.retired.push({
      schemaVersion: 1,
      id: GHOST,
      kind: 'role',
      name: 'Old Blue CO',
      loginName: 'blue-co',
      deletedAt: T,
    })
    design.retired.push({
      schemaVersion: 1,
      id: ROOM.redHq,
      kind: 'force',
      name: 'X',
      deletedAt: T,
    })
    expect(messages(design)).toEqual([
      `error retired[1].id: "${ROOM.redHq}" belongs to a deleted force and cannot be reused`,
      'error roles[0].loginName: "blue-co" was a deleted role\'s login name and cannot be given to another role',
    ])
  })

  it('finds participants that do not exist', () => {
    const design = sampleDesign()
    design.rooms[0]!.participants.push({ kind: 'role', id: GHOST, access: 'read' })
    expect(messages(design)).toContain(`error rooms[0].participants[1]: unknown role "${GHOST}"`)
  })

  it('finds missing assets in every theme', () => {
    const design = sampleDesign()
    design.assets = []
    design.forces[0] = {
      ...design.forces[0]!,
      iconAssetId: GHOST,
      theme: { tokens: {}, logoAssetId: GREEN },
    }
    design.rooms[0] = { ...design.rooms[0]!, theme: { tokens: {}, iconAssetId: OTHER } }
    expect(messages(design)).toEqual([
      `error game.theme.logoAssetId: unknown asset "${ASSET.gameLogo}"`,
      `error forces[0].iconAssetId: unknown asset "${GHOST}"`,
      `error forces[0].theme.logoAssetId: unknown asset "${GREEN}"`,
      `error rooms[0].theme.iconAssetId: unknown asset "${OTHER}"`,
    ])
  })

  it('warns unless exactly one force carries the umpire flag (ADM-4)', () => {
    const design = sampleDesign()
    design.forces[1] = { ...design.forces[1]!, isUmpire: true }
    expect(messages(design)).toEqual([
      'warning forces: 2 forces carry the umpire flag; exactly one is expected (ADM-4)',
    ])
    design.forces = design.forces.map((f) => ({ ...f, isUmpire: false }))
    expect(messages(design)).toEqual([
      'warning forces: no force carries the umpire flag; exactly one, the White Force, is expected (ADM-4)',
    ])
  })

  it('warns about a role named like the umpire, which the admin plays as (SC-5)', () => {
    const design = sampleDesign()
    design.roles[0] = { ...design.roles[0]!, name: ' umpire ' }
    expect(messages(design)).toEqual([
      'warning roles[0].name: a role named "Umpire" looks like the admin, who plays as the umpire',
    ])
  })

  it('warns about a room nobody can join', () => {
    const design = sampleDesign()
    design.forces = design.forces.map((f) => ({ ...f, isUmpire: false }))
    design.rooms[0] = { ...design.rooms[0]!, participants: [] }
    expect(messages(design)).toEqual([
      'warning forces: no force carries the umpire flag; exactly one, the White Force, is expected (ADM-4)',
      'warning rooms[0].participants: room has no participants',
    ])
  })

  it('finds objectives for unknown or repeated forces', () => {
    const design = sampleDesign()
    design.objectives.push({ schemaVersion: 1, forceId: FORCE.blue, markdown: '', updatedAt: T })
    design.objectives.push({ schemaVersion: 1, forceId: GREEN, markdown: '', updatedAt: T })
    expect(messages(design)).toEqual([
      `error objectives[2].forceId: second objectives document for force "${FORCE.blue}"`,
      `error objectives[3].forceId: unknown force "${GREEN}"`,
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
    design.assets.push(pixelAsset(GHOST))
    design.forces[0] = { ...design.forces[0]!, theme: { tokens: {}, logoAssetId: GHOST } }
    expect(publicAssetIds(design.game)).toEqual([ASSET.gameLogo])
  })

  it('lists a shared logo and icon once', () => {
    const game = {
      ...sampleDesign().game,
      theme: { tokens: {}, logoAssetId: 'a', iconAssetId: 'a' },
    }
    expect(publicAssetIds(game)).toEqual(['a'])
  })
})

describe('design files from before GUID ids (ADM-16, §3 rule 1)', () => {
  /** A version 1 file with every field that holds an id set. */
  function everyIdField() {
    const v1 = sampleDesignV1()
    v1.game.theme = { tokens: {}, logoAssetId: 'game-logo', iconAssetId: 'icon' }
    v1.assets.push(pixelAsset('icon'))
    v1.forces[0] = {
      ...v1.forces[0]!,
      iconAssetId: 'icon',
      theme: { tokens: {}, logoAssetId: 'icon' },
    }
    v1.rooms[0] = {
      ...v1.rooms[0]!,
      participants: [
        { kind: 'force', id: 'blue', access: 'write' },
        { kind: 'role', id: 'red-co', access: 'read' },
      ],
      theme: { tokens: {}, iconAssetId: 'game-logo', logoAssetId: 'icon' },
    }
    return v1
  }

  it('gives every entity a GUID, rewrites every reference and keeps role ids as login names', () => {
    const v1 = everyIdField()
    let n = 0
    const newId = () => `a0000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`
    const { design, ids } = convertDesignV1(v1, { newId })
    expect(designFileSchema.safeParse(design).success).toBe(true)
    expect(checkDesign(design)).toEqual([])
    expect(design.schemaVersion).toBe(2)
    expect(design.retired).toEqual([])
    // Every id is a new GUID, and the maps say which.
    const all = [
      ...design.forces.map((f) => f.id),
      ...design.roles.map((r) => r.id),
      ...design.rooms.map((r) => r.id),
      ...design.assets.map((a) => a.id),
    ]
    expect(all.every(isId)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
    expect([...ids.forces.keys()]).toEqual(['blue', 'red', 'white'])
    expect([...ids.rooms.keys()]).toEqual(['blue-hq', 'red-hq', 'negotiation'])
    expect([...ids.assets.keys()]).toEqual(['game-logo', 'icon'])
    const force = (old: string) => ids.forces.get(old)
    const role = (old: string) => ids.roles.get(old)
    const asset = (old: string) => ids.assets.get(old)
    // Roles: the old id is the login name; the force follows.
    expect(design.roles.map((r) => [r.loginName, r.id, r.forceId])).toEqual(
      v1.roles.map((r) => [r.id, role(r.id), force(r.forceId)]),
    )
    // Every other field that holds an id.
    expect(design.game.theme).toEqual({
      tokens: {},
      logoAssetId: asset('game-logo'),
      iconAssetId: asset('icon'),
    })
    expect(design.forces[0]).toMatchObject({
      iconAssetId: asset('icon'),
      theme: { logoAssetId: asset('icon') },
    })
    expect(design.rooms[0]).toMatchObject({
      participants: [
        { kind: 'force', id: force('blue'), access: 'write' },
        { kind: 'role', id: role('red-co'), access: 'read' },
      ],
      theme: { iconAssetId: asset('game-logo'), logoAssetId: asset('icon') },
    })
    expect(design.rooms[2]?.participants.map((p) => p.id)).toEqual([
      role('blue-co'),
      role('red-co'),
    ])
    expect(design.objectives.map((o) => o.forceId)).toEqual([force('blue'), force('red')])
    // Names, text and order are kept.
    expect(design.forces.map((f) => [f.name, f.order, f.isUmpire])).toEqual(
      v1.forces.map((f) => [f.name, f.order, f.isUmpire]),
    )
    expect(design.objectives.map((o) => o.markdown)).toEqual(v1.objectives.map((o) => o.markdown))
  })

  it('round-trips: a converted file reads back unchanged as version 2', () => {
    const read = readDesignFile(JSON.parse(JSON.stringify(everyIdField())))
    if (!read.ok) throw new Error('not converted')
    expect(read.value.converted).toBeDefined()
    const again = readDesignFile(JSON.parse(JSON.stringify(read.value.design)))
    expect(again).toEqual({ ok: true, value: { design: read.value.design } })
  })

  it('reads a version 2 file as it is, and refuses a version 1 file with a password', () => {
    expect(readDesignFile(sampleDesign())).toEqual({ ok: true, value: { design: sampleDesign() } })
    const v1 = sampleDesignV1()
    const withPassword = { ...v1, roles: v1.roles.map((r) => ({ ...r, password: 'x' })) }
    expect(readDesignFile(withPassword).ok).toBe(false)
    expect(readDesignFile({ ...sampleDesign(), schemaVersion: 3 }).ok).toBe(false)
  })

  it('keeps an unknown reference unknown, so the check still reports it', () => {
    const v1 = sampleDesignV1()
    v1.roles[0] = { ...v1.roles[0]!, forceId: 'green' }
    const { design } = convertDesignV1(v1)
    expect(checkDesign(design).map((i) => i.path)).toEqual(['roles[0].forceId'])
  })
})
