/** Batch effects: correction in Clean data (every condition protected) and the blocked t-test. */
import { describe, expect, it } from 'vitest'

import { BATCH_COND, blockedTTest, correctBatches, resolveBatches, withBatchCond } from './batch'
import { combineStandardize } from './combine'
import { runCompare } from './direct'
import { recleanStandardized } from './ingest'
import { sampleLabel } from './sampleLabel'
import { studentTTwoSided, welchTTest } from './stats'
import { condsIn } from './types'
import type { ConditionKey, StandardizeResult, StandardRow } from './types'

const row = (uniqID: string, cmpd: string, rep: number, log2: number | null): StandardRow => ({
  uniqID,
  cell: '',
  cmpd,
  dose: null,
  time: null,
  rep,
  value: log2 == null ? null : 2 ** log2
})
const log2Of = (rows: StandardRow[], uid: string, cmpd: string, rep: number): number =>
  Math.log2(rows.find((r) => r.uniqID === uid && r.cmpd === cmpd && r.rep === rep)!.value!)

/** Two batches (reps 1–2 in A, 3–4 in B), each a DMSO control and a drug; batch B reads +2 (log₂)
 *  higher, the drug +1 over DMSO in both. */
function design(): { rows: StandardRow[]; of: Record<string, string> } {
  const rows: StandardRow[] = []
  for (const g of ['g1', 'g2'])
    for (const rep of [1, 2, 3, 4]) {
      const batch = rep > 2 ? 2 : 0
      const noise = rep % 2 ? 0.05 : -0.05
      rows.push(row(g, 'DMSO', rep, 10 + batch + noise))
      rows.push(row(g, 'drug', rep, 11 + batch + noise))
    }
  const of: Record<string, string> = {}
  for (const r of rows) of[sampleLabel(r)] = r.rep! > 2 ? 'B' : 'A'
  return { rows, of }
}

