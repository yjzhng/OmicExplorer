import { describe, expect, it } from 'vitest'
import {
  callSets,
  directedSets,
  distanceFor,
  intersections,
  lensArea,
  maskOf,
  measuredSets,
  quantitySets,
  regionAt,
  regionPoints,
  sampleGroups,
  sortIntersections,
  termGroups,
  vennLayout,
  type SetDef
} from './sets'
import { numericConds, type CompareResultRow, type StandardRow } from './types'
import type { EnrichData } from './plotData'

const set = (key: string, members: string): SetDef => ({
  key,
  group: key,
  label: key,
  members: members.split('')
})

const row = (
  uniqID: string,
  cmpd: string,
  dose: number,
  rep: number,
  value: number | null,
  imputed?: boolean
): StandardRow => ({
  uniqID,
  cell: 'WT',
  cmpd,
  dose,
  time: null,
  rep,
  value,
  ...(imputed ? { imputed } : null)
})

describe('intersections', () => {
  it('puts each member in exactly the intersection of the sets it is in', () => {
    const xs = intersections([set('A', 'abcd'), set('B', 'cdef'), set('C', 'dfg')])
    const of = Object.fromEntries(xs.map((x) => [x.id, x.members.sort().join('')]))
    expect(of).toEqual({ '0': 'ab', '0&1': 'c', '0&1&2': 'd', '1&2': 'f', '1': 'e', '2': 'g' })
    expect(xs.reduce((n, x) => n + x.members.length, 0)).toBe(7)
  })

  it('counts a member listed twice in one set once', () => {
    const xs = intersections([set('A', 'aab'), set('B', 'b')])
    expect(xs.find((x) => x.id === '0')!.members).toEqual(['a'])
  })

  it('orders by size, or by degree then size', () => {
    const xs = intersections([set('A', 'abcde'), set('B', 'cdefgh'), set('C', 'h')])
    expect(sortIntersections(xs, 'size').map((x) => x.id)).toEqual(['0&1', '0', '1', '1&2'])
    expect(sortIntersections(xs, 'degree').map((x) => x.id)).toEqual(['0', '1', '0&1', '1&2'])
    expect(maskOf([0, 2])).toBe(5)
  })
})

describe('Clean data sets', () => {
  const rows = [
    // DMSO r1 measures a, b; r2 measures a only (b imputed); r3 a, c
    row('a', 'DMSO', 0, 1, 10),
    row('b', 'DMSO', 0, 1, 5),
    row('c', 'DMSO', 0, 1, null),
    row('a', 'DMSO', 0, 2, 11),
    row('b', 'DMSO', 0, 2, 3, true),
    row('c', 'DMSO', 0, 2, null),
    row('a', 'DMSO', 0, 3, 9),
    row('b', 'DMSO', 0, 3, 0),
    row('c', 'DMSO', 0, 3, 7),
    // DrugA r1 measures c only
    row('a', 'DrugA', 10, 1, null),
    row('b', 'DrugA', 10, 1, null),
    row('c', 'DrugA', 10, 1, 4)
  ]
  const m = measuredSets({ rows })
  const numeric = numericConds()

  it('reads a sample’s measured genes: a non-zero value, not imputed', () => {
    const per = sampleGroups(m.samples, 'sample', numeric)
    expect(per.map((g) => g.label)).toEqual([
      'WT · DMSO · 0 · r1',
      'WT · DMSO · 0 · r2',
      'WT · DMSO · 0 · r3',
      'WT · DrugA · 10 · r1'
    ])
    expect(quantitySets(m, per, 1).map((s) => s.members.join(''))).toEqual(['ab', 'a', 'ac', 'c'])
  })

  it('groups samples by condition, a gene in when measured in enough of them', () => {
    const groups = sampleGroups(m.samples, ['cmpd'], numeric)
    expect(groups.map((g) => [g.label, g.samples.length])).toEqual([
      ['DMSO', 3],
      ['DrugA', 1]
    ])
    // any one replicate
    expect(quantitySets(m, groups, 0).map((s) => s.members.join(''))).toEqual(['abc', 'c'])
    // 2 of 3
    expect(quantitySets(m, groups, 0.5).map((s) => s.members.join(''))).toEqual(['a', 'c'])
    // every replicate
    expect(quantitySets(m, groups, 1).map((s) => s.members.join(''))).toEqual(['a', 'c'])
  })

  it('keeps one group of every sample when grouped by nothing', () => {
    const groups = sampleGroups(m.samples, [], numeric)
    expect(groups).toEqual([{ key: 'all', label: 'all samples', samples: [0, 1, 2, 3] }])
  })
})

