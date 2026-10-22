import { describe, expect, it } from 'vitest'

import { clusterRowOrder } from './cluster'
import { condValue } from './compare'
import { attachLazyRows, holderTable } from './lazyRows'
import {
  buildGeneBar,
  buildHeatmap,
  buildQc,
  buildSampleCorr,
  buildStdMatrix,
  sortSamples,
  type QcGroup,
  type QcMetric,
  type SampleMeta,
  type SampleOrdering
} from './plotData'
import { sampleIndex } from './sampleIndex'
import { abundanceLabel, fromLinear, type ValueScale } from './scale'
import {
  condLabel,
  customCond,
  type ConditionKey,
  type StandardizeResult,
  type StandardRow
} from './types'
import { encodeTable } from './wire'

/** A small deterministic generator, so the rows' order is shuffled the same way every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * A Clean data table with everything the builders tell apart or skip: two cells (one inactive in
 * some tests, so QC / correlation labels merge samples), doses with a null, a time on some rows,
 * replicates with a null one, custom conditions (absent, '' and in two key orders), missing /
 * NaN / ±Infinity / absent values, imputed values, genes missing in some samples, a duplicated
 * cell (the last row wins), and the rows shuffled so first appearance isn't block order.
 */
function stdRows(seed = 7, shareExtra = false): StandardRow[] {
  const rand = rng(seed)
  const out: StandardRow[] = []
  const extras = new Map<string, Record<string, string>>()
  const extraOf = (k: string, make: () => Record<string, string>): Record<string, string> => {
    if (!shareExtra) return make()
    let e = extras.get(k)
    if (!e) extras.set(k, (e = make()))
    return e
  }
  const samples: Array<Omit<StandardRow, 'uniqID' | 'value'>> = []
  for (const cell of ['WT', 'KO'])
    for (const cmpd of ['DMSO', 'E28'])
      for (const dose of cmpd === 'DMSO' ? [null] : [1, 10])
        for (const rep of [1, 2, 3, null]) {
          if (rep === null && cell === 'KO') continue
          const i = samples.length
          const base = { cell, cmpd, dose, time: i % 3 === 0 ? 30 : null, rep }
          // custom conditions: absent, both keys (two orders), one key, '' (absent value)
          const kind = i % 5
          if (kind === 0) samples.push(base)
          else {
            const ex =
              kind === 1
                ? extraOf(`a${i}`, () => ({ strain: 'ko', batch: 'b1' }))
                : kind === 2
                  ? extraOf(`b${i}`, () => ({ batch: 'b1', strain: 'ko' }))
                  : kind === 3
                    ? extraOf(`c${i}`, () => ({ strain: 'wt' }))
                    : extraOf(`d${i}`, () => ({ strain: '' }))
            samples.push({ ...base, extra: ex })
          }
        }
  for (let g = 0; g < 60; g++)
    samples.forEach((s, si) => {
      if ((g * 7 + si) % 11 === 0) return // gene missing in this sample
      const i = out.length
      const value =
        i % 29 === 0
          ? null
          : i % 31 === 0
            ? NaN
            : i % 37 === 0
              ? Infinity
              : i % 41 === 0
                ? -5
                : i % 43 === 0
                  ? 0
                  : 50 + Math.floor(rand() * 5000)
      const row = { uniqID: `P${g}`, ...s, value } as StandardRow
      if (s.extra && !shareExtra) row.extra = { ...s.extra }
      if (i % 47 === 0) delete (row as Partial<StandardRow>).value // absent value
      if (i % 13 === 0) row.imputed = true
      else if (i % 17 === 0) row.imputed = false
      out.push(row)
    })
  // a duplicated cell, a second value for it later in the table
  out.push({ ...out[5], value: 777 })
  out.push({ ...out[9], value: null })
  // shuffle (Fisher–Yates)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const ACTIVE: ConditionKey[][] = [
  ['cmpd', 'dose', customCond('strain')],
  ['cell', 'cmpd', 'dose', 'time', customCond('strain'), customCond('batch')]
]

