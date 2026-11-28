/** A Contrast's sides as its run builds them (Contrast's run, contrastSelect.ts) — each input row
 *  as a side row of one feature: a Compare row's value, a Clean data group's, a surface's per slice.
 *  Shared by the run (in the engine) and the selector window (graph/contrastPair re-exports them). */
import {
  customSlug,
  isCustomCond,
  type ConditionKey,
  type CompareResultRow,
  type StandardRow
} from './types'
import { curveDescribed, curveIsFlat } from './curveFit'
import { xUnits } from './axisModel'
import { rowView } from './rowView'
import type { ContrastFeatureId, ContrastSideRow } from './contrast'

/** How a Compare side reads its features: its significance (p or q, as it calls by) and, for a
 *  curve fit over dose, the dose unit's size in molar (pEC50 in molar, as CurveCurator reports
 *  it; 1 = the dose's own units). */
export interface CompareFeatureCtx {
  statType: 'pP' | 'pQ'
  doseScale: number
}

/** A curve fit's row as a curve along one axis: CurveCurator's / the 4PL's, or the response
 *  surface method's (a surface — dose × time — is no one curve). */
export const curveAxisOf = (r: CompareResultRow): ConditionKey | null =>
  r.curve?.axis ?? (r.rs && r.rs.axis !== 'surface' ? r.rs.axis : null)

/** A curve fit's row on a linear axis (see axisModel.ts): its potency is EC50, not pEC50. */
export const isLinearRow = (r: CompareResultRow): boolean =>
  r.curve?.scale === 'linear' || r.rs?.scale === 'linear'

/** A dose × time surface's row (the response surface method over dose × time): one gene, every
 *  dose and time at once. */
export const isSurfaceRow = (r: CompareResultRow): boolean => r.rs?.axis === 'surface'

/** How a surface is contrasted slice by slice: along the axis its curves run along — testing
 *  response changes, the response axis; else its first (its dose curves) — one slice per level of
 *  the other axis, `at`, the condition its side rows carry and the run matches the sides on. */
export function surfaceSlicing(r: CompareResultRow): {
  k: 0 | 1
  along: ConditionKey
  at: ConditionKey
} {
  const pair = r.rs?.pair ?? (['dose', 'time'] as [ConditionKey, ConditionKey])
  const k: 0 | 1 = r.rs?.shift && r.rs.shift.response === pair[1] ? 1 : 0
  return { k, along: pair[k], at: pair[1 - k] }
}

/** The condition a set of rows' surfaces are contrasted per level of (surfaceSlicing), if any. */
export const surfaceSliceCond = (rows: readonly CompareResultRow[]): ConditionKey | undefined => {
  const r = rows.find(isSurfaceRow)
  return r ? surfaceSlicing(r).at : undefined
}

/** A side row's condition set to a level: a preset's column, a custom one's `extra` text. */
function withCond(row: ContrastSideRow, c: ConditionKey, v: number): ContrastSideRow {
  if (isCustomCond(c)) return { ...row, extra: { ...row.extra, [customSlug(c)]: String(v) } }
  return { ...row, [c]: v }
}

/** A surface's row as one side row per slice, for one feature — a surface has no single fold change
 *  or EC50, so it's contrasted slice by slice (the run matches the sides on the slice's level):
 *  - its fold change: at each level, the fit's largest effect along the curve, signed — against the
 *    vehicle (capturing the shape), or, testing response changes, against the reference curve (the
 *    base level's, so what every level shares — a melt — isn't counted);
 *  - its pEC50: that level's curve's midpoint (the description's slices) — EC50 itself on a linear
 *    axis — for the genes the Curve fit described. */
export function surfaceSideRows(
  r: CompareResultRow,
  f: ContrastFeatureId,
  ctx: CompareFeatureCtx
): ContrastSideRow[] {
  const { k, at } = surfaceSlicing(r)
  const base: ContrastSideRow = {
    uniqID: r.uniqID,
    cell: r.cell ?? null,
    cmpd: r.cmpd,
    dose: null,
    time: null,
    ...(r.extra ? { extra: r.extra } : null),
    value: null,
    signf: r.signf,
    effect: r.effect,
    pP: r.pP,
    pQ: r.pQ
  }
  const rs = r.rs
  if (f === 'pec50') {
    const slices = (k === 1 ? rs?.surface?.byDose : rs?.surface?.byTime) ?? []
    const linear = rs?.maps?.[k]?.scale === 'linear'
    // the molar scale is the dose's (the first axis's unit) — any other axis in its own units
    const scale = k === 0 ? ctx.doseScale : 1
    return slices.map((sl) => {
      const v = linear ? sl.mid : sl.mid > 0 ? -Math.log10(sl.mid * scale) : NaN
      return withCond({ ...base, value: Number.isFinite(v) ? v : null }, at, sl.at)
    })
  }
  // a cell's level along the curve and of its slice (the cells' two slots)
  const along = (c: { dose: number; time: number }): number => (k === 1 ? c.time : c.dose)
  const level = (c: { dose: number; time: number }): number => (k === 1 ? c.dose : c.time)
  const cells = rs?.cells ?? []
  // testing changes: the reference curve — the fit along the curve at the compared axis's control
  // level as the Curve fit set it (the lowest on a result from before it was kept)
  const ref = new Map<number, number>()
  if (rs?.shift && cells.length) {
    const ctl = rs.maps?.[1 - k]?.base
    const lo = cells.some((c) => level(c) === ctl) ? ctl! : Math.min(...cells.map(level))
    for (const c of cells) if (level(c) === lo) ref.set(along(c), c.fitted)
  }
  const peak = new Map<number, number>()
  for (const c of cells) {
    const e = rs?.shift ? c.fitted - (ref.get(along(c)) ?? NaN) : c.fitted
    const cur = peak.get(level(c))
    if (Number.isFinite(e) && (cur === undefined || Math.abs(e) > Math.abs(cur)))
      peak.set(level(c), e)
  }
  return [...peak]
    .sort((a, b) => a[0] - b[0])
    .map(([lv, value]) => withCond({ ...base, value }, at, lv))
}

