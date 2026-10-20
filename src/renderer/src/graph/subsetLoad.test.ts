/** Subset off Load data: it filters the raw import, so its output wires as Load data (only Clean
 *  data takes it), and the Clean data below reads just the kept samples (loadAbove → keep). */
import { describe, expect, it } from 'vitest'

import { sampleLevels, sheetSamples, standardize, subsetStandardize } from '../engine'
import { deriveGroups } from './groups'
import { ALL_OPS, canConnect, loadAbove, runsIn, wiredKindOf } from './registry'
import { pendingInputs } from './runGate'
import type { GraphNode, NodeKind } from './types'

const node = (id: string, kind: NodeKind, config: Record<string, unknown> = {}): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, category: 'processing', status: 'idle', config }
  }) as unknown as GraphNode
const edge = (source: string, target: string): { id: string; source: string; target: string } => ({
  id: `e-${source}-${target}`,
  source,
  target
})

describe('Subset off Load data — wiring', () => {
  const nodes = [
    node('load', 'load'),
    node('sub', 'subset', { keep: { cmpd: ['A'] } }),
    node('sub2', 'subset', { keep: { dose: ['10'] } }),
    node('std', 'standardize'),
    node('std0', 'standardize'),
    node('subStd', 'subset')
  ]
  const edges = [
    edge('load', 'sub'),
    edge('sub', 'sub2'),
    edge('sub2', 'std'),
    edge('load', 'std0'),
    edge('std0', 'subStd')
  ]
  const g = { nodes, edges }

  it('wires as Load data off Load data (through a chain of Subsets), Clean data otherwise', () => {
    expect(wiredKindOf(g, 'sub')).toBe('load')
    expect(wiredKindOf(g, 'sub2')).toBe('load')
    expect(wiredKindOf(g, 'subStd')).toBe('standardize')
    expect(wiredKindOf(g, 'std')).toBe('standardize')
    // unwired: what it has always been
    expect(wiredKindOf({ nodes: [node('x', 'subset')], edges: [] }, 'x')).toBe('standardize')
  })
  it('so only Clean data (or another Subset) takes it', () => {
    const takes = ALL_OPS.filter((k) => canConnect('load', k))
    expect(takes.sort()).toEqual(['standardize', 'subset'])
    expect(canConnect('load', 'subset')).toBe(true)
  })
  it('Clean data finds its Load data above the Subsets, with their filters', () => {
    const a = loadAbove(g, 'std')
    expect(a?.load.id).toBe('load')
    expect(a?.keep.map((f) => f.keep)).toEqual([{ dose: ['10'] }, { cmpd: ['A'] }])
    expect(loadAbove(g, 'std0')?.keep).toEqual([])
    // a Subset fed by Clean data has none: Clean data stands between
    expect(loadAbove(g, 'subStd')).toBeUndefined()
  })
  it('has no run of its own, so never holds up the Clean data below it', () => {
    expect(runsIn(g, 'sub')).toBe(false)
    expect(runsIn(g, 'sub2')).toBe(false)
    expect(runsIn(g, 'subStd')).toBe(true)
    expect(runsIn(g, 'std')).toBe(true)
    expect(runsIn(g, 'load')).toBe(false)
    // never run (status idle), yet Clean data below can run
    expect(pendingInputs('std', nodes, edges)).toEqual([])
    expect(pendingInputs('subStd', nodes, edges).map((n) => n.id)).toEqual(['std0'])
  })
  it("isn't an analysis root: the Clean data below it is", () => {
    const roots = deriveGroups(nodes, edges).map((x) => x.rootId)
    expect(roots).not.toContain('sub')
    expect(roots).not.toContain('sub2')
    expect(roots).toContain('std')
    expect(roots).toContain('subStd')
  })
})