describe('correctBatches', () => {
  it("removes each batch's shift and keeps the condition effect and the overall level", () => {
    const { rows, of } = design()
    const { rows: out, summary } = correctBatches(rows, { of }, ['cmpd'])
    expect(summary).toEqual({ batches: 2, samples: 8, genes: 2, skipped: 0 })
    // batch B's +2 is gone: rep 1 and rep 3 read alike; the drug is still +1
    expect(log2Of(out, 'g1', 'DMSO', 3)).toBeCloseTo(log2Of(out, 'g1', 'DMSO', 1), 9)
    expect(log2Of(out, 'g1', 'drug', 3) - log2Of(out, 'g1', 'DMSO', 3)).toBeCloseTo(1, 9)
    // sum-to-zero: each batch moved by half the gap, so the mean level is unchanged
    expect(log2Of(out, 'g1', 'DMSO', 1)).toBeCloseTo(11.05, 9)
  })

  it('refuses a batch confounded with the conditions — every DMSO in A, every drug in B', () => {
    const rows = [row('g', 'DMSO', 1, 10), row('g', 'DMSO', 2, 10), row('g', 'drug', 3, 13)]
    const of = { DMSO_r1: 'A', DMSO_r2: 'A', drug_r3: 'B' }
    expect(() => correctBatches(rows, { of }, ['cmpd'])).toThrow(/can't be told apart from cmpd/i)
  })

  it('leaves a gene its missing values disconnect, and samples in no batch, as they are', () => {
    const { rows, of } = design()
    // g2 measured only as DMSO in A and drug in B: confounded for that gene alone
    const holes = rows.map((r) =>
      r.uniqID === 'g2' && ((r.rep! <= 2 && r.cmpd === 'drug') || (r.rep! > 2 && r.cmpd === 'DMSO'))
        ? { ...r, value: null }
        : r
    )
    const { rows: out, summary } = correctBatches(holes, { of }, ['cmpd'])
    expect(summary.skipped).toBe(1)
    expect(log2Of(out, 'g2', 'drug', 3)).toBeCloseTo(log2Of(holes, 'g2', 'drug', 3), 12)
    // rep 4 in no batch: untouched
    const partial = { ...of }
    delete partial.DMSO_r4
    const kept = correctBatches(rows, { of: partial }, ['cmpd']).rows
    expect(log2Of(kept, 'g1', 'DMSO', 4)).toBe(log2Of(rows, 'g1', 'DMSO', 4))
  })

  it('treats the condition the batches came from as the batch, not a protected condition', () => {
    // plex as a condition: protecting it would confound it with itself
    const rows = design().rows.map((r) => ({ ...r, extra: { plex: r.rep! > 2 ? 'p2' : 'p1' } }))
    const of: Record<string, string> = {}
    for (const r of rows) of[sampleLabel(r)] = r.extra!.plex
    const conds = ['cmpd', '@plex'] as const
    expect(() => correctBatches(rows, { of }, [...conds])).toThrow()
    const { summary } = correctBatches(rows, { of, condition: '@plex' }, [...conds])
    expect(summary.genes).toBe(2)
  })
})

describe('batches that follow the data', () => {
  it('works a live spec out from the data — a renamed value keeps its name', () => {
    const rows = design().rows.map((r) => ({ ...r, extra: { plex: r.rep! > 2 ? 'p2' : 'p1' } }))
    const live = resolveBatches(
      { of: { stale: 'p1' }, condition: '@plex', live: { from: '@plex', names: { p1: 'first' } } },
      rows
    )
    expect(live.of).toMatchObject({ DMSO_p1_r1: 'first', DMSO_p2_r3: 'p2' })
    expect(live.of.stale).toBeUndefined()
    // the Merge inputs, from the result's sources
    const src = resolveBatches({ of: {}, live: { from: 'source', names: {} } }, rows, {
      DMSO_p1_r1: 'run 1'
    })
    expect(src.of).toEqual({ DMSO_p1_r1: 'run 1' })
    // moved by hand: as it is
    const hand = { of: { DMSO_r1: 'A' } }
    expect(resolveBatches(hand, rows)).toBe(hand)
  })

  it('says so when a batch has none of its samples in the data any more', () => {
    const { rows, of } = design()
    // one sample gone: the rest of its batch still corrects
    expect(() => correctBatches(rows, { of: { ...of, gone_r9: 'A' } }, ['cmpd'])).not.toThrow()
    // a whole batch gone: said
    expect(() => correctBatches(rows, { of: { ...of, gone_r9: 'C' } }, ['cmpd'])).toThrow(
      /“C”: none of the samples listed is in the data/
    )
  })
})

describe('blockedTTest', () => {
  // one gene: batch A ctrl 1.0, 1.2 / trt 3.0, 3.1; batch B ctrl 5.0, 5.2 / trt 7.0, 7.3, 6.1
  const num = [3.0, 3.1, 7.0, 7.3, 6.1].map((value, i) => ({
    uniqID: 'g',
    value,
    batch: i < 2 ? 'A' : 'B'
  }))
  const den = [1.0, 1.2, 5.0, 5.2].map((value, i) => ({
    uniqID: 'g',
    value,
    batch: i < 2 ? 'A' : 'B'
  }))
  const welch = welchTTest(num, den, true)

  it('is the least-squares fit of group + batch: its coefficient, SE and df', () => {
    // checked against an independent OLS (y ~ 1 + group + batch): β 1.81364, SE 0.25511, df 6
    const [b] = blockedTTest(num, den, true, welch)
    expect(b.log2FC).toBeCloseTo(1.8136363636, 8)
    expect(b.fcSE).toBeCloseTo(0.2551130036, 8)
    expect(b.pVal).toBeCloseTo(studentTTwoSided(7.109149034870486, 6), 10)
    // the batch's spread no longer counts as noise
    expect(b.pVal).toBeLessThan(welch[0].pVal)
  })

  it('takes the Welch result where there is one batch, and no p where groups share none', () => {
    const one = num.map((x) => ({ ...x, batch: 'A' }))
    const oneDen = den.map((x) => ({ ...x, batch: 'A' }))
    expect(blockedTTest(one, oneDen, true, welch)[0]).toBe(welch[0])
    const split = blockedTTest(
      num.map((x) => ({ ...x, batch: 'B' })),
      oneDen,
      true,
      welch
    )[0]
    expect(split.pVal).toBeNaN()
  })
})

describe('batches through Clean data and Compare', () => {
  it('a Clean data re-run corrects, carries the batches, and drops the condition they came from', () => {
    const rows = design().rows.map((r) => ({ ...r, extra: { plex: r.rep! > 2 ? 'p2' : 'p1' } }))
    const of: Record<string, string> = {}
    for (const r of rows) of[sampleLabel(r)] = r.extra!.plex
    const prev = {
      rows,
      displayMap: {},
      annotationMap: {},
      keggCategories: {},
      activeConditions: ['cmpd', '@plex'],
      compounds: ['DMSO', 'drug'],
      cleanup: { droppedGenes: 0, sampleCount: 8, minSamplePct: 0 },
      inputScale: 'linear'
    } as unknown as StandardizeResult
    const out = recleanStandardized({ std: prev, batch: { of, condition: '@plex' } })
    expect(out.activeConditions).toEqual(['cmpd'])
    expect(out.batches).toBe(of)
    expect(out.batchCorrection?.genes).toBe(2)
    expect(log2Of(out.rows, 'g1', 'DMSO', 3)).toBeCloseTo(log2Of(out.rows, 'g1', 'DMSO', 1), 9)
    // a step below that defines none carries them on (and not this one's summary)
    const below = recleanStandardized({ std: out })
    expect(below.batches).toBe(of)
    expect(below.batchCorrection).toBeUndefined()
  })

  it("a Compare blocks on the data's batches: the shift is no longer noise", () => {
    // uncorrected, batch B +2: the drug's +1 is buried in the batch spread unless blocked
    const { rows, of } = design()
    const input = {
      rows,
      num: { cmpd: ['drug'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd'] as ConditionKey[],
      numericConditions: []
    }
    const plain = runCompare(input).rows.find((r) => r.uniqID === 'g1')!
    const blocked = runCompare({ ...input, batches: of }).rows.find((r) => r.uniqID === 'g1')!
    expect(blocked.log2FC).toBeCloseTo(1, 9)
    expect(blocked.pP!).toBeGreaterThan(plain.pP!)
  })

  it('a Merge records which input each sample came from', () => {
    const { rows } = design()
    const a = { rows: rows.filter((r) => r.rep! <= 2) } as unknown as StandardizeResult
    const b = { rows: rows.filter((r) => r.rep! > 2) } as unknown as StandardizeResult
    const base = {
      displayMap: {},
      annotationMap: {},
      keggCategories: {},
      activeConditions: ['cmpd'],
      compounds: [],
      cleanup: { droppedGenes: 0, sampleCount: 4, minSamplePct: 0 }
    }
    const m = combineStandardize(
      [
        { ...base, ...a },
        { ...base, ...b }
      ],
      ['run 1', 'run 2']
    )
    expect(m.sources).toEqual({
      DMSO_r1: 'run 1',
      drug_r1: 'run 1',
      DMSO_r2: 'run 1',
      drug_r2: 'run 1',
      DMSO_r3: 'run 2',
      drug_r3: 'run 2',
      DMSO_r4: 'run 2',
      drug_r4: 'run 2'
    })
    expect(m.batches).toBeUndefined()
  })
})

describe('the batch as a condition, for a Contrast and a per-batch Compare', () => {
  const merged = (): StandardizeResult => {
    const { rows } = design()
    const sources: Record<string, string> = {}
    for (const r of rows) sources[sampleLabel(r)] = r.rep! > 2 ? 'run 2' : 'run 1'
    return {
      rows,
      displayMap: {},
      annotationMap: {},
      keggCategories: {},
      activeConditions: ['cmpd'],
      compounds: ['DMSO', 'drug'],
      cleanup: { droppedGenes: 0, sampleCount: 8, minSamplePct: 0 },
      sources
    }
  }

  it('tags each row with its batch — the defined batches first, else the Merge inputs', () => {
    const std = merged()
    const tagged = withBatchCond(std)
    expect(condsIn(tagged.rows)).toContain(BATCH_COND)
    expect(tagged.rows.map((r) => r.extra?.['(batch)'])).toEqual(
      std.rows.map((r) => (r.rep! > 2 ? 'run 2' : 'run 1'))
    )
    expect(withBatchCond(std)).toBe(tagged) // cached
    const defined = { ...std, batches: { DMSO_r1: 'A' } }
    expect(withBatchCond(defined).rows.filter((r) => r.extra?.['(batch)'] === 'A')).toHaveLength(2)
    const none = { ...std, sources: undefined }
    expect(withBatchCond(none)).toBe(none)
  })

  it('a Compare per batch: one fold change per batch, each row carrying its batch', () => {
    const tagged = withBatchCond(merged())
    const cmp = runCompare({
      rows: tagged.rows,
      num: { cmpd: ['drug'] },
      den: { cmpd: ['DMSO'] },
      match: [BATCH_COND],
      activeConditions: ['cmpd', BATCH_COND],
      numericConditions: []
    })
    const g1 = cmp.rows.filter((r) => r.uniqID === 'g1')
    expect(g1.map((r) => r.extra?.['(batch)']).sort()).toEqual(['run 1', 'run 2'])
    // within one batch there's no shift: each batch's drug | DMSO is the +1
    for (const r of g1) expect(r.log2FC).toBeCloseTo(1, 9)
  })
})