/** A Compare row's value of one feature. */
export function compareFeatureValue(
  r: CompareResultRow,
  f: ContrastFeatureId,
  ctx: CompareFeatureCtx
): number | null {
  if (f === 'p') return ctx.statType === 'pQ' ? r.pQ : r.pP
  if (f === 'pec50') {
    // EC50 in the axis's units — the 4PL's, or the description midpoint — as the potency plot reads
    // it; pEC50 = −log₁₀ EC50 (in molar where the axis's unit is molar: ctx.doseScale, from
    // curveDoseUnit — 1 for any other unit). On a linear axis the EC50 itself.
    const axis = curveAxisOf(r)
    // a flat 4PL curve: none — its midpoint is the fit's bound
    if (r.curve && curveIsFlat(r)) return null
    // (an undescribed 4PL curve — responders only, not one — has none)
    const ec50 = r.curve
      ? curveDescribed(r.curve)
        ? xUnits(r.curve, -r.curve.pec50)
        : undefined
      : r.rs?.desc?.mid
    if (isLinearRow(r)) return axis && ec50 != null && Number.isFinite(ec50) ? ec50 : null
    if (!axis || ec50 == null || !(ec50 > 0)) return null
    const v = -Math.log10(ec50 * ctx.doseScale)
    return Number.isFinite(v) ? v : null
  }
  return r.log2FC
}

/** A Clean data group's value of one feature, from its replicates' log₁₀ abundances: their mean,
 *  their SD (log₁₀), or the CV of the abundances themselves (%). A spread needs two replicates. */
export function stdFeatureValue(logs: number[], f: ContrastFeatureId): number | null {
  const n = logs.length
  if (!n) return null
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
  const sd = (a: number[]): number => {
    const m = mean(a)
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
  }
  if (f === 'sd') return n >= 2 ? sd(logs) : null
  if (f === 'cv') {
    if (n < 2) return null
    const lin = logs.map((v) => 10 ** v)
    const m = mean(lin)
    return m > 0 ? (sd(lin) / m) * 100 : null
  }
  return mean(logs)
}

/** Clean data rows gathered per gene × condition context — a group's replicates together — with
 *  their log₁₀ abundances (a non-positive value has none): over the rows of several results in
 *  turn (as over their rows concatenated), read off their columns — no row built. Each group's
 *  `row` holds only the fields its readers take (uniqID and the conditions: cell, cmpd, dose,
 *  time, extra). */
export function stdGroupsOf(
  holders: ReadonlyArray<{ rows: readonly StandardRow[] }>
): Array<{ row: StandardRow; logs: number[] }> {
  const groups = new Map<string, { row: StandardRow; logs: number[] }>()
  for (const h of holders) {
    const v = rowView(h)
    const [uid, cell, cmpd, dose, time, extra, val] = [
      'uniqID',
      'cell',
      'cmpd',
      'dose',
      'time',
      'extra',
      'value'
    ].map((k) => v.col(k))
    for (let i = 0; i < v.n; i++) {
      const value = val(i) as number | null | undefined
      if (value == null || !(value > 0)) continue
      const e = extra(i) as StandardRow['extra']
      const row = {
        uniqID: uid(i),
        cell: cell(i),
        cmpd: cmpd(i),
        dose: dose(i),
        time: time(i),
        extra: e
      } as StandardRow
      // Custom conditions join the key — without them two distinct contexts would pool together.
      const extraKey = Object.keys(e ?? {})
        .sort()
        .map((k) => `${k}=${e![k]}`)
        .join('¦')
      const key = `${row.uniqID}¦${row.cell ?? ''}¦${row.cmpd ?? ''}¦${row.dose ?? ''}¦${row.time ?? ''}¦${extraKey}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { row, logs: [] }))
      g.logs.push(Math.log10(value))
    }
  }
  return [...groups.values()]
}
