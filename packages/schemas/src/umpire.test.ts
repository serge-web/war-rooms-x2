// The umpire room and White Force proposals (PD6, PD8, PY-8, §3 rule 18; WP 6.4): the fixed
// participants, the design check, `withUmpireRoom`, and the proposal body with its 500 KB cap.
import { describe, expect, it } from 'vitest'
import { checkDesign, withUmpireRoom } from './design.ts'
import type { DesignFile } from './design.ts'
import { FORCE, ROLE, ROOM, demoDesign, sampleDesign, sampleWorldState } from './fixtures.ts'
import { messageBodySchema } from './message.ts'
import {
  UMPIRE_ROOM_TYPE,
  hasUmpireParticipants,
  umpireParticipants,
  worldProposalMessageBodySchema,
} from './umpire.ts'

const umpireOf = (design: DesignFile) => design.rooms.find((r) => r.roomType === UMPIRE_ROOM_TYPE)

describe('the umpire room (§3 rule 18, PD8)', () => {
  it('has the White Force as its only participant entry, write', () => {
    expect(umpireParticipants(sampleDesign())).toEqual([
      { kind: 'force', id: FORCE.white, access: 'write' },
    ])
  })

  it('adds a read entry for a White Force observer assigned rooms elsewhere, so it still sees it', () => {
    const design = sampleDesign()
    const assigned: DesignFile = {
      ...design,
      rooms: design.rooms.map((r) =>
        r.id === ROOM.blueHq
          ? {
              ...r,
              participants: [
                ...r.participants,
                { kind: 'role', id: ROLE.whiteObserver, access: 'read' },
              ],
            }
          : r,
      ),
    }
    expect(umpireParticipants(assigned)).toEqual([
      { kind: 'force', id: FORCE.white, access: 'write' },
      { kind: 'role', id: ROLE.whiteObserver, access: 'read' },
    ])
    // Its own entry is not an assignment: once the other goes, so does this one.
    const withRoom = withUmpireRoom(assigned, () => ROOM.umpire)
    const unassigned = {
      ...withRoom,
      rooms: withRoom.rooms.map((r) =>
        r.id === ROOM.blueHq
          ? { ...r, participants: r.participants.filter((p) => p.id !== ROLE.whiteObserver) }
          : r,
      ),
    }
    expect(umpireParticipants(unassigned)).toEqual([
      { kind: 'force', id: FORCE.white, access: 'write' },
    ])
  })

  it('withUmpireRoom adds one when there is none, once, and re-syncs the participants', () => {
    const design = sampleDesign()
    const added = withUmpireRoom(design, () => ROOM.umpire)
    expect(umpireOf(added)).toMatchObject({
      id: ROOM.umpire,
      name: 'Umpires',
      participants: [{ kind: 'force', id: FORCE.white, access: 'write' }],
      config: {},
    })
    expect(withUmpireRoom(added, () => 'unused')).toBe(added)
    const edited = {
      ...added,
      rooms: added.rooms.map((r) =>
        r.roomType === UMPIRE_ROOM_TYPE
          ? {
              ...r,
              participants: [{ kind: 'force' as const, id: FORCE.blue, access: 'write' as const }],
            }
          : r,
      ),
    }
    const room = umpireOf(edited)
    if (room === undefined) throw new Error('no umpire room')
    expect(hasUmpireParticipants(room, edited)).toBe(false)
    expect(umpireOf(withUmpireRoom(edited, () => 'unused'))?.participants).toEqual([
      { kind: 'force', id: FORCE.white, access: 'write' },
    ])
  })

  it('the design check refuses a second umpire room, other participants and a config', () => {
    const design = demoDesign()
    expect(checkDesign(design).filter((i) => i.severity === 'error')).toEqual([])
    const at = design.rooms.findIndex((r) => r.id === ROOM.umpire)
    const umpire = design.rooms[at]
    if (umpire === undefined) throw new Error('no umpire room')
    const wrong = {
      ...design,
      rooms: design.rooms.map((r, i) =>
        i === at
          ? {
              ...r,
              participants: [{ kind: 'force' as const, id: FORCE.red, access: 'write' as const }],
              config: { freeText: false },
            }
          : r,
      ),
    }
    expect(checkDesign(wrong).map((i) => i.path)).toEqual([
      `rooms[${at}].participants`,
      `rooms[${at}].config`,
    ])
    const twice = {
      ...design,
      rooms: [
        ...design.rooms,
        { ...umpire, id: '30000000-0000-4000-8000-0000000000ee', order: 99 },
      ],
    }
    expect(checkDesign(twice).map((i) => i.path)).toEqual([
      `rooms[${design.rooms.length}].roomType`,
    ])
  })
})

describe('the proposal message (PY-8)', () => {
  const body = (summary: string) => ({
    type: 'world-proposal',
    schemaVersion: 1,
    content: { state: sampleWorldState(), summary },
  })

  it('carries a world state and a summary, and is a message body', () => {
    expect(worldProposalMessageBodySchema.safeParse(body('Tanks resupplied.')).success).toBe(true)
    expect(messageBodySchema.safeParse(body('Tanks resupplied.')).success).toBe(true)
  })

  it('refuses an empty or over-long summary and an invalid state', () => {
    expect(worldProposalMessageBodySchema.safeParse(body('  ')).success).toBe(false)
    expect(worldProposalMessageBodySchema.safeParse(body('x'.repeat(2_001))).success).toBe(false)
    const bad = body('x')
    bad.content.state = { ...bad.content.state, turn: 0 }
    expect(worldProposalMessageBodySchema.safeParse(bad).success).toBe(false)
  })
})