describe('Subset off Load data — the import', () => {
  const DATA = ['id,s1,s2,s3,s4', 'g1,10,11,12,13', 'g2,5,,6,', 'g3,,,,9'].join('\n')
  const SHEET = [
    'sample,cmpd,dose,temp',
    's1,A,1,37',
    's2,A,10,42',
    's3,B,1,37',
    's4,B,10,42'
  ].join('\n')
  const run = (keep?: Record<string, string[]>[], minSamplePct = 0) =>
    standardize({
      dataText: DATA,
      dataFilename: 'data_wide.csv',
      samplesheetText: SHEET,
      customConditions: ['temp'],
      minSamplePct,
      ...(keep ? { subsets: keep.map((k) => ({ keep: k })) } : null)
    })
  const samplesOf = (r: ReturnType<typeof run>): string[] =>
    [...new Set(r.rows.map((x) => `${x.cmpd}${x.dose}`))].sort()

  it('reads only the kept samples', () => {
    expect(samplesOf(run([{ cmpd: ['A'] }]))).toEqual(['A1', 'A10'])
    expect(samplesOf(run([{ cmpd: ['A'] }, { dose: ['10'] }]))).toEqual(['A10'])
    expect(samplesOf(run([{ '@temp': ['42'] }]))).toEqual(['A10', 'B10'])
  })
  it('so the clean-up counts coverage over them alone', () => {
    // g3 is only in s4 (B·10): 25% of all four samples, 50% of the two at dose 10
    const all = new Set(run(undefined, 50).rows.map((x) => x.uniqID))
    const dose10 = new Set(run([{ dose: ['10'] }], 50).rows.map((x) => x.uniqID))
    expect(all.has('g3')).toBe(false)
    expect(dose10.has('g3')).toBe(true)
    expect(run([{ dose: ['10'] }], 50).cleanup.sampleCount).toBe(2)
  })
  it('takes a condition it narrowed to one value off the active ones', () => {
    // keeping compound A: cmpd is no longer a condition anything downstream is told apart by
    expect(run([{ cmpd: ['A'] }]).activeConditions).not.toContain('cmpd')
    expect(run([{ cmpd: ['A'] }]).activeConditions).toContain('dose')
    // without a subset it stays, as do conditions with several values still
    expect(run().activeConditions).toEqual(expect.arrayContaining(['cmpd', 'dose', '@temp']))
    // temp 42 is only at dose 10: keeping it narrows both
    const t = run([{ '@temp': ['42'] }]).activeConditions
    expect(t).not.toContain('@temp')
    expect(t).not.toContain('dose')
    expect(t).toContain('cmpd')
  })
  it('the same off Clean data', () => {
    const full = run()
    expect(subsetStandardize(full, { cmpd: ['B'] }).activeConditions).not.toContain('cmpd')
    expect(subsetStandardize(full, { cmpd: ['A', 'B'] }).activeConditions).toContain('cmpd')
  })
  it('leaves a condition that was constant before the subset as it was', () => {
    const one = standardize({
      dataText: DATA,
      dataFilename: 'data_wide.csv',
      samplesheetText: ['sample,cell,cmpd', 's1,WT,A', 's2,WT,A', 's3,WT,B', 's4,WT,B'].join('\n')
    })
    expect(one.activeConditions).toContain('cell')
    expect(subsetStandardize(one, { cmpd: ['A'] }).activeConditions).toEqual(['cell'])
  })
  it('leaves out replicates and named samples, numbers fixed as imported', () => {
    const DATA6 = ['id,s1,s2,s3,s4,s5,s6', 'g1,1,2,3,4,5,6'].join('\n')
    // no rep column: Clean data numbers them per condition, in the data's order
    const SHEET6 = ['sample,cmpd', 's1,A', 's2,A', 's3,A', 's4,B', 's5,B', 's6,B'].join('\n')
    const go = (subsets: { reps?: string[]; drop?: string[] }[]) =>
      standardize({
        dataText: DATA6,
        dataFilename: 'd_wide.csv',
        samplesheetText: SHEET6,
        subsets
      }).samples!.map((m) => `${m.sample}:${m.cmpd}${m.rep}`)
    expect(go([])).toEqual(['s1:A1', 's2:A2', 's3:A3', 's4:B1', 's5:B2', 's6:B3'])
    // replicate 3 of every condition
    expect(go([{ reps: ['1', '2'] }])).toEqual(['s1:A1', 's2:A2', 's4:B1', 's5:B2'])
    // one sample: the rest keep their numbers (s3 stays A3, not renumbered A2)
    expect(go([{ drop: ['s2'] }])).toEqual(['s1:A1', 's3:A3', 's4:B1', 's5:B2', 's6:B3'])
    // after Clean data the same, by name and by replicate
    const full = standardize({
      dataText: DATA6,
      dataFilename: 'd_wide.csv',
      samplesheetText: SHEET6
    })
    const sub = subsetStandardize(full, {}, { drop: ['s2'], reps: ['2', '3'] })
    expect(sub.samples!.map((m) => `${m.sample}:${m.cmpd}${m.rep}`)).toEqual([
      's3:A3',
      's5:B2',
      's6:B3'
    ])
    expect(sub.rows.map((r) => `${r.cmpd}${r.rep}`).sort()).toEqual(['A3', 'B2', 'B3'])
  })
  it("lists the samplesheet's values before any run, for the Subset's settings", () => {
    const levels = sampleLevels(sheetSamples(SHEET, ['temp']), ['temp'])
    expect(levels).toEqual({ cmpd: ['A', 'B'], dose: ['1', '10'], '@temp': ['37', '42'] })
  })
})
