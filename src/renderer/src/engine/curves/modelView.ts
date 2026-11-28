/**
 * A response surface method fit seen through one of its two models — the context switch every
 * plot below the Curve fit follows (CompareConfig.modelView):
 *
 *  - detector: the spline (or the 4PL surface detector) — its peak as the fold change, its line or
 *    surface drawn. What was tested.
 *  - descriptor: the description (4PL, line, joint model) — the same statistic, the peak, taken on
 *    the description instead, and a gene without one NA. What's drawn and read (EC50, slope…).
 *
 * The call (p, q, significance) is the detector's either way: the description has no test.
 *
 * The descriptor's peak is computed with the fit (the worker — responseSurface.ts) and kept as
 * `rs.descPeak`; a result fitted before it was kept has it computed here from the stored
 * description, once per result.
 */
import { descValue } from './splineDescribe'
import { fittedSurfaceModel, placed } from './surfaceModel'
import { holderTable, lazyCopy } from '../columns/lazyRows'
import { nestedCol, rowView } from '../columns/rowView'
import { T_MAIN, T_NULL, type Table } from '../columns/wire'
import type { CompareResultRow, ResponseFit } from '../types'

/** Which of a response surface method fit's two models the plots show (see the file comment). */
export type ModelView = 'detector' | 'descriptor'

/** The descriptor's peak: the description's largest departure from no change (0 — its values are
 *  log₂ vs the baseline) at the tested levels, signed — the spline's peak (SplineCurve.peak) taken
 *  on the description, so the two models' fold changes read alike and neither extrapolates past
 *  the tested levels. A one-axis curve: its description at each treated level; a surface: the
 *  description as every view draws it (surfaceModel.ts) at each treated cell.
 *  Undefined without a description. */
export function descPeakOf(rs: ResponseFit): number | undefined {
  let peak = 0
  let any = false
  const take = (v: number): void => {
    if (!Number.isFinite(v)) return
    any = true
    if (Math.abs(v) > Math.abs(peak)) peak = v
  }
  if (rs.axis !== 'surface') {
    const d = rs.desc
    if (!d || !rs.x) return undefined
    for (let i = 1; i < rs.x.length; i++) take(descValue(d, rs.x[i]))
    return any ? peak : undefined
  }
  // a surface: the model every view draws (surfaceModel.ts), at each treated cell
  if (!rs.surface) return undefined
  const m = fittedSurfaceModel(rs, 'descriptor')
  if (!m || m.kind === 'none') return undefined
  for (const c of placed(rs.cells ?? [], m.axes)) {
    const v = m.at(c.dose, c.time)
    if (v != null) take(v)
  }
  return any ? peak : undefined
}

/** Whether a Compare's rows are response surface method fits (they carry `rs`) — the results the
 *  model switch applies to. A curve fit's rows are all of one method: the first tells. */
export function hasResponseFits(cmp: { rows: readonly CompareResultRow[] }): boolean {
  return rowView(cmp).n > 0 && nestedCol(cmp, 'rs', 'axis')(0) != null
}

/** Each row's fold change under the descriptor: its descPeak (kept with the fit; computed from its
 *  description on a result fitted before it was), NaN where it has none. Read off the nested
 *  columns — a row is built only on an old result missing the kept value. */
function descriptorFC(cmp: { rows: readonly CompareResultRow[] }): Float64Array {
  const v = rowView(cmp)
  const kept = nestedCol(cmp, 'rs', 'descPeak')
  const axis = nestedCol(cmp, 'rs', 'axis')
  const rsOf = v.col('rs')
  const out = new Float64Array(v.n)
  for (let i = 0; i < v.n; i++) {
    const k = kept(i)
    if (typeof k === 'number') out[i] = k
    else if (axis(i) == null) out[i] = NaN
    else out[i] = descPeakOf(rsOf(i) as ResponseFit) ?? NaN
  }
  return out
}

/** A Compare result's rows with `log2FC` as the descriptor's fold change (NA where undescribed) —
 *  every other field as it is: lazy over the same columns with that one swapped, else the rows
 *  copied. */
function withDescriptorFC<H extends { rows: readonly CompareResultRow[] }>(cmp: H): H {
  const fc = descriptorFC(cmp)
  const t = holderTable(cmp)
  if (t) {
    const tags = new Uint8Array(fc.length)
    let anyNull = false
    for (let i = 0; i < fc.length; i++)
      if (Number.isNaN(fc[i])) {
        tags[i] = T_NULL
        anyNull = true
      } else tags[i] = T_MAIN
    const table: Table = {
      ...t,
      cols: { ...t.cols, log2FC: anyNull ? { k: 'f', v: fc, t: tags } : { k: 'f', v: fc } }
    }
    const out = lazyCopy(cmp, {} as Partial<H>, table)
    if (out) return out
  }
  return {
    ...cmp,
    rows: cmp.rows.map((r, i) => ({ ...r, log2FC: Number.isNaN(fc[i]) ? null : fc[i] }))
  }
}

const descriptorOf = new WeakMap<object, object>()

/** A Compare result as the model switch shows it: under the descriptor, its rows' fold change the
 *  description's peak (withDescriptorFC) — one copy per result, so everything keyed on it holds
 *  across renders and switching back and forth; under the detector, or for a result without
 *  response fits, the result itself. */
export function withModelView<R extends { kind: string }>(r: R, view: ModelView): R
export function withModelView<R extends { kind: string }>(
  r: R | undefined,
  view: ModelView
): R | undefined
export function withModelView<R extends { kind: string }>(
  r: R | undefined,
  view: ModelView
): R | undefined {
  if (!r || view === 'detector' || r.kind !== 'compare') return r
  let out = descriptorOf.get(r) as R | undefined
  if (!out) {
    const cmp = (r as unknown as { cmp: { rows: readonly CompareResultRow[] } }).cmp
    out = hasResponseFits(cmp) ? ({ ...r, cmp: withDescriptorFC(cmp) } as R) : r
    descriptorOf.set(r, out)
  }
  return out
}
