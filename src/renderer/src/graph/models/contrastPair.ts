/** Contrast-input helpers shared by the run path (store), the selector window, and the canvas. */
import {
  condLabel,
  condValue,
  condPresent,
  condsIn,
  CURVE_FC_FEATURE,
  contextIndices,
  contextOf,
  holderWhereNested,
  nestedCol,
  nestedPresent,
  replicateLog2FCs,
  rowView,
  someNested,
  stdByGene,
  termless,
  withBatchCond,
  type CompareResultRow,
  type CondSelector,
  type ConditionKey,
  type ContrastFeatureId,
  type ContrastSideRow,
  type StandardRow,
  type ThresholdConfig,
  type ValueCutoffs,
  valueUnitOf
} from '../../engine'
import { rowCount } from '../../engine/columns/lazyRows'
import {
  compareFeatureValue,
  isSurfaceRow,
  stdFeatureValue,
  stdGroupsOf,
  surfaceSideRows,
  surfaceSlicing,
  type CompareFeatureCtx
} from '../../engine/compare/contrastSides'
// (the side-row helpers live in the engine, where the run builds its sides: re-exported here for
// the selector window and the canvas)
export {
  compareFeatureValue,
  isSurfaceRow,
  stdFeatureValue,
  stdGroupsOf,
  surfaceSideRows,
  surfaceSliceCond,
  surfaceSlicing,
  type CompareFeatureCtx
} from '../../engine/compare/contrastSides'
import { type CondUnits, isMolar, unitOf } from '../config/units'
import { type ContrastConfig, resolveContrastSource } from '../config/contrast'
import type { NodeResult } from '../types'

/** One feature a Contrast can compare (see ContrastFeatureId) and its name on the switcher. */
export interface ContrastFeature {
  id: ContrastFeatureId
  label: string
}

/** A curve fit's potency feature, named with its unit: EC50 in the axis's unit on a linear axis;
 *  pEC50 on a log one — −log₁₀ molar where the unit is molar (as compareFeatureValue reads it),
 *  else of the unit. Without a unit, named by its axis (unless that's dose). */
function potencyLabel(linear: boolean, axis: ConditionKey, units: CondUnits | undefined): string {
  const unit = unitOf(units, axis)
  const what = linear ? 'EC50' : 'pEC50'
  if (unit)
    return linear ? `EC50 (${unit})` : isMolar(unit) ? 'pEC50 (M)' : `pEC50 (−log₁₀ ${unit})`
  return axis === 'dose' ? what : `${what} (${condLabel(axis)})`
}

/** A Compare threshold's fold-change limits, [up, down], as its Statistic panel shows them: a
 *  linear (or CurveCurator) cutoff's fcHigh / fcLow; a SAM curve's asymptote FC_lim (stored as
 *  s0 = −FC_lim, the down side's s0Down while asymmetric) — its fcHigh / fcLow are unused there.
 *  SAM's permutation FDR has none. */
function fcLimits(t: ThresholdConfig | undefined): [number | undefined, number | undefined] {
  if (!t || t.type === 'sam_fdr') return [undefined, undefined]
  if (t.type === 'non-linear') {
    // (a legacy curve, s0 ≥ 0, has no fold-change floor)
    const down = t.s0Down ?? t.s0
    return [t.s0 < 0 ? -t.s0 : undefined, down < 0 ? down : undefined]
  }
  return [t.fcHigh, t.fcLow]
}

/** A Compare threshold's significance floor (−log₁₀ p or q): the linear cutoff's, or the SAM
 *  curve's P_lim — none where it isn't one on the p (or q) values (SAM's permutation FDR,
 *  CurveCurator's relevance score). */
const statFloor = (t: ThresholdConfig | undefined): number | undefined =>
  t && (t.type === 'linear' || t.type === 'non-linear') ? t.statMin : undefined

