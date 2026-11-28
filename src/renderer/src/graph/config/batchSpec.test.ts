/** Clean data's batches as the engine takes them: none until two batches hold samples. */
import { describe, expect, it } from 'vitest'

import { BATCH_COND, type StandardizeResult } from '../../engine'
import { selectorRowsOf } from '../models/contrastPair'
import { batchSpecOf, type StandardizeConfig } from './standardize'

const cfg = (over: Partial<StandardizeConfig>): StandardizeConfig => ({
  activeConditions: null,
  minSamplePct: 0,
  ...over
})

describe('batchSpecOf', () => {
  const batches = [
    { name: 'p1', samples: ['DMSO_r1', 'drug_r1'] },
    { name: 'p2', samples: ['DMSO_r2'] },
    { name: 'empty', samples: [] }
  ]

  it('maps each sample to its batch, the condition filled from becoming the batch', () => {
    expect(batchSpecOf(cfg({ batchEnabled: true, batches, batchFrom: '@plex' }))).toEqual({
      of: { DMSO_r1: 'p1', drug_r1: 'p1', DMSO_r2: 'p2' },
      condition: '@plex',
      // filled, not moved by hand: worked out from the data on each run
      live: { from: '@plex', names: {} }
    })
    // filled from the Merge inputs: no condition stops being one
    expect(batchSpecOf(cfg({ batchEnabled: true, batches, batchFrom: 'source' }))?.condition).toBe(
      undefined
    )
  })

  it('follows the data while filled and not moved by hand, keeping the names given', () => {
    const filled = [
      { name: 'first', samples: ['DMSO_r1'], value: 'p1' },
      { name: 'p2', samples: ['DMSO_r2'], value: 'p2' }
    ]
    expect(
      batchSpecOf(cfg({ batchEnabled: true, batches: filled, batchFrom: '@plex' }))?.live
    ).toEqual({ from: '@plex', names: { p1: 'first', p2: 'p2' } })
    expect(
      batchSpecOf(
        cfg({ batchEnabled: true, batches: filled, batchFrom: '@plex', batchEdited: true })
      )?.live
    ).toBeUndefined()
  })

  it('is none while off, or with fewer than two batches holding samples', () => {
    expect(batchSpecOf(cfg({ batches }))).toBeUndefined()
    expect(batchSpecOf(cfg({ batchEnabled: true, batches: batches.slice(0, 1) }))).toBeUndefined()
  })
})

describe("a Contrast's sides, picked from merged Clean data", () => {
  it('offer the batch beside the conditions', () => {
    const rows = [1, 2].map((rep) => ({
      uniqID: 'g',
      cell: '',
      cmpd: 'DMSO',
      dose: null,
      time: null,
      rep,
      value: 1
    }))
    const std = {
      rows,
      displayMap: {},
      annotationMap: {},
      keggCategories: {},
      activeConditions: ['cmpd'],
      compounds: ['DMSO'],
      cleanup: { droppedGenes: 0, sampleCount: 2, minSamplePct: 0 },
      sources: { DMSO_r1: 'run 1', DMSO_r2: 'run 2' }
    } as StandardizeResult
    const { present, rows: sel } = selectorRowsOf({ kind: 'standardize', std })
    expect(present).toContain(BATCH_COND)
    expect(sel.map((r) => r.extra?.['(batch)'])).toEqual(['run 1', 'run 2'])
  })
})
