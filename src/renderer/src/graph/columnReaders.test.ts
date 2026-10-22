/** The readers that read a result's columns instead of its rows give what the row readers they
 *  replace gave — on a columnar (lazy) result and on a plain one. Each `old*` below is the row
 *  reader as it was, kept here as the reference. */
import { describe, expect, it } from 'vitest'

import {
  compareFeatureValue,
  contrastFeatures,
  stdFeatureValue,
  isSurfaceRow,
  selectorRowsOf,
  stdGroupsOf,
  surfaceSideRows,
  surfaceSliceCond,
  surfaceSliceCondOf,
  toContrastSide,
  type CompareFeatureCtx
} from './contrastPair'
import { curvesReplicatedOf, responseSlice, responseSliceable, responseSurfaceRows } from './types'
import { isMolar, unitOf, type CondUnits, type GraphNode, type NodeResult } from './types'
import {
  condLabel,
  condPresent,
  condsIn,
  CURVE_FC_FEATURE,
  curvesReplicated,
  facetCompareRows,
  facetDims,
  facetGroupsOf,
  holderWhere,
  numericConds,
  replicateLog2FCs,
  stdByGene,
  termless,
  type CompareResultRow,
  type ConditionKey,
  type ContrastFeatureId,
  type StandardRow
} from '../engine'
import { attachLazyRows, holderTable } from '../engine/lazyRows'
import { decodeTable, encodeTable, withoutColumns } from '../engine/wire'
import { facetViews } from '../export/facets'
import { collectTableExports } from '../export/tables'
import { stringQueryGenes, stringQueryGenesAt } from '../ui/stringModel'

type Obj = Record<string, unknown>

/** A deterministic pseudo-random stream. */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

/** A columnar holder of `rows` (its rows built when read), as a result from the worker holds them. */
function lazy<T>(rows: T[]): { rows: T[] } {
  const h = {} as { rows: T[] }
  attachLazyRows(h as Obj, encodeTable(rows as Obj[], []))
  expect(holderTable(h)).toBeDefined()
  return h
}

/** A Compare's rows of one kind: t-test (with a two-way ANOVA's term rows), curve fit (4PL curves
 *  and response fits), or surfaces — null, absent and odd values throughout. */
function compareRows(kind: 'ttest' | 'curve' | 'surface', n: number): CompareResultRow[] {
  const rand = rng(n + kind.length)
  const extras = [{ geno: 'KO' }, { geno: 'WT', temp: '37' }, { geno: '' }]
  return Array.from({ length: n }, (_, i) => {
    const pick = rand()
    const row: Obj = {
      uniqID: `G${i % 97}`,
      ...(i % 5 === 0 ? {} : { cell: i % 7 === 0 ? null : i % 11 === 0 ? '' : `C${i % 2}` }),
      cmpd: i % 13 === 0 ? undefined : `X${i % 3}`,
      dose: i % 4 === 0 ? null : (i % 3) * 5,
      time: i % 6 === 0 ? null : i % 2 ? 2 : 24,
      ...(i % 3 === 0 ? { extra: extras[i % extras.length] } : {}),
      cmp_cond: i % 8 === 0 ? 'cmpd' : 'cmpd:dose',
      comparison: `X${i % 3} | DMSO${i % 9 === 0 ? ' b' : ''}`,
      mean1: rand(),
      mean2: i % 10 === 0 ? null : 1 + rand(),
      sd1: null,
      sd2: null,
      log2FC: i % 17 === 0 ? null : i % 19 === 0 ? NaN : (rand() - 0.5) * 4,
      ...(i % 7 === 1 ? {} : { fcSE: i % 5 === 1 ? null : rand() }),
      pP: i % 23 === 0 ? null : rand() * 5,
      pQ: i % 29 === 0 ? null : rand() * 4,
      thrsh: 't',
      signf: pick > 0.4,
      effect: pick > 0.7 ? 'up' : pick > 0.4 ? 'down' : 'none'
    }
    if (kind === 'ttest' && i % 4 === 0) row.term = i % 8 === 0 ? 'cmpd' : 'cmpd × cell'
    if (kind === 'curve') {
      if (i % 3 === 0)
        row.curve = {
          axis: i % 6 === 0 ? 'dose' : 'time',
          ...(i % 9 === 0 ? { scale: 'linear' } : {}),
          pec50: rand() * 3,
          front: 1,
          back: 0.5,
          slope: 1,
          ...(i % 2 ? { x: [0, 1, 1, 2], rep: [1, 1, 2, 1] } : { x: [0, 1, 2] }),
          ...(i % 5 === 0 ? { cy: [1, 2], crep: [1, 1] } : {})
        }
      else if (i % 3 === 1)
        row.rs = {
          axis: 'time',
          ...(i % 4 === 1 ? { scale: 'linear' } : {}),
          F: 1,
          df1: 1,
          df2: 2,
          ...(i % 2 ? { cc: { f: 2, n: 5 } } : {}),
          desc: { mid: rand() * 10 }
        }
    }
    if (kind === 'surface' && i % 2 === 0)
      row.rs = {
        axis: 'surface',
        F: 1,
        df1: 1,
        df2: 1,
        ...(i % 4 === 0
          ? {
              pair: ['dose', 'time'],
              shift: { response: 'time', across: 'dose' },
              maps: [{ base: 0 }, { scale: 'linear', base: 2 }]
            }
          : {}),
        cells: [
          { dose: 1, time: 2, y: 0, fitted: rand() },
          { dose: 10, time: 2, y: 0, fitted: -rand() },
          { dose: 1, time: 24, y: 0, fitted: 2 * rand() },
          { dose: 10, time: 24, y: 0, fitted: rand() }
        ],
        surface: {
          method: i % 6 === 0 ? 'joint' : 'doseSlices',
          byTime: i % 3 === 0 ? [] : [{ at: 24, mid: 1 + rand() }],
          byDose: [{ at: 10, mid: 2 + rand() }]
        }
      }
    return row as unknown as CompareResultRow
  })
}