function std(lazy: boolean, active: ConditionKey[], seed = 7, share = false): StandardizeResult {
  const base = {
    scale: 'linear',
    samples: [],
    activeConditions: active,
    displayMap: { P3: 'geneThree' }
  } as unknown as Record<string, unknown>
  const rows = stdRows(seed, share)
  if (!lazy) return { ...base, rows } as unknown as StandardizeResult
  attachLazyRows(base, encodeTable(rows as unknown as Record<string, unknown>[], []))
  return base as unknown as StandardizeResult
}

// ── the builders' original row loops, kept here as the reference ──────────────────

function refQc(
  std: StandardizeResult,
  metric: QcMetric,
  scale?: ValueScale,
  order: SampleOrdering = { by: 'natural' }
): unknown {
  const conds = std.activeConditions
  const parts = (r: StandardRow): string[] =>
    conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
  const sampleLabel = (r: StandardRow): string => {
    const p = parts(r)
    if (r.rep != null) p.push(`r${r.rep}`)
    return p.join(' · ') || 'sample'
  }
  const condLabel = (r: StandardRow): string => parts(r).join(' · ') || 'all'
  const metas = new Map<string, SampleMeta>()
  const noteMeta = (label: string, r: StandardRow): void => {
    if (!metas.has(label))
      metas.set(label, {
        cell: r.cell,
        cmpd: r.cmpd,
        dose: r.dose,
        time: r.time,
        rep: r.rep,
        ...(r.extra ? { extra: { ...r.extra } } : null)
      })
  }
  const metaOf = (label: string): SampleMeta =>
    metas.get(label) ?? { cell: '', cmpd: '', dose: null, time: null, rep: null }
  const sortGroups = (groups: QcGroup[], perSample: boolean): QcGroup[] =>
    sortSamples(groups, order, (g) => g.meta, perSample)
  const push = (m: Map<string, number[]>, k: string, v: number): void => {
    const a = m.get(k)
    if (a) a.push(v)
    else m.set(k, [v])
  }
  if (metric === 'proteins') {
    const count = new Map<string, { measured: number; imputed: number }>()
    for (const r of std.rows)
      if (r.value != null && Number.isFinite(r.value)) {
        const k = sampleLabel(r)
        noteMeta(k, r)
        let c = count.get(k)
        if (!c) count.set(k, (c = { measured: 0, imputed: 0 }))
        if (r.imputed) c.imputed++
        else c.measured++
      }
    const groups = [...count].map(([label, c]) => ({
      label,
      values: [c.measured],
      ...(c.imputed ? { imputed: c.imputed } : null),
      meta: metaOf(label)
    }))
    sortGroups(groups, true)
    return { groups, yLabel: '# proteins', metric, summary: 'count' }
  }
  if (metric === 'intensity') {
    const map = new Map<string, number[]>()
    let min = Infinity
    let max = -Infinity
    for (const r of std.rows)
      if (r.value != null && Number.isFinite(r.value)) {
        push(map, sampleLabel(r), r.value)
        noteMeta(sampleLabel(r), r)
        if (r.value < min) min = r.value
        if (r.value > max) max = r.value
      }
    const sc: ValueScale = scale ?? (min > 0 && max / min >= 100 ? 'log10' : 'linear')
    const groups = [...map].map(([label, vals]) => ({
      label,
      values: vals.flatMap((v) => {
        const x = fromLinear(v, sc)
        return x == null ? [] : [x]
      }),
      meta: metaOf(label)
    }))
    sortGroups(groups, true)
    return { groups, yLabel: abundanceLabel(sc), metric, summary: 'median' }
  }
  const byGroup = new Map<string, Map<string, number[]>>()
  for (const r of std.rows)
    if (r.value != null && Number.isFinite(r.value)) {
      const gk = condLabel(r)
      noteMeta(gk, r)
      let gm = byGroup.get(gk)
      if (!gm) {
        gm = new Map()
        byGroup.set(gk, gm)
      }
      push(gm, r.uniqID, r.value)
    }
  const groups = [...byGroup].map(([label, geneMap]) => {
    const cvs: number[] = []
    for (const vals of geneMap.values()) {
      if (vals.length < 2) continue
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      if (mean <= 0) continue
      const sd = Math.sqrt(
        vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1)
      )
      cvs.push((100 * sd) / mean)
    }
    return { label, values: cvs, meta: metaOf(label) }
  })
  sortGroups(groups, false)
  return { groups, yLabel: 'CV %', metric, summary: 'median' }
}

