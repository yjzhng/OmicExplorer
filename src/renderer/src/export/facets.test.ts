import type { Edge } from '@xyflow/react'
import { describe, expect, it } from 'vitest'

import { facetViews, planPlotJobs } from './facets'
import type { ExportSpec } from './specs'
import type { GraphNode, NodeResult, StepNode } from '../graph/types'

/** Two compare rows across two cells → the volcano facets into two views. */
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
        { ...base, uniqID: 'g1', cell: 'WT' },
        { ...base, uniqID: 'g2', cell: 'clpP' }
      ],
      comparisons: ['Amk | H2O']
    }
  } as unknown as NodeResult
}

describe('facetViews', () => {
  it('returns one view per facet tuple for a faceted plot', () => {
    const views = facetViews('volcano', {}, cmpResult())
    expect(views.map((v) => v.suffix).sort()).toEqual(['cell-WT', 'cell-clpP'].sort())
    expect(views.find((v) => v.suffix === 'cell-WT')?.sel).toEqual({ cell: 'WT' })
  })

  it('skips one-sided contrast tuples (outer-join rows with nothing to pair)', () => {
    const base = {
      uniqID: 'g',
      cell: null,
      cmpd: null,
      time: null,
      cmp_cond: 'dataset',
      cmp1: 'KO',
      cmp2: 'WT',
      comparison: 'KO | WT',
      FC1: 1,
      FC2: 1
    }
    const ctr = {
      kind: 'contrast',
      displayMap: {},
      ctr: {
        rows: [
          { ...base, dose: 5 },
          { ...base, dose: 10 },
          { ...base, dose: 20, FC2: null }
        ],
        comparisons: ['KO | WT']
      }
    } as unknown as NodeResult
    expect(
      facetViews('scatter', {}, ctr)
        .map((v) => v.suffix)
        .sort()
    ).toEqual(['dose-10', 'dose-5'])
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
    hasSelection: false
  }
  const nodes: GraphNode[] = [node]
  void nodes
  const edges: Edge[] = [{ id: 'e', source: 'cmp-9', target: 'volcano-3' }]
  const results: Record<string, NodeResult> = { 'cmp-9': cmpResult() }

  it('fans a faceted plot into one job per facet', () => {
    const jobs = planPlotJobs([spec], edges, results)
    expect(jobs).toHaveLength(2)
    expect(jobs.every((j) => j.selectedOnly === false)).toBe(true)
    expect(jobs.map((j) => j.suffix).sort()).toEqual(['cell-WT', 'cell-clpP'].sort())
  })

  it('doubles each facet when genes are selected', () => {
    const jobs = planPlotJobs([{ ...spec, hasSelection: true }], edges, results)
    expect(jobs).toHaveLength(4) // 2 facets × (all-genes + selected)
    expect(jobs.filter((j) => j.selectedOnly).length).toBe(2)
  })
})