function stdRows(n: number): StandardRow[] {
  const rand = rng(n)
  return Array.from({ length: n }, (_, i) => {
    const row: Obj = {
      uniqID: `G${i % 89}`,
      sample: `S${i % 12}`,
      cell: i % 9 === 0 ? null : `C${i % 2}`,
      cmpd: `X${i % 3}`,
      dose: i % 4 === 0 ? null : (i % 3) * 5,
      time: i % 5 === 0 ? null : 24,
      rep: (i % 3) + 1,
      value: i % 11 === 0 ? null : i % 13 === 0 ? 0 : rand() * 1000,
      ...(i % 2 === 0 ? { extra: i % 4 === 0 ? { geno: 'KO' } : { temp: '37', geno: 'WT' } } : {})
    }
    return row as unknown as StandardRow
  })
}

function contrastRows(n: number): Obj[] {
  const rand = rng(n + 7)
  return Array.from({ length: n }, (_, i) => ({
    ...(i % 3 === 0 ? {} : { feature: i % 3 === 1 ? 'log₂FC' : 'p', featureId: 'p' }),
    uniqID: `G${i % 71}`,
    cmp_cond: 'cmpd',
    comparison: 'A vs B',
    cmp1: 'A',
    cmp2: 'B',
    cell: i % 4 === 0 ? null : 'C1',
    dose: i % 5 ? 5 : null,
    time: null,
    ...(i % 2 === 0 ? { extra: { geno: i % 4 ? 'KO' : 'WT' } } : {}),
    ...(i % 9 === 0 ? {} : { FC1: i % 7 === 0 ? null : rand() }),
    FC2: i % 6 === 0 ? null : rand(),
    FCdiff: rand(),
    signf1: rand() > 0.5,
    signf2: rand() > 0.5,
    signf: rand() > 0.5,
    effect: 'up'
  }))
}

const compareOf = (cmp: { rows: CompareResultRow[] }): NodeResult =>
  ({
    kind: 'compare',
    cmp: Object.assign(cmp, { comparisons: ['X | DMSO'], threshold: { statType: 'pQ' } }),
    displayMap: { G1: 'one', G2: 'two' }
  }) as unknown as NodeResult
const stdOf = (std: { rows: StandardRow[] }): NodeResult =>
  ({
    kind: 'standardize',
    std: Object.assign(std, { displayMap: { G1: 'one' }, activeConditions: [], compounds: [] })
  }) as unknown as NodeResult
const contrastOf = (ctr: { rows: Obj[] }): NodeResult =>
  ({
    kind: 'contrast',
    ctr: Object.assign(ctr, { comparisons: ['A vs B'] }),
    displayMap: { G1: 'one' }
  }) as unknown as NodeResult

