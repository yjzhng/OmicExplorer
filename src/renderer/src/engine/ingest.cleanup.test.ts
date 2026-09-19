/**
 * Clean-up filter: `minSamplePct` drops genes identified (non-null value) in
 * fewer than N% of samples during standardization.
 */
import { describe, expect, it } from 'vitest'

import { standardize } from './ingest'

// 4 samples (s1..s4); g1 present in all 4, g2 in 2, g3 in 1.
const DATA_WIDE = ['id,s1,s2,s3,s4', 'g1,10,11,12,13', 'g2,5,,6,', 'g3,,,,9'].join('\n')
const SAMPLESHEET = ['sample,cell,cmpd', 's1,WT,A', 's2,WT,A', 's3,WT,B', 's4,WT,B'].join('\n')

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

describe('samplesheet `strain` alias (pre-rename column name)', () => {
  it('reads a `strain` column as `cell`', () => {
    const ss = ['sample,strain,cmpd', 's1,WT,A', 's2,mut,A', 's3,WT,B', 's4,mut,B'].join('\n')
    const r = standardize({
      dataText: DATA_WIDE,
      dataFilename: 'data_wide.csv',
      samplesheetText: ss
    })
    expect(new Set(r.rows.map((row) => row.cell))).toEqual(new Set(['WT', 'mut']))
    expect(r.activeConditions).toContain('cell')
  })

  it('prefers `cell` when both columns are present', () => {
    const ss = ['sample,cell,strain,cmpd', 's1,K,WT,A', 's2,K,WT,A', 's3,K,WT,B', 's4,K,WT,B'].join(
      '\n'
    )
    const r = standardize({
      dataText: DATA_WIDE,
      dataFilename: 'data_wide.csv',
      samplesheetText: ss
    })
    expect(r.rows.every((row) => row.cell === 'K')).toBe(true)
  })
})

describe('grouped clean-up (minSamplePctBy)', () => {
  // 2 cells × 2 doses, one sample each: WT@1 s1, WT@2 s2, KO@1 s3, KO@2 s4.
  const SS = ['sample,cell,dose', 's1,WT,1', 's2,WT,2', 's3,KO,1', 's4,KO,2'].join('\n')
  // gA everywhere; gB only in WT; gC only in s1 (WT@1).
  const DATA = ['id,s1,s2,s3,s4', 'gA,1,1,1,1', 'gB,1,1,,', 'gC,1,,,'].join('\n')
  const run = (by: ('cell' | 'cmpd' | 'dose' | 'time')[]) =>
    standardize({
      dataText: DATA,
      dataFilename: 'd_wide.csv',
      samplesheetText: SS,
      minSamplePct: 100,
      minSamplePctBy: by
    })
  const valuesOf = (r: ReturnType<typeof run>, g: string) =>
    r.rows.filter((x) => x.uniqID === g && x.value != null).map((x) => `${x.cell}@${x.dose}`)

  it('pooled (no grouping) drops any gene below the threshold outright', () => {
    const r = run([])
    expect(genes(r)).toEqual(new Set(['gA']))
    expect(r.cleanup.by).toBeUndefined()
  })

  it('per cell keeps a gene that clears the bar in any one cell', () => {
    const r = run(['cell'])
    expect(genes(r)).toEqual(new Set(['gA', 'gB'])) // gC: 50% in WT, 0% in KO → fails everywhere
    expect(r.cleanup.by).toEqual(['cell'])
  })

  it('a kept gene keeps its values in the cells where it fell short (may be below LoD there)', () => {
    // gB clears in WT only; at 50% gC clears in WT too (1 of 2). Neither loses rows.
    const r = standardize({
      dataText: DATA,
      dataFilename: 'd_wide.csv',
      samplesheetText: SS,
      minSamplePct: 50,
      minSamplePctBy: ['cell']
    })
    expect(genes(r)).toEqual(new Set(['gA', 'gB', 'gC']))
    expect(r.rows.filter((x) => x.uniqID === 'gB')).toHaveLength(4) // all 4 samples, 2 null
    expect(valuesOf(r, 'gB').sort()).toEqual(['WT@1', 'WT@2'])
  })

  it('per cell × dose measures within each tuple', () => {
    const r = run(['cell', 'dose'])
    // Every group is a single sample, so a gene is kept if it has a value anywhere.
    expect(genes(r)).toEqual(new Set(['gA', 'gB', 'gC']))
    expect(valuesOf(r, 'gC')).toEqual(['WT@1'])
    expect(r.cleanup.by).toEqual(['cell', 'dose'])
  })
})