function refCorr(std: StandardizeResult, opts: { cluster?: boolean; scale?: ValueScale }): unknown {
  const conds = std.activeConditions
  const sampleLabel = (r: StandardRow): string => {
    const p = conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
    if (r.rep != null) p.push(`r${r.rep}`)
    return p.join(' · ') || 'sample'
  }
  const sampleIdx = new Map<string, number>()
  const geneIdx = new Map<string, number>()
  let labels: string[] = []
  let metas: SampleMeta[] = []
  let min = Infinity
  let max = -Infinity
  for (const r of std.rows) {
    if (r.value == null || !Number.isFinite(r.value)) continue
    if (!sampleIdx.has(sampleLabel(r))) {
      sampleIdx.set(sampleLabel(r), labels.length)
      labels.push(sampleLabel(r))
      const act = new Set(conds)
      const extra = Object.fromEntries(
        Object.entries(r.extra ?? {}).filter(([k]) => act.has(customCond(k)))
      )
      metas.push({
        cell: act.has('cell') ? r.cell : '',
        cmpd: act.has('cmpd') ? r.cmpd : '',
        dose: act.has('dose') ? r.dose : null,
        time: act.has('time') ? r.time : null,
        rep: r.rep,
        ...(Object.keys(extra).length ? { extra } : null)
      })
    }
    if (!geneIdx.has(r.uniqID)) geneIdx.set(r.uniqID, geneIdx.size)
    if (r.value < min) min = r.value
    if (r.value > max) max = r.value
  }
  const S = labels.length
  const G = geneIdx.size
  const log = opts.scale ? opts.scale !== 'linear' : min > 0 && max / min >= 100
  const vecs = Array.from({ length: S }, () => new Float64Array(G).fill(NaN))
  for (const r of std.rows) {
    if (r.value == null || !Number.isFinite(r.value)) continue
    vecs[sampleIdx.get(sampleLabel(r))!][geneIdx.get(r.uniqID)!] = log
      ? Math.log10(r.value)
      : r.value
  }
  let z = Array.from({ length: S }, () => new Array<number>(S).fill(1))
  let lo = 1
  for (let i = 0; i < S; i++) {
    const a = vecs[i]
    for (let j = i + 1; j < S; j++) {
      const b = vecs[j]
      let n = 0
      let sx = 0
      let sy = 0
      let sxx = 0
      let syy = 0
      let sxy = 0
      for (let k = 0; k < G; k++) {
        const x = a[k]
        const y = b[k]
        if (Number.isNaN(x) || Number.isNaN(y)) continue
        n++
        sx += x
        sy += y
        sxx += x * x
        syy += y * y
        sxy += x * y
      }
      const cov = n * sxy - sx * sy
      const vx = n * sxx - sx * sx
      const vy = n * syy - sy * sy
      const denom = Math.sqrt(vx * vy)
      const r = n >= 2 && denom > 0 ? cov / denom : 0
      z[i][j] = r
      z[j][i] = r
      if (r < lo) lo = r
    }
  }
  if ((opts.cluster ?? true) && S > 2) {
    const order = clusterRowOrder(z)
    labels = order.map((i) => labels[i])
    metas = order.map((i) => metas[i])
    z = order.map((i) => order.map((j) => z[i][j]))
  }
  return { labels, metas, z, min: Number.isFinite(lo) ? lo : 0 }
}