/** A feature's linear cutoffs as its inputs call by — each axis its own input Compare's (`a` for
 *  side A, `b` for B): log₂FC its fold-change limits, significance its stat floor. None for a
 *  feature a Compare doesn't cut (SD, CV, pEC50) or an input that isn't a Compare (abundance). */
export function cutoffDefaults(
  a: ThresholdConfig | undefined,
  b: ThresholdConfig | undefined,
  feature: ContrastFeatureId
): Partial<ValueCutoffs> | undefined {
  if (!a && !b) return undefined
  if (feature === 'value') {
    const [aUp, aDown] = fcLimits(a)
    const [bUp, bDown] = fcLimits(b)
    return { aUp, aDown, bUp, bDown }
  }
  if (feature === 'p') return { aUp: statFloor(a), bUp: statFloor(b) }
  return undefined
}

/** The features a Contrast of this input can switch between, in switcher order (the sides' own
 *  value first). Clean data: abundance, SD, CV. A Compare: log₂FC and its significance (p or q, as
 *  it calls by). A curve fit: its curve fold change — the peak, by the response surface method;
 *  the shift from the reference curve, testing changes — and its potency, where any curve has one
 *  (named with its unit: `units`, the input's condition units). */
export function contrastFeatures(r: NodeResult | undefined, units?: CondUnits): ContrastFeature[] {
  if (r?.kind === 'standardize')
    return [
      { id: 'value', label: valueUnitOf(r.std) },
      { id: 'sd', label: 'SD' },
      { id: 'cv', label: 'CV %' }
    ]
  if (r?.kind !== 'compare') return []
  // the signed rows (cmpRows), read off their columns — only the curve fields asked (no row built)
  const { n, at } = signedRows(r.cmp)
  const some = (test: (row: number) => boolean): boolean => {
    for (let i = 0; i < n; i++) if (test(at(i))) return true
    return false
  }
  const curveOn = nestedPresent(r.cmp, 'curve')
  const rsOn = nestedPresent(r.cmp, 'rs')
  const [curveAxis, curveScale] = ['axis', 'scale'].map((k) => nestedCol(r.cmp, 'curve', k))
  const [rsAxis, rsScale] = ['axis', 'scale'].map((k) => nestedCol(r.cmp, 'rs', k))
  // curveAxisOf, isSurfaceRow and isLinearRow, by row
  const axisAt = (i: number): unknown =>
    curveAxis(i) ?? (rsOn(i) && rsAxis(i) !== 'surface' ? rsAxis(i) : null)
  const isSurface = (i: number): boolean => rsAxis(i) === 'surface'
  const axes = new Set<ConditionKey>()
  for (let i = 0; i < n; i++) {
    const a = axisAt(at(i))
    if (a != null) axes.add(a as ConditionKey)
  }
  // Surfaces: both per slice (see surfaceSideRows) — the potency where any gene's curves along
  // their axis were described: EC50 on a linear axis, pEC50 on a log one, named with its unit.
  if (some(isSurface)) {
    // one value per slice (the switcher picks it): the largest effect along that slice's curve —
    // against the vehicle, or testing changes, the shift from the reference curve
    const fc: ContrastFeature = { id: 'value', label: CURVE_FC_FEATURE }
    // (a surface row as the fields read here: its `rs`)
    const rsOf = rowView(r.cmp).col('rs')
    let r0: CompareResultRow | undefined
    for (let i = 0; i < n && !r0; i++) {
      if (!isSurface(at(i))) continue
      const x = { rs: rsOf(at(i)) } as CompareResultRow
      if ((surfaceSlicing(x).k === 1 ? x.rs?.surface?.byDose : x.rs?.surface?.byTime)?.length)
        r0 = x
    }
    if (!r0) return [fc]
    const { k, along } = surfaceSlicing(r0)
    const linear = r0.rs?.maps?.[k]?.scale === 'linear'
    return [fc, { id: 'pec50', label: potencyLabel(linear, along, units) }]
  }
  if (some((i) => curveOn(i) || rsOn(i))) {
    const fc: ContrastFeature = { id: 'value', label: CURVE_FC_FEATURE }
    if (!axes.size) return [fc]
    // the potency: pEC50 on a log axis, EC50 on a linear one (see axisModel.ts)
    const axis = [...axes][0]
    const linear = some((i) => curveScale(i) === 'linear' || rsScale(i) === 'linear')
    return [fc, { id: 'pec50', label: potencyLabel(linear, axis, units) }]
  }
  const q = (r.cmp.threshold?.statType ?? 'pQ') === 'pQ'
  return [
    { id: 'value', label: 'log₂FC' },
    { id: 'p', label: q ? '−log₁₀ q' : '−log₁₀ p' }
  ]
}