describe('Compare sets', () => {
  const cmp = (
    uniqID: string,
    time: number,
    effect: 'up' | 'down' | 'none',
    signf = effect !== 'none'
  ): CompareResultRow =>
    ({
      uniqID,
      cmpd: 'DrugA',
      dose: null,
      time,
      cmp_cond: 'cmpd',
      comparison: 'DrugA | DMSO',
      mean1: null,
      mean2: null,
      sd1: null,
      sd2: null,
      log2FC: null,
      pP: null,
      pQ: null,
      thrsh: '',
      signf,
      effect
    }) as CompareResultRow
  const rows = [
    cmp('a', 6, 'up'),
    cmp('b', 6, 'down'),
    cmp('c', 6, 'none'),
    cmp('a', 24, 'up'),
    cmp('c', 24, 'up'),
    cmp('b', 24, 'up', false)
  ]
  const groups = callSets({ rows }, numericConds())

  it('reads each facet’s significant genes each way', () => {
    expect(groups.map((g) => [g.label, g.up.join(''), g.down.join('')])).toEqual([
      ['time 6', 'a', 'b'],
      ['time 24', 'ac', '']
    ])
  })

  it('makes a set per facet for a direction, or two when split', () => {
    expect(directedSets(groups, 'any').map((s) => [s.label, s.members.join('')])).toEqual([
      ['time 6', 'ab'],
      ['time 24', 'ac']
    ])
    const split = directedSets(groups, 'split')
    expect(split.map((s) => s.label)).toEqual(['time 6 ↑', 'time 6 ↓', 'time 24 ↑', 'time 24 ↓'])
    // picked by the facet, whichever way
    expect(split.map((s) => s.group)).toEqual([
      groups[0].key,
      groups[0].key,
      groups[1].key,
      groups[1].key
    ])
  })

  it('names a single facet by its comparison', () => {
    const one = callSets(
      { rows: rows.slice(0, 3).map((r) => ({ ...r, time: null })) },
      numericConds()
    )
    expect(one.map((g) => [g.key, g.label])).toEqual([['all', 'DrugA | DMSO']])
  })

  it('reads each facet’s significant terms from an enrichment run', () => {
    const term = (t: string, pAdjust: number) => ({ term: t, pAdjust }) as EnrichData['up'][number]
    const e = (up: EnrichData['up'], down: EnrichData['down'] = []) =>
      ({ up, down }) as unknown as EnrichData
    const facets = {
      [groups[0].key]: { 'ora|go': e([term('ribosome', 0.01), term('glycolysis', 0.2)]) },
      [groups[1].key]: { 'ora|go': e([term('ribosome', 0.001)], [term('flagellum', 0.04)]) }
    }
    const ts = termGroups(groups, facets, 'ora|go', 0.05)
    expect(ts.map((g) => [g.up, g.down])).toEqual([
      [['ribosome'], []],
      [['ribosome'], ['flagellum']]
    ])
  })
})

describe('proportional Venn', () => {
  it('solves the distance for a shared area', () => {
    for (const [r1, r2, share] of [
      [1, 1, 0.3],
      [2, 1, 0.9],
      [1.5, 0.5, 0.1]
    ]) {
      const want = share * Math.PI * Math.min(r1, r2) ** 2
      expect(lensArea(r1, r2, distanceFor(r1, r2, want))).toBeCloseTo(want, 6)
    }
    expect(distanceFor(2, 1, Math.PI)).toBe(1) // all shared: inside, touching
    expect(distanceFor(1, 1, 0)).toBeGreaterThan(2) // none: apart
  })

  it('draws two sets exactly to scale', () => {
    const sets = [set('A', 'abcdefgh'), set('B', 'ghij')]
    const [a, b] = vennLayout(sets)
    expect(Math.PI * a.r ** 2).toBeCloseTo(8)
    expect(Math.PI * b.r ** 2).toBeCloseTo(4)
    expect(lensArea(a.r, b.r, Math.hypot(a.x - b.x, a.y - b.y))).toBeCloseTo(2, 6)
  })

  it('matches every pair of three sets where a triangle allows', () => {
    const sets = [set('A', 'abcdefghij'), set('B', 'hijklmnop'), set('C', 'ajkqrs')]
    const cs = vennLayout(sets)
    const pair = (i: number, j: number) =>
      lensArea(cs[i].r, cs[j].r, Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y))
    expect(pair(0, 1)).toBeCloseTo(3, 4) // h i j
    expect(pair(0, 2)).toBeCloseTo(2, 4) // a j
    expect(pair(1, 2)).toBeCloseTo(2, 4) // j k
  })

  it('places each region’s label inside that region', () => {
    const cs = vennLayout([set('A', 'abcdefghij'), set('B', 'hijklmnop'), set('C', 'ajkqrs')])
    const pts = regionPoints(cs)
    for (const [mask, p] of pts) expect(regionAt(cs, p.x, p.y)).toBe(mask)
    // A only, B only, C only, A&B, A&C, B&C are all drawn
    for (const m of [1, 2, 4, 3, 5, 6]) expect(pts.has(m)).toBe(true)
  })
})