/** The Clean data matrix's original pivot (PanelBody's standardizeMatrix, its columns' heat
 *  styling aside). */
function refMatrix(std: StandardizeResult): unknown {
  const dm = std.displayMap
  const conds = std.activeConditions
  const combo = (r: StandardRow): string =>
    [...conds.map((c) => String(condValue(r, c) ?? '')), `r${r.rep ?? ''}`].join('\x01')
  const label = (r: StandardRow): string => {
    const parts = conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
    if (r.rep != null) parts.push(`r${r.rep}`)
    return parts.join(' · ') || 'sample'
  }
  const lines = (r: StandardRow): Array<{ key: string; value: string }> => {
    const out = conds
      .map((c) => ({ key: condLabel(c), value: String(condValue(r, c) ?? '') }))
      .filter((l) => l.value !== '')
    if (r.rep != null) out.push({ key: 'rep', value: String(r.rep) })
    return out
  }
  const colKeyOf = new Map<string, string>()
  const samples: Array<{ key: string; label: string; lines: unknown }> = []
  const byUid = new Map<string, Record<string, unknown>>()
  const uidOrder: string[] = []
  for (const r of std.rows) {
    const c = combo(r)
    let ck = colKeyOf.get(c)
    if (!ck) {
      ck = `s${samples.length}`
      colKeyOf.set(c, ck)
      samples.push({ key: ck, label: label(r), lines: lines(r) })
    }
    let row = byUid.get(r.uniqID)
    if (!row) {
      row = { uniqID: r.uniqID, gene: dm[r.uniqID] ?? '' }
      byUid.set(r.uniqID, row)
      uidOrder.push(r.uniqID)
    }
    row[ck] = r.value
  }
  return { samples, rows: uidOrder.map((u) => byUid.get(u)!) }
}

// ── equivalence ───────────────────────────────────────────────────────────────────

/** Each case: a lazy (columnar) and a plain holder, the same rows. */
const CASES = ACTIVE.flatMap((active) =>
  [7, 11].flatMap((seed) =>
    [false, true].map((share) => ({
      name: `${active.join(',')} seed ${seed}${share ? ' shared extra' : ''}`,
      lazy: std(true, active, seed, share),
      plain: std(false, active, seed, share)
    }))
  )
)