/** A result as one side of a paired contrast: Compare → log2FC (+ significance); Standardize →
 *  per-sample log10 abundance (the engine averages replicates + unmatched dims to the matched
 *  context). Anything else can't be a side. A side's replicates ride along for the DR's points:
 *  a sample's own value, or — given the Clean data a Compare ran on (`cleanStd`) — each
 *  replicate's log2 ratio to the control mean (previews leave it out). */
export function toContrastSide(
  r: NodeResult | undefined,
  cleanStd?: StandardRow[],
  feature: ContrastFeatureId = 'value',
  ctx: CompareFeatureCtx = { statType: 'pQ', doseScale: 1 },
  /** the run: a surface's rows per slice (surfaceSideRows); the selector's preview keeps one per
   *  gene */
  surfacesPerSlice = false
): ContrastSideRow[] {
  if (
    r?.kind === 'compare' &&
    surfacesPerSlice &&
    someNested(r.cmp, 'rs', 'axis', (_, a) => a === 'surface') &&
    cmpRows(r).some(isSurfaceRow)
  )
    // (a surface's side rows read the whole row: built)
    return cmpRows(r).flatMap((row) =>
      isSurfaceRow(row) ? surfaceSideRows(row, feature, ctx) : []
    )
  // The other sides read only some fields of each row: off their columns (no row built).
  if (r?.kind === 'compare') {
    const { n, at } = signedRows(r.cmp)
    const v = rowView(r.cmp)
    const [uid, cell, cmpd, dose, time, extra, log2FC, signf, effect, pP, pQ] = [
      'uniqID',
      'cell',
      'cmpd',
      'dose',
      'time',
      'extra',
      'log2FC',
      'signf',
      'effect',
      'pP',
      'pQ'
    ].map((k) => v.col(k))
    const out: ContrastSideRow[] = new Array(n)
    if (feature !== 'value') {
      // Another feature of the same rows: its value alone (no SE or replicates — those are the fold
      // change's), the side's own calls kept for the divergence mask.
      const [curve, rs] = ['curve', 'rs'].map((k) => v.col(k))
      for (let k = 0; k < n; k++) {
        const i = at(k)
        const e = extra(i) as CompareResultRow['extra']
        // (the fields compareFeatureValue reads; a potency's curves only when it's asked for)
        const row = {
          log2FC: log2FC(i),
          pP: pP(i),
          pQ: pQ(i),
          ...(feature === 'pec50' ? { curve: curve(i), rs: rs(i) } : null)
        } as CompareResultRow
        out[k] = {
          uniqID: uid(i),
          cell: cell(i) ?? null,
          cmpd: cmpd(i),
          dose: dose(i),
          time: time(i),
          ...(e ? { extra: e } : null),
          value: compareFeatureValue(row, feature, ctx),
          signf: signf(i),
          effect: effect(i),
          pP: pP(i),
          pQ: pQ(i)
        } as ContrastSideRow
      }
      return out
    }
    const byGene = cleanStd ? stdByGene(cleanStd) : undefined
    const [mean2, fcSE] = ['mean2', 'fcSE'].map((k) => v.col(k))
    for (let k = 0; k < n; k++) {
      const i = at(k)
      const e = extra(i) as CompareResultRow['extra']
      // (the fields replicateLog2FCs reads)
      const reps = byGene
        ? replicateLog2FCs(
            {
              mean2: mean2(i),
              cell: cell(i),
              cmpd: cmpd(i),
              dose: dose(i),
              time: time(i),
              extra: e
            } as CompareResultRow,
            byGene.get(uid(i) as string) ?? []
          )
        : []
      out[k] = {
        uniqID: uid(i),
        cell: cell(i) ?? null,
        cmpd: cmpd(i),
        dose: dose(i),
        time: time(i),
        ...(e ? { extra: e } : null),
        value: log2FC(i),
        signf: signf(i),
        effect: effect(i),
        pP: pP(i),
        pQ: pQ(i),
        se: fcSE(i) ?? null,
        ...(reps.length ? { reps } : null)
      } as ContrastSideRow
    }
    return out
  }
  if (r?.kind === 'standardize' && feature !== 'value')
    // A spread is a group's, not a sample's: one row per gene × condition context.
    return stdGroupsOf([r.std]).map(({ row, logs }) => ({
      uniqID: row.uniqID,
      cell: row.cell,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      ...(row.extra ? { extra: row.extra } : null),
      value: stdFeatureValue(logs, feature)
    }))
  if (r?.kind === 'standardize') {
    const v = rowView(r.std)
    const [uid, cell, cmpd, dose, time, extra, val] = [
      'uniqID',
      'cell',
      'cmpd',
      'dose',
      'time',
      'extra',
      'value'
    ].map((k) => v.col(k))
    const out: ContrastSideRow[] = new Array(v.n)
    for (let i = 0; i < v.n; i++) {
      const raw = val(i) as number | null | undefined
      const value = raw != null && raw > 0 ? Math.log10(raw) : null
      const e = extra(i) as StandardRow['extra']
      out[i] = {
        uniqID: uid(i),
        cell: cell(i),
        cmpd: cmpd(i),
        dose: dose(i),
        time: time(i),
        ...(e ? { extra: e } : null),
        value,
        ...(value != null ? { reps: [value] } : null)
      } as ContrastSideRow
    }
    return out
  }
  return []
}

