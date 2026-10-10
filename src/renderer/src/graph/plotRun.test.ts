import { describe, expect, it } from 'vitest'

import { runPlot } from './plotRun'
import { NODE_SPECS } from './registry'
import type { NodeConfig, NodeResult } from './types'

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
})