describe('sampleIndex', () => {
  it('gives a columnar and a plain holder the same ids, reps and values', () => {
    for (const { lazy, plain } of CASES) {
      expect(holderTable(lazy)).toBeDefined()
      const a = sampleIndex(lazy)
      const b = sampleIndex(plain)
      expect(a.sample).toEqual(b.sample)
      expect(a.gene).toEqual(b.gene)
      expect(a.genes).toEqual(b.genes)
      expect(a.reps).toEqual(b.reps)
      expect(a.firstRow).toEqual(b.firstRow)
      expect(a.imputed).toEqual(b.imputed)
      expect(Array.from(a.value)).toEqual(Array.from(b.value))
      for (let r = 0; r < a.n; r++) expect(a.rawValue(r)).toEqual(b.rawValue(r))
      expect(sampleIndex(lazy)).toBe(a) // cached per table
    }
  })

  it('tells apart every sample a label could (custom key order, null rep, null dose)', () => {
    const { plain } = CASES[0]
    const ix = sampleIndex(plain)
    const key = (r: StandardRow): string =>
      JSON.stringify([
        r.cell,
        r.cmpd,
        r.dose,
        r.time,
        r.rep,
        r.extra ?? '∅',
        Object.keys(r.extra ?? {})
      ])
    const distinct = new Set(plain.rows.map(key))
    expect(ix.reps.length).toBe(distinct.size)
    plain.rows.forEach((r, i) => expect(key(ix.reps[ix.sample[i]])).toBe(key(r)))
  })

  it('gives buildQc the original answer, every metric and scale', () => {
    for (const { name, lazy, plain } of CASES)
      for (const metric of ['intensity', 'cv', 'proteins'] as const)
        for (const scale of [undefined, 'log10', 'linear'] as const) {
          const want = refQc(plain, metric, scale)
          expect(buildQc(lazy, metric, scale), name).toEqual(want)
          expect(buildQc(plain, metric, scale), name).toEqual(want)
        }
  })

  it('gives buildSampleCorr the original answer', () => {
    for (const { name, lazy, plain } of CASES)
      for (const opts of [{}, { cluster: false }, { scale: 'linear' as const }]) {
        const want = refCorr(plain, opts)
        expect(buildSampleCorr(lazy, opts), name).toEqual(want)
        expect(buildSampleCorr(plain, opts), name).toEqual(want)
      }
  })

  it('gives the heatmap the rows path answer', () => {
    for (const { name, lazy, plain } of CASES)
      for (const opts of [
        { log10: false },
        { log10: true },
        { log10: false, cluster: false, focus: ['P9', 'P2', 'nope', 'P40'] },
        { log10: true, order: { by: 'natural' as const } }
      ]) {
        const want = buildHeatmap(plain.rows, opts)
        expect(buildHeatmap(sampleIndex(lazy), opts), name).toEqual(want)
        expect(buildHeatmap(sampleIndex(plain), opts), name).toEqual(want)
      }
  })

  it('gives the gene bars the rows path answer', () => {
    for (const { name, lazy, plain } of CASES)
      for (const log of [false, true])
        for (const error of ['sd', 'sem', 'ci95'] as const)
          for (const genes of [['P3'], ['P7', 'P3', 'nope'], ['P0', 'P0']]) {
            const want = buildGeneBar(plain.rows, genes, plain.displayMap, log, error)
            expect(
              buildGeneBar(sampleIndex(lazy), genes, lazy.displayMap, log, error),
              name
            ).toEqual(want)
            expect(buildGeneBar(sampleIndex(plain), genes, plain.displayMap, log, error)).toEqual(
              want
            )
          }
  })

  it('gives the Clean data matrix the original pivot', () => {
    for (const { name, lazy, plain } of CASES) {
      const want = refMatrix(plain)
      expect(buildStdMatrix(lazy), name).toEqual(want)
      expect(buildStdMatrix(plain), name).toEqual(want)
    }
  })

  // The original matrix key joined the condition values with a \x01 (a literal control
  // character in PanelBody's source, so it read as `join('')` on screen): values whose plain
  // concatenations collide ('1'+'24' vs '12'+'4') stay two columns, on both paths.
  it('keeps samples whose concatenated values collide apart in the Clean data matrix', () => {
    const rows = [
      { uniqID: 'P1', cell: 'WT', cmpd: 'X', dose: 1, time: 24, rep: 1, value: 34 },
      { uniqID: 'P1', cell: 'WT', cmpd: 'X', dose: 12, time: 4, rep: 1, value: 124 }
    ] as unknown as StandardRow[]
    const base = () =>
      ({
        scale: 'linear',
        samples: [],
        activeConditions: ['cell', 'cmpd', 'dose', 'time'],
        displayMap: {}
      }) as unknown as Record<string, unknown>
    const plain = { ...base(), rows } as unknown as StandardizeResult
    const lazy = base()
    attachLazyRows(lazy, encodeTable(rows as unknown as Record<string, unknown>[], []))
    for (const s of [plain, lazy as unknown as StandardizeResult]) {
      const got = buildStdMatrix(s)
      expect(got).toEqual(refMatrix(plain))
      expect(got.samples.map((x) => x.label)).toEqual(['WT · X · 1 · 24 · r1', 'WT · X · 12 · 4 · r1'])
      expect(got.rows).toEqual([{ uniqID: 'P1', gene: '', s0: 34, s1: 124 }])
    }
  })
})