/** Can this result be a side of a paired contrast? */
export const isPairable = (r: NodeResult | undefined): boolean =>
  r?.kind === 'compare' || r?.kind === 'standardize'

/** Which two of the wired inputs form dataset A (y) and B (x): the configured pick when both are
 *  still wired, else the first two edges in order. */
export function pairSides(cfg: ContrastConfig, upstreamIds: string[]): [string, string] | null {
  if (upstreamIds.length < 2) return null
  const a = cfg.pairA && upstreamIds.includes(cfg.pairA) ? cfg.pairA : undefined
  const b = cfg.pairB && upstreamIds.includes(cfg.pairB) && cfg.pairB !== a ? cfg.pairB : undefined
  const rest = upstreamIds.filter((u) => u !== a && u !== b)
  return [a ?? rest.shift()!, b ?? rest.shift()!]
}

/** Intra-dataset mode: which wired input the two groups are selected from — the configured pick
 *  while still wired, else the first edge. */
export function selectSource(cfg: ContrastConfig, upstreamIds: string[]): string | undefined {
  if (cfg.selectFrom && upstreamIds.includes(cfg.selectFrom)) return cfg.selectFrom
  return upstreamIds[0]
}

/**
 * A Contrast's two sides as Curve fit curves over `axis`, when both are: each side's curve rows,
 * renamed to the side (`names` — the contrast's own, its cmp1 / cmp2) so a plot tells them apart.
 * Pair mode: the two inputs' results (each a Curve fit). Select mode: the one input's rows each
 * side's selection picks (compound A vs B of one fit). Null when a side isn't curves over `axis`
 * (a t-test, Clean data, a surface) — the plot then draws the contrast's own per-level values.
 */
