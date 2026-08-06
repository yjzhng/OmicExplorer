import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { facetViews, planPlotJobs } from './facets'
import type { ExportSpec } from './specs'
import type { GraphNode, NodeResult, StepNode } from '../graph/types'

/** Two compare rows across two strains → the volcano facets into two views. */
function cmpResult(): NodeResult {
  const base = {
    cmpd: 'Amk',
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    comparison: 'Amk | H2O',
    mean1: 0,
    mean2: 0,
    sd1: 0,
    sd2: 0,
    log2FC: 0,
    pP: 0,
    pQ: 0,
    thrsh: '',
    signf: false,
    effect: 'none' as const
  }
  return {
    kind: 'compare',
    displayMap: {},
    cmp: {
      rows: [
        { ...base, uniqID: 'g1', strain: 'WT' },
        { ...base, uniqID: 'g2', strain: 'clpP' }
      ],
      comparisons: ['Amk | H2O']
    }
  } as unknown as NodeResult
}

describe('facetViews', () => {
  it('returns one view per facet tuple for a faceted plot', () => {
    const views = facetViews('volcano', {}, cmpResult())
    expect(views.map((v) => v.suffix).sort()).toEqual(['strain-WT', 'strain-clpP'].sort())
    expect(views.find((v) => v.suffix === 'strain-WT')?.sel).toEqual({ strain: 'WT' })
  })

  it('returns a single unlabelled view for non-faceted kinds', () => {
    expect(facetViews('heatmap', {}, cmpResult())).toEqual([{ sel: {}, suffix: '' }])
  })

  it('returns a single view when there is no upstream result', () => {
    expect(facetViews('volcano', {}, undefined)).toEqual([{ sel: {}, suffix: '' }])
  })
})

describe('planPlotJobs', () => {
  const node: StepNode = {
    id: 'volcano-3',
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind: 'volcano', config: {} as never, status: 'idle' }
  }
  const spec: ExportSpec = {
    node,
    rootId: 'cmp-9',
    analysis: 'Amk | H2O',
    plot: 'Volcano',
    key: 'volcano-3',
    hasGoi: false
  }
  const nodes: GraphNode[] = [node]
  void nodes
  const edges: Edge[] = [{ id: 'e', source: 'cmp-9', target: 'volcano-3' }]
  const results: Record<string, NodeResult> = { 'cmp-9': cmpResult() }

  it('fans a faceted plot into one job per facet', () => {
    const jobs = planPlotJobs([spec], edges, results)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => j.goiOnly === false)).toBe(true)
    expect(jobs.map((j) => j.suffix).sort()).toEqual(['strain-WT', 'strain-clpP'].sort())
  })

  it('doubles each facet when the plot has GOI focus genes', () => {
    const jobs = planPlotJobs([{ ...spec, hasGoi: true }], edges, results)
    expect(jobs).toHaveLength(4) // 2 facets × (all-genes + GOI)
    expect(jobs.filter((j) => j.goiOnly).length).toBe(2)
  })
})
