/**
 * The MA plot (compare): mean abundance against fold change.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { fromLinear, quantityLabel, type ValueScale, type ValueUnit } from '../data/scale'
import type { Effect } from '../stats/stats'
import type { CompareResultRow } from '../types'
import { comparisonOf } from './volcano'

// ── MA (compare) ────────────────────────────────────────────────────────────────

export interface MAPoint {
  x: number // mean abundance A, on the plots' abundance scale (log₁₀ by default)
  y: number // log2FC (M)
  label: string
  effect: Effect
  uniqID: string
}
export interface MAData {
  points: MAPoint[]
  fcLow: number
  fcHigh: number
  /** the rows' single comparison label ("A | B"), for the fold-change axis title */
  comparison?: string
  /** the abundance axis title, with its log base ("mean log abundance", "mean log₂ abundance") */
  xLabel: string
}
export interface MAOptions {
  fcLow: number
  fcHigh: number
  displayMap?: Record<string, string>
  /** the scale abundance is shown on (see plotScaleOf); default log₁₀ */
  scale?: ValueScale
  /** what the values are (valueUnitOf): abundances, or fractions of a reference protein */
  unit: ValueUnit
  /** abundance shown as plain values on a log axis (scale.ts LogDisplay): the title says so */
  plain?: boolean
}

/** MA plot: mean abundance (A) vs log2 fold change (M). Abundance is on the scale every abundance
 *  plot shows Clean data on (see plotScaleOf — log₁₀ unless set otherwise); fold changes are
 *  always log₂. */
export function buildMA(rows: CompareResultRow[], opts: MAOptions): MAData {
  const points: MAPoint[] = []
  const scale = opts.scale ?? 'log10'
  for (const r of rows) {
    if (r.log2FC == null || r.mean1 == null || r.mean2 == null) continue
    const a1 = fromLinear(r.mean1, scale)
    const a2 = fromLinear(r.mean2, scale)
    if (a1 == null || a2 == null) continue
    const a = 0.5 * (a1 + a2)
    if (!Number.isFinite(a) || !Number.isFinite(r.log2FC)) continue
    points.push({
      x: a,
      y: r.log2FC,
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      effect: r.effect,
      uniqID: r.uniqID
    })
  }
  return {
    points,
    fcLow: opts.fcLow,
    fcHigh: opts.fcHigh,
    comparison: comparisonOf(rows),
    xLabel: quantityLabel(scale, `mean ${opts.unit}`, opts.plain).replace(
      /^(log₂?) mean/,
      'mean $1'
    )
  }
}