export function contrastCurveSides(
  cfg: ContrastConfig,
  upstreamIds: string[],
  results: Record<string, NodeResult | undefined>,
  axis: ConditionKey,
  names: [string, string]
): [CompareResultRow[], CompareResultRow[]] | null {
  const curvesOf = (r: NodeResult | undefined): CompareResultRow[] | null => {
    if (r?.kind !== 'compare') return null
    // the curves along `axis` (curveAxisOf), read off the nested columns — and the same rows
    // each call, so the plot drawn from them doesn't redraw
    const rows = holderWhereNested(
      r.cmp,
      `curves¦${axis}`,
      [
        ['curve', 'axis'],
        ['rs', 'axis']
      ],
      (on, v) => (v[0] ?? (on[1] && v[1] !== 'surface' ? v[1] : null)) === axis
    ).rows as CompareResultRow[]
    return rows.length ? rows : null
  }
  const named = (rows: CompareResultRow[], name: string): CompareResultRow[] =>
    cached(namedOf, rows, name, () => rows.map((x) => ({ ...x, comparison: name })))
  if (resolveContrastSource(cfg, upstreamIds.length) === 'pair') {
    const sides = pairSides(cfg, upstreamIds)
    if (!sides) return null
    const a = curvesOf(results[sides[0]])
    const b = curvesOf(results[sides[1]])
    return a && b ? [named(a, names[0]), named(b, names[1])] : null
  }
  const from = selectSource(cfg, upstreamIds)
  const all = from ? curvesOf(results[from]) : null
  if (!all || !cfg.num || !cfg.den) return null
  // a row in a selection: every condition it pins takes one of its values
  const pick = (sel: CondSelector): CompareResultRow[] =>
    cached(pickOf, all, JSON.stringify(sel), () =>
      all.filter((x) =>
        (Object.entries(sel) as Array<[ConditionKey, string[] | undefined]>).every(
          ([c, vs]) => !vs?.length || vs.some((v) => String(condValue(x, c) ?? '') === String(v))
        )
      )
    )
  const a = pick(cfg.num)
  const b = pick(cfg.den)
  return a.length && b.length ? [named(a, names[0]), named(b, names[1])] : null
}

/** A rows array's derived arrays by key — one per (rows, key), so a side handed out again is the
 *  same array (contrastCurveSides runs on every render). */
const namedOf = new WeakMap<object, Map<string, CompareResultRow[]>>()
const pickOf = new WeakMap<object, Map<string, CompareResultRow[]>>()
function cached(
  by: WeakMap<object, Map<string, CompareResultRow[]>>,
  rows: object,
  key: string,
  make: () => CompareResultRow[]
): CompareResultRow[] {
  let m = by.get(rows)
  if (!m) by.set(rows, (m = new Map()))
  let out = m.get(key)
  if (!out) m.set(key, (out = make()))
  return out
}

/** The wired inputs the tile actually consumes in its current mode — the rest are wired but idle
 *  (drawn dashed on the canvas). */
export function usedInputs(cfg: ContrastConfig, upstreamIds: string[]): Set<string> {
  if (resolveContrastSource(cfg, upstreamIds.length) === 'pair') {
    const s = pairSides(cfg, upstreamIds)
    return new Set(s ?? [])
  }
  const one = selectSource(cfg, upstreamIds)
  return new Set(one ? [one] : [])
}

/** A Compare's rows a Contrast side reads: those with a signed fold change (a two-way ANOVA's
 *  term rows are unsigned — see termless). */
const cmpRows = (r: Extract<NodeResult, { kind: 'compare' }>): CompareResultRow[] =>
  termless(r.cmp.rows)

/** cmpRows as row indices, off the context index (no row built): `n` of them, the i-th at
 *  `at(i)`. */
function signedRows(cmp: { rows: readonly CompareResultRow[] }): {
  n: number
  at: (i: number) => number
} {
  const ix = contextOf(cmp)
  if (!ix.rows.some((c) => c.term)) return { n: ix.n, at: (i) => i }
  const idx = contextIndices(
    ix,
    ix.rows.filter((c) => !c.term)
  )
  return { n: idx.length, at: (i) => idx[i] }
}

