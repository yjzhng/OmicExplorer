/**
 * Clean-up filter: `minSamplePct` drops genes identified (non-null value) in
 * fewer than N% of samples during standardization.
 */
import { describe, expect, it } from 'vitest'

import { standardize } from './ingest'

// 4 samples (s1..s4); g1 present in all 4, g2 in 2, g3 in 1.
const DATA_WIDE = ['id,s1,s2,s3,s4', 'g1,10,11,12,13', 'g2,5,,6,', 'g3,,,,9'].join('\n')
const SAMPLESHEET = ['sample,strain,cmpd', 's1,WT,A', 's2,WT,A', 's3,WT,B', 's4,WT,B'].join('\n')

function run(minSamplePct: number) {
  return standardize({
    dataText: DATA_WIDE,
    dataFilename: 'data_wide.csv',
    samplesheetText: SAMPLESHEET,
    minSamplePct
  })
}

const genes = (r: ReturnType<typeof run>) => new Set(r.rows.map((row) => row.uniqID))

describe('standardize clean-up (minSamplePct)', () => {
  it('keeps everything when the threshold is 0', () => {
    const r = run(0)
    expect(genes(r)).toEqual(new Set(['g1', 'g2', 'g3']))
    expect(r.cleanup).toEqual({ droppedGenes: 0, sampleCount: 4, minSamplePct: 0 })
  })

  it('drops genes below the presence threshold', () => {
    // g1=100%, g2=50%, g3=25%. At 50% only g3 (25%) is dropped.
    const r = run(50)
    expect(genes(r)).toEqual(new Set(['g1', 'g2']))
    expect(r.cleanup.droppedGenes).toBe(1)
    expect(r.cleanup.sampleCount).toBe(4)
  })

  it('is inclusive at the boundary (>= keeps the gene)', () => {
    // g2 sits exactly at 50%; a 50% threshold keeps it, 51% drops it.
    expect(genes(run(50)).has('g2')).toBe(true)
    expect(genes(run(51)).has('g2')).toBe(false)
  })

  it('drops all but the fully-present gene at 100%', () => {
    const r = run(100)
    expect(genes(r)).toEqual(new Set(['g1']))
    expect(r.cleanup.droppedGenes).toBe(2)
  })
})
