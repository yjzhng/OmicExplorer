import { describe, expect, it } from 'vitest'

import {
  autoStringLevel,
  stringLevelsFromScore,
  stringVariant,
  type StringAll,
  type StringGene
} from './stringModel'

describe('STRING confidence levels', () => {
  it('lists every level at or under the best link score', () => {
    expect([...(stringLevelsFromScore(720) ?? [])].sort()).toEqual(['high', 'low', 'medium'])
    expect(stringLevelsFromScore(900)?.has('highest')).toBe(true)
  })

  it('has no level when nothing links (−1), and is unknown when not reported', () => {
    expect(stringLevelsFromScore(-1)?.size).toBe(0)
    expect(stringLevelsFromScore(undefined)).toBeNull()
  })

  it('auto picks the highest level with a network, else low', () => {
    expect(autoStringLevel(stringLevelsFromScore(720)!)).toBe('high')
    expect(autoStringLevel(new Set())).toBe('low')
  })
})

describe('stringVariant', () => {
  // Widest query: genes A..D (one STRING id each); X is a candidate interactor.
  const gene = (id: string, k: number): StringGene => ({
    uniqID: id,
    name: id,
    log2FC: 9 - k,
    stringIds: [id]
  })
  const genes = ['A', 'B', 'C', 'D'].map(gene)
  const all: StringAll = {
    nodes: ['A', 'B', 'C', 'D', 'X'].map((id) => ({ id, name: `n${id}` })),
    edges: [
      { aId: 'A', bId: 'B', score: 0.45 },
      { aId: 'C', bId: 'D', score: 0.95 },
      { aId: 'A', bId: 'X', score: 0.8 }
    ],
    // caps [2, 4] × levels low→highest
    interactors: [
      [['X'], ['X'], ['X'], []],
      [['X'], ['X'], ['X'], []]
    ],
    maxLinkScore: [800, 950]
  }
  const caps = [2, 4]

  it('cuts a query-only network to the cap and level, with its best query–query score', () => {
    const two = stringVariant(all, genes.slice(0, 2), caps, 2, 'low', false)
    expect(two.edges.map((e) => e.aId + e.bId)).toEqual(['AB'])
    expect(two.maxQueryScore).toBe(450)
    const four = stringVariant(all, genes, caps, 4, 'high', false)
    expect(four.edges.map((e) => e.aId + e.bId)).toEqual(['CD'])
    expect(four.nodes.every((n) => n.isQuery)).toBe(true)
  })

  it('adds the interactors that cap and level pull in', () => {
    const v = stringVariant(all, genes.slice(0, 2), caps, 2, 'medium', true)
    expect(v.nodes.find((n) => n.id === 'X')).toEqual({ id: 'X', name: 'nX', isQuery: false })
    expect(v.edges.map((e) => e.aId + e.bId).sort()).toEqual(['AB', 'AX'])
    expect(v.maxLinkScore).toBe(800)
    expect(
      stringVariant(all, genes, caps, 4, 'highest', true).nodes.some((n) => n.id === 'X')
    ).toBe(false)
  })
})