/** Each kind's rows, held plain and columnar. */
function both<T>(rows: () => T[]): Array<{ rows: T[] }> {
  return [{ rows: rows() }, lazy(rows())]
}

// ── the row readers as they were ──

const curveAxisOf = (r: CompareResultRow): string | null =>
  r.curve?.axis ?? (r.rs && r.rs.axis !== 'surface' ? r.rs.axis : null)
const isLinearRow = (r: CompareResultRow): boolean =>
  r.curve?.scale === 'linear' || r.rs?.scale === 'linear'
function surfaceSlicing(r: CompareResultRow): { k: 0 | 1; along: string; at: string } {
  const pair = r.rs?.pair ?? ['dose', 'time']
  const k: 0 | 1 = r.rs?.shift && r.rs.shift.response === pair[1] ? 1 : 0
  return { k, along: pair[k], at: pair[1 - k] }
}

function potencyLabel(linear: boolean, axis: ConditionKey, units: CondUnits | undefined): string {
  const unit = unitOf(units, axis)
  const what = linear ? 'EC50' : 'pEC50'
  if (unit)
    return linear ? `EC50 (${unit})` : isMolar(unit) ? 'pEC50 (M)' : `pEC50 (−log₁₀ ${unit})`
  return axis === 'dose' ? what : `${what} (${condLabel(axis)})`
}

function oldFeatures(r: NodeResult, units?: CondUnits): unknown {
  if (r.kind !== 'compare') return []
  const rows = termless(r.cmp.rows)
  const axes = new Set(rows.map(curveAxisOf).filter((a) => a != null))
  if (rows.some(isSurfaceRow)) {
    const fc = { id: 'value', label: CURVE_FC_FEATURE }
    const r0 = rows.find(
      (x) =>
        isSurfaceRow(x) &&
        (surfaceSlicing(x).k === 1 ? x.rs?.surface?.byDose : x.rs?.surface?.byTime)?.length
    )
    if (!r0) return [fc]
    const { k, along } = surfaceSlicing(r0)
    const linear = r0.rs?.maps?.[k]?.scale === 'linear'
    return [fc, { id: 'pec50', label: potencyLabel(linear, along as ConditionKey, units) }]
  }
  if (rows.some((x) => x.curve || x.rs)) {
    const fc = { id: 'value', label: CURVE_FC_FEATURE }
    if (!axes.size) return [fc]
    const axis = [...axes][0] as ConditionKey
    return [fc, { id: 'pec50', label: potencyLabel(rows.some(isLinearRow), axis, units) }]
  }
  const q = (r.cmp.threshold?.statType ?? 'pQ') === 'pQ'
  return [
    { id: 'value', label: 'log₂FC' },
    { id: 'p', label: q ? '−log₁₀ q' : '−log₁₀ p' }
  ]
}