/** surfaceSliceCond over a Compare's rows, read off the nested column — only the first surface
 *  row's `rs` read (no row built). */
export function surfaceSliceCondOf(cmp: {
  rows: readonly CompareResultRow[]
}): ConditionKey | undefined {
  const axis = nestedCol(cmp, 'rs', 'axis')
  const n = rowCount(cmp)
  for (let i = 0; i < n; i++)
    if (axis(i) === 'surface')
      return surfaceSlicing({ rs: rowView(cmp).col('rs')(i) } as CompareResultRow).at
  return undefined
}

/** What a Contrast preview shows for a Compare side's compared condition: the comparison ("X |
 *  Y"), not the test value its rows carry (a Compare row keeps only the numerator's value on the
 *  compared condition; the control is in its label). */
export interface ComparedLabels {
  /** the compared conditions (every row's cmp_cond) */
  conds: ReadonlySet<ConditionKey>
  /** a side row's comparison label, by its condition values */
  of: (r: StandardRow) => string | undefined
}

/** A side row's condition values as one key (null and '' alike, `extra` by sorted slug). */
const condTupleKey = (r: {
  cell?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
  extra?: Record<string, string>
}): string => {
  const e = r.extra ?? {}
  return [
    r.cell ?? '',
    r.cmpd ?? '',
    r.dose ?? '',
    r.time ?? '',
    ...Object.keys(e)
      .sort()
      .map((k) => `${k}=${e[k]}`)
  ].join('\u0001')
}

/** A Compare result's ComparedLabels, read off its context index (one row per comparison context,
 *  no result row built); null for any other result. */
export function comparedLabelsOf(r: NodeResult | undefined): ComparedLabels | null {
  if (r?.kind !== 'compare') return null
  const conds = new Set<ConditionKey>()
  const label = new Map<string, string>()
  for (const c of contextOf(r.cmp).rows) {
    if (c.term || !c.comparison) continue
    for (const k of String(c.cmp_cond ?? '').split(':')) if (k) conds.add(k as ConditionKey)
    const key = condTupleKey(c)
    if (!label.has(key)) label.set(key, c.comparison)
  }
  if (!conds.size) return null
  return { conds, of: (row) => label.get(condTupleKey(row)) }
}

/** A result's rows in the shape the group selector reads (uniqID + conditions), plus which
 *  conditions carry values. Compare rows are one per gene × comparison context; Standardize rows
 *  one per gene × sample. */
export function selectorRowsOf(r: NodeResult | undefined): {
  rows: StandardRow[]
  present: ConditionKey[]
} {
  // (read off the columns: no row built) — a Clean data's with its batches as a condition to pick
  // sides by (withBatchCond: the batches it defined, or the Merge inputs above it)
  const holder =
    r?.kind === 'compare' ? r.cmp : r?.kind === 'standardize' ? withBatchCond(r.std) : undefined
  const raw: Array<Record<string, unknown>> = []
  if (holder) {
    // a Compare's signed rows (cmpRows); every Clean data row
    const { n, at } =
      r?.kind === 'compare' ? signedRows(r.cmp) : { n: rowCount(holder), at: (i: number) => i }
    const v = rowView(holder as { rows: readonly object[] })
    const [uid, cell, cmpd, dose, time, extra] = [
      'uniqID',
      'cell',
      'cmpd',
      'dose',
      'time',
      'extra'
    ].map((k) => v.col(k))
    const blank = r?.kind === 'compare'
    for (let k = 0; k < n; k++) {
      const i = at(k)
      const e = extra(i)
      raw.push({
        uniqID: uid(i),
        cell: blank ? (cell(i) ?? '') : cell(i),
        cmpd: cmpd(i),
        dose: dose(i),
        time: time(i),
        ...(e ? { extra: e } : null)
      })
    }
  }
  const rows = raw as unknown as StandardRow[]
  const present = condsIn(rows).filter((c) => condPresent(rows, c))
  return { rows, present }
}
