import { describe, expect, it } from 'vitest'

import { runPlot } from './plotRun'
import { NODE_SPECS } from './registry'
import { fcHeatmapRunKey } from '../nodes/heatmap/runKey'
import type { HeatmapConfig, NodeConfig, NodeResult } from './types'

const compare = {
  kind: 'compare',
  cmp: { rows: [], comparisons: ['A_vs_B'] },
  displayMap: {},
  annotationMap: {},
  keggCategories: {}
} as unknown as NodeResult
const never = (): boolean => false

describe('runPlot', () => {
  it('needs its upstream step to have run', async () => {
    await expect(runPlot('volcano', {} as NodeConfig, undefined, never)).rejects.toThrow(
      /Run the step/
    )
  })

  it('a plot drawn straight from its upstream just checks it can be', async () => {
    await expect(runPlot('volcano', {} as NodeConfig, compare, never)).resolves.toEqual({
      kind: 'plot'
    })
  })

  it("fails with the requirement the upstream doesn't meet", async () => {
    // A QC plot reads Clean data, not a Compare.
    await expect(runPlot('qc', {} as NodeConfig, compare, never)).rejects.toThrow()
  })
})

describe('plot staleness (staleOn)', () => {
  it("a plot's view settings never make its run stale", () => {
    expect(NODE_SPECS.volcano.staleOn?.({} as NodeConfig, {} as NodeConfig, undefined)).toBe(false)
    expect(NODE_SPECS.enrich.staleOn?.({} as NodeConfig, {} as NodeConfig, undefined)).toBe(false)
  })

  it('STRING: a new species, or a gene cap the run did not cover, does', () => {
    const run = { kind: 'string', species: 9606, caps: [20, 40, 80], facets: {} } as NodeResult
    const cfg = (o: object): NodeConfig => ({ maxGenes: 40, ...o }) as unknown as NodeConfig
    const stale = NODE_SPECS.string.staleOn!
    expect(stale(cfg({ maxGenes: 80 }), cfg({}), run)).toBe(false)
    expect(stale(cfg({ maxGenes: 100 }), cfg({}), run)).toBe(true)
    expect(stale(cfg({ species: 10090 }), cfg({}), run)).toBe(true)
  })

  it('heatmap: a fold-change clustering setting does, its look and a Clean data one never', () => {
    const stale = NODE_SPECS.heatmap.staleOn!
    const cfg = (o: object): NodeConfig =>
      ({ capEnabled: false, maxGenes: 50, ...o }) as unknown as NodeConfig
    const fc = {
      kind: 'heatmap',
      fc: { key: fcHeatmapRunKey(cfg({}) as HeatmapConfig), overall: {} }
    } as NodeResult
    expect(stale(cfg({ palette: 'x', orient: 'landscape' }), cfg({}), fc)).toBe(false)
    expect(stale(cfg({ linkage: 'average' }), cfg({}), fc)).toBe(true)
    expect(stale(cfg({ leafOrder: 'optimal' }), cfg({}), fc)).toBe(true)
    expect(stale(cfg({ condDistance: 'pattern' }), cfg({}), fc)).toBe(true)
    expect(stale(cfg({ capEnabled: true }), cfg({}), fc)).toBe(true)
    // the run's own defaults spelled out: the same settings
    expect(stale(cfg({ linkage: 'ward', leafOrder: 'mean' }), cfg({}), fc)).toBe(false)
    const std = { kind: 'heatmap', std: { scale: 'log10', n: 3, groups: [] } } as NodeResult
    expect(stale(cfg({ linkage: 'average', sampleOrder: 'original' }), cfg({}), std)).toBe(false)
    // a result from before the heatmap clustered in its run: runs again
    expect(stale(cfg({}), cfg({}), { kind: 'plot' })).toBe(true)
  })
})