function oldStdGroups(rows: StandardRow[]): Array<{ row: StandardRow; logs: number[] }> {
  const groups = new Map<string, { row: StandardRow; logs: number[] }>()
  for (const row of rows) {
    if (row.value == null || !(row.value > 0)) continue
    const extraKey = Object.keys(row.extra ?? {})
      .sort()
      .map((k) => `${k}=${row.extra![k]}`)
      .join('¦')
    const key = `${row.uniqID}¦${row.cell ?? ''}¦${row.cmpd ?? ''}¦${row.dose ?? ''}¦${row.time ?? ''}¦${extraKey}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { row, logs: [] }))
    g.logs.push(Math.log10(row.value))
  }
  return [...groups.values()]
}

function oldSide(
  r: NodeResult,
  cleanStd: StandardRow[] | undefined,
  feature: ContrastFeatureId,
  ctx: CompareFeatureCtx,
  surfacesPerSlice: boolean
): unknown[] {
  const cmpRows = (x: Extract<NodeResult, { kind: 'compare' }>): CompareResultRow[] =>
    termless(x.cmp.rows)
  if (r.kind === 'compare' && surfacesPerSlice && cmpRows(r).some(isSurfaceRow))
    return cmpRows(r).flatMap((row) =>
      isSurfaceRow(row) ? surfaceSideRows(row, feature, ctx) : []
    )
  if (r.kind === 'compare' && feature !== 'value')
    return cmpRows(r).map((row) => ({
      uniqID: row.uniqID,
      cell: row.cell ?? null,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      ...(row.extra ? { extra: row.extra } : null),
      value: compareFeatureValue(row, feature, ctx),
      signf: row.signf,
      effect: row.effect,
      pP: row.pP,
      pQ: row.pQ
    }))
  if (r.kind === 'standardize' && feature !== 'value')
    return oldStdGroups(r.std.rows).map(({ row, logs }) => ({
      uniqID: row.uniqID,
      cell: row.cell,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      ...(row.extra ? { extra: row.extra } : null),
      value: stdFeatureValue(logs, feature)
    }))
  if (r.kind === 'compare') {
    const byGene = cleanStd ? stdByGene(cleanStd) : undefined
    return cmpRows(r).map((row) => {
      const reps = byGene ? replicateLog2FCs(row, byGene.get(row.uniqID) ?? []) : []
      return {
        uniqID: row.uniqID,
        cell: row.cell ?? null,
        cmpd: row.cmpd,
        dose: row.dose,
        time: row.time,
        ...(row.extra ? { extra: row.extra } : null),
        value: row.log2FC,
        signf: row.signf,
        effect: row.effect,
        pP: row.pP,
        pQ: row.pQ,
        se: row.fcSE ?? null,
        ...(reps.length ? { reps } : null)
      }
    })
  }
  if (r.kind === 'standardize')
    return r.std.rows.map((row) => {
      const value = row.value != null && row.value > 0 ? Math.log10(row.value) : null
      return {
        uniqID: row.uniqID,
        cell: row.cell,
        cmpd: row.cmpd,
        dose: row.dose,
        time: row.time,
        ...(row.extra ? { extra: row.extra } : null),
        value,
        ...(value != null ? { reps: [value] } : null)
      }
    })
  return []
}

function oldSelector(r: NodeResult): { rows: unknown[]; present: string[] } {
  const raw: Array<Record<string, unknown>> =
    r.kind === 'compare'
      ? termless(r.cmp.rows).map((x) => ({
          uniqID: x.uniqID,
          cell: x.cell ?? '',
          cmpd: x.cmpd,
          dose: x.dose,
          time: x.time,
          ...(x.extra ? { extra: x.extra } : null)
        }))
      : r.kind === 'standardize'
        ? r.std.rows.map((x) => ({
            uniqID: x.uniqID,
            cell: x.cell,
            cmpd: x.cmpd,
            dose: x.dose,
            time: x.time,
            ...(x.extra ? { extra: x.extra } : null)
          }))
        : []
  const rows = raw as unknown as StandardRow[]
  return { rows, present: condsIn(rows).filter((c) => condPresent(rows, c)) }
}

const KINDS = ['ttest', 'curve', 'surface'] as const
const N = 2600
const FEATURES: ContrastFeatureId[] = ['value', 'p', 'pec50']
const CTX: CompareFeatureCtx = { statType: 'pQ', doseScale: 1e-9 }

describe('contrastPair column readers', () => {
  it('contrastFeatures offers what the row reader did', () => {
    // potencies on a linear custom axis, and none on a surface without slices
    const lin = compareRows('curve', N).map((x) =>
      x.curve ? { ...x, curve: { ...x.curve, axis: '@temp' as never, scale: 'linear' } } : x
    ) as CompareResultRow[]
    const bare = compareRows('surface', N).map((x) =>
      x.rs ? { ...x, rs: { ...x.rs, surface: { byTime: [], byDose: [] } } } : x
    ) as CompareResultRow[]
    const log = compareRows('curve', N).map((x) =>
      x.curve
        ? { ...x, curve: { ...x.curve, scale: undefined } }
        : x.rs
          ? { ...x, rs: { ...x.rs, scale: undefined } }
          : x
    ) as CompareResultRow[]
    const sets = [...KINDS.map((k) => () => compareRows(k, N)), () => lin, () => bare, () => log]
    const seen = new Set<string>()
    for (const rows of sets)
      for (const units of [undefined, { dose: 'nM' }, { '@temp': '°C' }]) {
        const want = oldFeatures(compareOf({ rows: rows() }), units)
        for (const h of both(rows)) expect(contrastFeatures(compareOf(h), units)).toEqual(want)
        for (const f of want as Array<{ label: string }>) seen.add(f.label)
      }
    // every branch was taken
    for (const label of ['−log₁₀ q', 'pEC50 (M)', 'EC50 (°C)', 'EC50 (time)', 'EC50 (temp)'])
      expect(seen, [...seen].join(' / ')).toContain(label)
  })

  it('toContrastSide gives the same side rows', () => {
    for (const kind of KINDS)
      for (const f of FEATURES)
        for (const perSlice of [false, true])
          for (const clean of [false, true]) {
            const std = clean ? stdRows(3000) : undefined
            const want = oldSide(compareOf({ rows: compareRows(kind, N) }), std, f, CTX, perSlice)
            for (const h of both(() => compareRows(kind, N)))
              expect(toContrastSide(compareOf(h), std, f, CTX, perSlice)).toEqual(want)
            if (clean && f === 'value' && !perSlice)
              expect(want.some((x) => (x as Obj).reps)).toBe(true)
            if (f === 'pec50' && (kind === 'curve' || (perSlice && kind === 'surface')))
              expect(want.some((x) => Number.isFinite((x as Obj).value))).toBe(true)
          }
    for (const f of [...FEATURES, 'sd', 'cv'] as ContrastFeatureId[]) {
      const want = oldSide(stdOf({ rows: stdRows(N) }), undefined, f, CTX, false)
      for (const h of both(() => stdRows(N)))
        expect(toContrastSide(stdOf(h), undefined, f, CTX)).toEqual(want)
    }
  })

  it('stdGroupsOf groups as stdGroups did, over several tables in turn', () => {
    const a = stdRows(N)
    const b = stdRows(2100)
    const want = oldStdGroups([...a, ...b]).map(({ row, logs }) => ({
      key: [row.uniqID, row.cell, row.cmpd, row.dose, row.time, row.extra],
      logs
    }))
    for (const [ha, hb] of [
      [{ rows: a }, { rows: b }],
      [lazy(a), lazy(b)]
    ]) {
      const got = stdGroupsOf([ha, hb]).map(({ row, logs }) => ({
        key: [row.uniqID, row.cell, row.cmpd, row.dose, row.time, row.extra],
        logs
      }))
      expect(got).toEqual(want)
    }
  })

  it('selectorRowsOf and surfaceSliceCondOf read the same', () => {
    for (const kind of KINDS) {
      const want = oldSelector(compareOf({ rows: compareRows(kind, N) }))
      const cond = surfaceSliceCond(compareRows(kind, N))
      for (const h of both(() => compareRows(kind, N))) {
        expect(selectorRowsOf(compareOf(h))).toEqual(want)
        expect(surfaceSliceCondOf(h)).toBe(cond)
      }
    }
    const want = oldSelector(stdOf({ rows: stdRows(N) }))
    for (const h of both(() => stdRows(N))) expect(selectorRowsOf(stdOf(h))).toEqual(want)
  })
})

describe('plot settings column readers', () => {
  it('responseSurfaceRows and curvesReplicatedOf answer as the rows did', () => {
    for (const kind of KINDS) {
      const rows = compareRows(kind, N)
      for (const h of both(() => compareRows(kind, N))) {
        const s = responseSurfaceRows(h)
        expect(responseSlice({}, s)).toBe(responseSlice({}, rows))
        for (const show of ['line', 'surface', 'heatmap'])
          expect(responseSliceable('3d', show, s)).toBe(responseSliceable('3d', show, rows))
        expect(s.some((r) => r.rs.surface.method === 'joint')).toBe(
          rows.some((r) => r.rs?.surface?.method === 'joint')
        )
        expect(curvesReplicatedOf(h)).toBe(curvesReplicated(rows))
      }
    }
    // unreplicated curves: no dose holds two replicates
    const flat = compareRows('curve', N).map((x) =>
      x.curve ? { ...x, curve: { ...x.curve, x: [0, 1, 2], rep: undefined } } : x
    ) as CompareResultRow[]
    expect(curvesReplicated(flat)).toBe(false)
    expect(curvesReplicatedOf(lazy(flat))).toBe(false)
  })
})

describe('plot run column readers', () => {
  const numeric = numericConds()

  it("the enrichment's signed rows without curves: the rows it sent, less the curves", () => {
    for (const kind of KINDS) {
      const rows = compareRows(kind, N)
      const h = lazy(compareRows(kind, N))
      const t = holderTable(holderWhere(h, 'signed', (c) => !c.term))!
      const omit = (r: CompareResultRow): Obj => {
        const rest: Obj = { ...r }
        delete rest.curve
        delete rest.rs
        return rest
      }
      expect(decodeTable(withoutColumns(t, ['curve', 'rs']))).toEqual(termless(rows).map(omit))
      // the dropped columns' records don't ride along
      expect(JSON.stringify(withoutColumns(t, ['curve', 'rs']).nest ?? {})).not.toContain('pec50')
    }
  })

  it('facetGroupsOf and stringQueryGenesAt: the facets and genes of the rows', () => {
    for (const kind of KINDS)
      for (const keep of [undefined, (c: { term?: unknown }) => !c.term])
        for (const h of both(() => compareRows(kind, N))) {
          const rows = compareRows(kind, N)
          const signed = keep ? termless(rows) : rows
          const want = facetCompareRows(signed, facetDims(signed), numeric)
          const got = facetGroupsOf(h, numeric, keep)
          expect(got.map((g) => [g.key, g.values])).toEqual(want.map((g) => [g.key, g.values]))
          got.forEach((g, k) => {
            expect(Array.from(g.idx, (i) => rows[i])).toEqual(want[k].rows)
            expect(stringQueryGenesAt(h, g.idx, { G1: 'one' }, {}, 30)).toEqual(
              stringQueryGenes(want[k].rows, { G1: 'one' }, {}, 30)
            )
          })
        }
  })
})

describe('export column readers', () => {
  const node = (id: string, kind: string): GraphNode =>
    ({
      id,
      type: 'step',
      position: { x: 0, y: 0 },
      data: { kind, config: { analysis: 'ttest' }, status: 'idle' }
    }) as unknown as GraphNode

  /** standardizeTable / contrastTable as they were (the row cells). */
  function oldCells(rows: Obj[], cols: string[], dm: Record<string, string>): unknown[][] {
    return rows.map((r) =>
      cols.map((c) => {
        if (c === 'gene') return dm[r.uniqID as string] ?? ''
        if (c === 'signf' || c === 'signf1' || c === 'signf2') return r[c] ? 'true' : 'false'
        if (c.startsWith('@')) return (r.extra as Obj | undefined)?.[c.slice(1)] ?? null
        return r[c] ?? null
      })
    )
  }

  it('Clean data and Contrast tables: the same columns and cells', () => {
    const nodes = [node('s', 'standardize'), node('c', 'contrast')]
    const plain = collectTableExports(nodes, [], {
      s: stdOf({ rows: stdRows(N) }),
      c: contrastOf({ rows: contrastRows(N) })
    })
    const columnar = collectTableExports(nodes, [], {
      s: stdOf(lazy(stdRows(N))),
      c: contrastOf(lazy(contrastRows(N)))
    })
    expect(columnar).toEqual(plain)
    const [s, c] = plain
    expect(s.columns).toEqual([
      'uniqID',
      'gene',
      'cell',
      'cmpd',
      'dose',
      'time',
      'geno',
      'temp',
      'rep',
      'value'
    ])
    const stdCols = ['uniqID', 'gene', 'cell', 'cmpd', 'dose', 'time', '@geno', '@temp', 'rep']
    expect(s.rows).toEqual(
      oldCells(stdRows(N) as unknown as Obj[], [...stdCols, 'value'], { G1: 'one' })
    )
    expect(c.columns.slice(0, 7)).toEqual([
      'feature',
      'uniqID',
      'gene',
      'cell',
      'dose',
      'geno',
      'FC1'
    ])
    const ctrCols = ['feature', 'uniqID', 'gene', 'cell', 'dose', '@geno', 'FC1', 'FC2', 'FCdiff']
    expect(c.rows).toEqual(
      oldCells(contrastRows(N), [...ctrCols, 'signf1', 'signf2', 'signf', 'effect'], { G1: 'one' })
    )
  })

  it('facetViews: the same facet files', () => {
    for (const kind of KINDS) {
      const plain = facetViews('volcano', {}, compareOf({ rows: compareRows(kind, N) }))
      expect(facetViews('volcano', {}, compareOf(lazy(compareRows(kind, N))))).toEqual(plain)
      expect(plain.length).toBeGreaterThan(1)
    }
    const plain = facetViews('dumbbell', {}, contrastOf({ rows: contrastRows(N) }))
    expect(facetViews('dumbbell', {}, contrastOf(lazy(contrastRows(N))))).toEqual(plain)
  })
})
