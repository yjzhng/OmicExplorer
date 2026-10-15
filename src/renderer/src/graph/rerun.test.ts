/** Where a plot tile offers Re-run: only where its run computes something (enrichment, STRING). */
import { describe, expect, it } from 'vitest'

import { nothingToRerun } from './registry'
import type { NodeConfig, PlotChild } from './types'

const group = (kinds: PlotChild['kind'][], status = 'done') => ({
  kind: 'plotGroup' as const,
  status,
  config: {
    children: kinds.map((kind, i) => ({ id: `c${i}`, kind, config: {} as never }))
  } as NodeConfig
})

describe('nothingToRerun', () => {
  it('a done group of live plots has nothing to re-run', () => {
    expect(nothingToRerun(group(['volcano', 'qc', 'heatmap']))).toBe(true)
  })
  it('a group holding a computing plot (enrichment / STRING / cluster) can re-run', () => {
    expect(nothingToRerun(group(['volcano', 'enrich']))).toBe(false)
    expect(nothingToRerun(group(['string']))).toBe(false)
    expect(nothingToRerun(group(['qc', 'pca']))).toBe(false)
  })
  it('a tile not done yet always offers its run', () => {
    expect(nothingToRerun(group(['volcano'], 'idle'))).toBe(false)
    expect(nothingToRerun(group(['volcano'], 'error'))).toBe(false)
  })
  it('a lone plot tile follows its kind; an analysis step always re-runs', () => {
    expect(nothingToRerun({ kind: 'volcano', status: 'done', config: {} as NodeConfig })).toBe(true)
    expect(nothingToRerun({ kind: 'enrich', status: 'done', config: {} as NodeConfig })).toBe(false)
    expect(nothingToRerun({ kind: 'compare', status: 'done', config: {} as NodeConfig })).toBe(
      false
    )
  })
})
