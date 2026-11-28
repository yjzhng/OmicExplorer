/**
 * The volcano plot's points, and the fold-change / comparison labels every plot shares.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import type { Effect } from '../stats/stats'
import { type CompareResultRow, isTermRow } from '../types'

// ── volcano ────────────────────────────────────────────────────────────────────

export interface VolcanoPoint {
  x: number // log2FC
  y: number // −log10(q) or −log10(p)
  label: string
  effect: Effect
  uniqID: string
  /** no p-value (a reference protein, a gene too thin to test), drawn at 0 (`untestedAtZero`) */
  untested?: boolean
}

export interface VolcanoData {
  points: VolcanoPoint[]
  fcLow: number
  fcHigh: number
  statMin: number
  statType: 'pP' | 'pQ'
  /** the rows' single comparison label ("A | B"), for the fold-change axis title */
  comparison?: string
  /** what the fold change is (fcName: range / peak log₂FC for curve fits) */
  measure?: string
  /** a two-way ANOVA term's rows: the x is an unsigned effect size (≥ 0), so the plot is one-sided
   *  — from 0, with only the right-hand guides */
  unsigned?: boolean
}

export interface VolcanoOptions {
  statType: 'pP' | 'pQ'
  fcLow: number
  fcHigh: number
  statMin: number
  displayMap?: Record<string, string>
  /** a gene with a fold change but no p-value — a reference protein (constant after normalising
   *  to it), one too thin to test — drawn at 0 on the significance axis instead of left out */
  untestedAtZero?: boolean
}

/** What a Compare's `log2FC` measures, by analysis: a t-test's fold change, a curve fit's — a 4PL
 *  curve's change across the tested levels, a Hybrid curve's or a surface's peak — or a two-way ANOVA's
 *  interaction (a log₂ ratio of fold changes). */
export function fcMeasure(
  analysis?: 'compare' | 'anova' | 'curve_fit',
  /** a curve fit's detection model: the response surface method ('spline') measures the peak */
  detection?: '4pl' | 'spline',
  /** a dose × time surface (either model) measures the peak */
  surface?: boolean,
  /** an ANOVA's rows are its factors' interaction (two or more factors: isInteractionRow); a
   *  one-way ANOVA's are fold changes */
  interaction = true,
  /** an ANOVA's rows are slopes (isSlopeRow): a change per unit of a numeric condition */
  slope = false
): string {
  return analysis === 'curve_fit'
    ? detection === 'spline' || surface
      ? 'peak log₂FC'
      : 'curve log₂FC'
    : analysis === 'anova' && slope
      ? 'slope log₂FC'
      : analysis === 'anova' && interaction
        ? 'interaction log₂FC'
        : 'log₂FC'
}

/** The fold change curve-fit rows carry: a 4PL curve's change across the tested levels, or a Hybrid
 *  curve's / a surface's peak (rows with a response fit, `rs`); plain 'log₂FC' otherwise. */
export function fcName(rows: Array<{ curve?: unknown; rs?: unknown }>): string {
  return rows.some((r) => r.rs)
    ? 'peak log₂FC'
    : rows.some((r) => r.curve)
      ? 'curve log₂FC'
      : 'log₂FC'
}

type LabelRow = {
  comparison?: string
  cmpd?: string | null
  curve?: unknown
  rs?: unknown
  /** a context row's curve axis (contextIndex: only a curve fit's rows have one) */
  along?: unknown
}

/** A curve fit's comparison as it reads in a plot: "dose curve | 0" (the stored key) as
 *  "drugA | baseline" — the compound when the rows are one, against the baseline the fit was given.
 *  Just "baseline": which one (dose 0, a time, a top dose…) isn't spelled out. Display only: the
 *  stored label stays the key it is. */
export function curveComparisonText(label: string, rows: LabelRow[]): string {
  if (!rows.some((r) => r.curve || r.rs || r.along)) return label
  const [left, right] = label.split(' | ')
  if (right == null) return label
  const cmpds = [...new Set(rows.map((r) => r.cmpd).filter((c): c is string => !!c))]
  const what = / curve$/.test(left) && cmpds.length === 1 ? cmpds[0] : left
  return `${what} | baseline`
}

/** The one `comparison` label ("A | B") these rows share, for axis titles — undefined when the
 *  rows are unlabelled or span several comparisons (then the title stays generic). A curve fit's
 *  reads as its compound against its baseline (curveComparisonText). */
export function comparisonOf(rows: LabelRow[]): string | undefined {
  let found: string | undefined
  for (const r of rows) {
    const c = r.comparison?.trim()
    if (!c) continue
    if (found === undefined) found = c
    else if (c !== found) return undefined
  }
  return found === undefined ? undefined : curveComparisonText(found, rows)
}

/** Build volcano points (log2FC vs significance) from comparison rows. */
export function buildVolcano(rows: CompareResultRow[], opts: VolcanoOptions): VolcanoData {
  const points: VolcanoPoint[] = []
  for (const r of rows) {
    const y = opts.statType === 'pP' ? r.pP : r.pQ
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    // no p-value (missing or NaN — not +∞, a p of 0, which is as significant as it gets)
    const untested = y == null || Number.isNaN(y)
    if (untested ? !opts.untestedAtZero : !Number.isFinite(y)) continue
    points.push({
      x: r.log2FC,
      y: untested ? 0 : y,
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      effect: untested ? 'none' : r.effect,
      uniqID: r.uniqID,
      ...(untested ? { untested } : null)
    })
  }
  const unsigned = rows.length > 0 && rows.every(isTermRow)
  return {
    points,
    fcLow: opts.fcLow,
    fcHigh: opts.fcHigh,
    statMin: opts.statMin,
    statType: opts.statType,
    comparison: comparisonOf(rows),
    measure: unsigned ? 'effect size (log₂)' : fcName(rows),
    ...(unsigned ? { unsigned } : null)
  }
}
