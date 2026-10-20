/**
 * The Curve metrics plot's data: one gene's curve-fit parameters as bars — a curve's one value per
 * metric; a surface's per slice, grouped by the slice's level (its curves along the axis they run
 * along — see surfaceSlicing — one per level of the other). Read from the stored fit as the results
 * table and the potency plot read it, so every plot shows a gene's numbers alike.
 */
import {
  curveDescribed,
  curveMetrics,
  responseMetrics,
  type CompareResultRow,
  type ConditionKey
} from '../engine'
import { isSurfaceRow, surfaceSlicing } from './contrastPair'

/** The metrics the plot can show, in panel order. */
export const METRIC_IDS = ['potency', 'slope', 'front', 'back'] as const
export type MetricId = (typeof METRIC_IDS)[number]

/** A metric's name as the switch lists it (the potency's own name — EC50 / pEC50 — comes with the
 *  data: see metricBarsOf). */
export const METRIC_NAMES: Record<MetricId, string> = {
  potency: 'potency',
  slope: 'slope',
  front: 'front (log₂)',
  back: 'back (log₂)'
}

/** One metric's bars for a gene: one bar (a curve), or one per slice level (`by` names the condition the levels are of). */
export interface MetricBars {
  id: MetricId
  label: string
  by?: ConditionKey
  /** Δ: the reference slice's level the values are taken from */
  ref?: string
  bars: Array<{ at: string; value: number | null }>
}

/** The axis the fit's curves run along, its unit and molar scale (curveAxisUnit). */
export interface MetricCtx {
  unit?: string
  /** the molar scale of the first axis's unit (pEC50 in molar) */
  scale: number
  /** a surface's per-slice values as their difference from the reference slice's — the compared
   *  axis's control level as the Curve fit set it (dose 0: the vehicle's curve) — e.g. a melt's ΔTm
   *  per dose. A curve has no reference: its values as they are. */
  delta?: boolean
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** A gene's metrics as bars, in METRIC_IDS order, for the metrics asked (each only where the row
 *  has it: an undescribed curve has no potency or plateaus). */
export function metricBarsOf(
  r: CompareResultRow,
  ids: readonly MetricId[],
  ctx: MetricCtx
): MetricBars[] {
  const want = new Set(ids)
  const out: MetricBars[] = []
  const one = (id: MetricId, label: string, value: number | null): void => {
    if (want.has(id)) out.push({ id, label, bars: [{ at: '', value }] })
  }
  if (isSurfaceRow(r)) {
    // per slice: the curves along the axis they run along, at each level of the other
    const { k, at } = surfaceSlicing(r)
    const d = r.rs?.surface
    const slices = [...((k === 1 ? d?.byDose : d?.byTime) ?? [])].sort((a, b) => a.at - b.at)
    const linear = r.rs?.maps?.[k]?.scale === 'linear'
    // the molar scale is the first axis's (the dose's unit); another axis in its own units
    const scale = k === 0 ? ctx.scale : 1
    const per = (id: MetricId, label: string, of: (s: (typeof slices)[number]) => number) => {
      if (!want.has(id) || !slices.length) return
      const vals = slices.map((s) => finite(of(s)))
      // Δ: against the reference slice — the compared axis's control level as the Curve fit set it
      // (its own bar 0; the lowest on a result from before it was kept); none without its value
      const ri = Math.max(
        0,
        slices.findIndex((s) => s.at === r.rs?.maps?.[1 - k]?.base)
      )
      const ref = ctx.delta ? vals[ri] : 0
      out.push({
        id,
        label: ctx.delta ? `Δ${label}` : label,
        by: at,
        ...(ctx.delta ? { ref: String(slices[ri].at) } : null),
        bars: slices.map((s, i) => ({
          at: String(s.at),
          value: vals[i] == null || ref == null ? null : vals[i]! - ref
        }))
      })
    }
    per('potency', potencyName(linear, ctx.unit), (s) =>
      linear ? s.mid : s.mid > 0 ? -Math.log10(s.mid * scale) : NaN
    )
    per('slope', 'slope', (s) => s.slope)
    per('front', 'front (log₂)', (s) => s.front)
    per('back', 'back (log₂)', (s) => s.back)
    return order(out)
  }
  // a curve: CurveCurator's 4PL, or the response surface method's description
  const m: Partial<Record<string, number | string | undefined>> = r.curve
    ? curveDescribed(r.curve)
      ? curveMetrics(r.log2FC ?? NaN, r.curve, undefined, ctx.scale)
      : {}
    : r.rs
      ? responseMetrics(r, ctx.scale)
      : {}
  const linear = r.curve?.scale === 'linear' || r.rs?.scale === 'linear'
  one('potency', potencyName(linear, ctx.unit), finite(linear ? m.EC50 : m.pEC50))
  one('slope', 'slope', finite(m.slope))
  one('front', 'front (log₂)', finite(m.front))
  one('back', 'back (log₂)', finite(m.back))
  return order(out)
}

/** The potency's name: EC50 in its unit on a linear axis, pEC50 on a log one. */
function potencyName(linear: boolean, unit?: string): string {
  return linear ? `EC50${unit ? ` (${unit})` : ''}` : 'pEC50'
}

const order = (bars: MetricBars[]): MetricBars[] =>
  bars.sort((a, b) => METRIC_IDS.indexOf(a.id) - METRIC_IDS.indexOf(b.id))
