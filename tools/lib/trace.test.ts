import { describe, expect, it } from 'vitest'
import {
  chartNodeId,
  chartNodes,
  expandIds,
  planWorkPackages,
  srdRequirementIds,
  trace,
} from './trace.ts'

describe('expandIds', () => {
  it('expands ranges and continues the last area', () => {
    expect([...expandIds('PLY-4–6, 40–41, ARC-9')]).toEqual([
      'PLY-4',
      'PLY-5',
      'PLY-6',
      'PLY-40',
      'PLY-41',
      'ARC-9',
    ])
  })
  it('ignores non-requirement tokens', () => {
    expect([...expandIds('ADM-37, R15, §12, D14')]).toEqual(['ADM-37'])
  })
})

describe('srdRequirementIds', () => {
  it('skips retired ids', () => {
    const srd =
      '- PLY-6 Rooms SHALL...\n- PLY-7 Retired: merged into PLY-42.\n* NFR-21 Anonymous...\n'
    expect([...srdRequirementIds(srd)]).toEqual(['PLY-6', 'NFR-21'])
  })
})

describe('planWorkPackages', () => {
  it('reads WP rows and skips phase headings', () => {
    const plan =
      '| **Phase 0** |  |  |  |\n| 0.5 | Scaffold | D18, NFR-15–16 | — |\n| 2.10 | Audit | ADM-41 | 2.3 |\n'
    expect(planWorkPackages(plan).map((wp) => [wp.id, [...wp.ids]])).toEqual([
      ['0.5', ['NFR-15', 'NFR-16']],
      ['2.10', ['ADM-41']],
    ])
  })
})

describe('chart', () => {
  it('maps WP ids to node ids', () => {
    expect(chartNodeId('0.5')).toBe('wp05')
    expect(chartNodeId('2.10')).toBe('wp210')
  })
  it('finds declared nodes only', () => {
    expect([...chartNodes('wp05["0.5 Scaffold"]\nwp05 --> wp06')]).toEqual(['wp05'])
  })
})

describe('trace', () => {
  it('reports unassigned, unknown and uncharted', () => {
    const srd = '- ADM-1 A\n- ADM-2 B\n- DOC-4 cross-cutting\n'
    const plan = '| 0.1 | X | ADM-1, ADM-9 | — |\n| 0.2 | Y | ADM-1 | — |\n'
    const readme = 'wp01["0.1 X"]'
    expect(trace(srd, plan, readme)).toEqual({
      unassigned: ['ADM-2'],
      unknown: ['ADM-9'],
      missingFromChart: ['0.2'],
    })
  })
})
