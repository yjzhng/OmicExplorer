/**
 * The QC plots' settings: Clean data QC, sample correlation, and the curve-fit QC (residuals,
 * metrics, MAD).
 */
import type { ConditionKey, NumericConds, SampleOrder } from '../../engine'
import type { PaletteRef } from '../../ui/color/palettes'
import type { PlotAxes, PointStyle, QuickAccess } from './plotStyle'
import { condColorByDefault, conditionColoring, type ConditionColoring } from './coloring'

/** QC plots (curve-fit QC, after CurveCurator's MAD analysis): each dose's residuals from the
 *  curves' fits, as violins with their outliers — or the curves' metrics against each other. */
/** A QC plot's check: by dose (replicates pooled — CurveCurator's MAD view: a dose off zero
 *  is a sample problem), by sample (dose × replicate — one bad injection), against the fitted value
 *  (constant variance), or normality (a Q–Q plot) — the last two the F-test's assumptions — or the
 *  curves' own metrics, one against another (each curve a dot). */
export type ResidualCheck = 'dose' | 'sample' | 'fitted' | 'normality' | 'metrics'

/** The metrics the QC plot's metrics check can put on an axis: the curve fold change, a curve's
 *  parameters and fit quality (curveMetrics), and its test. */
export const CURVE_QC_METRICS = [
  'log2FC',
  'pEC50',
  'slope',
  'front',
  'back',
  'R2',
  'RMSE',
  'F',
  'pP',
  'F_lof',
  'pP_lof',
  'relevance',
  'q_decoy'
] as const
export type CurveQcMetric = (typeof CURVE_QC_METRICS)[number]
export const CURVE_QC_METRIC_LABEL: Record<CurveQcMetric, string> = {
  log2FC: 'curve log₂FC',
  pEC50: 'pEC50',
  slope: 'slope',
  front: 'front',
  back: 'back',
  R2: 'R²',
  RMSE: 'RMSE',
  F: 'F',
  pP: '−log₁₀ P-value',
  F_lof: 'lack-of-fit F',
  pP_lof: 'lack-of-fit −log₁₀ P',
  relevance: 'relevance',
  q_decoy: 'q (decoy)'
}
/** The metrics check's axes when unset: R² (y) against the curve log₂FC (x) — whether the strong
 *  responses are also well-fitted ones. */
export const CURVE_QC_DEFAULT_X = 'log2FC' satisfies CurveQcMetric
export const CURVE_QC_DEFAULT_Y = 'R2' satisfies CurveQcMetric
/** A metrics-check axis: a metric, or none — the other axis's metric then shown as a distribution
 *  (a histogram of the curves along it). */
export type CurveQcAxis = CurveQcMetric | 'none'
/** The metric pick-list's groups, in order, and each metric's: what it tells of a curve — its
 *  effect, whether it beats flat, the 4PL's parameters, how well the 4PL describes the data. */
const CURVE_QC_GROUPS = ['response', 'significance', 'curve parameters', 'fit quality'] as const
const CURVE_QC_GROUP: Record<CurveQcMetric, (typeof CURVE_QC_GROUPS)[number]> = {
  log2FC: 'response',
  F: 'significance',
  pP: 'significance',
  relevance: 'significance',
  q_decoy: 'significance',
  pEC50: 'curve parameters',
  slope: 'curve parameters',
  front: 'curve parameters',
  back: 'curve parameters',
  R2: 'fit quality',
  RMSE: 'fit quality',
  F_lof: 'fit quality',
  pP_lof: 'fit quality'
}
/** The metric pick-list for one axis, grouped (CURVE_QC_GROUP): none first while the other axis
 *  has a metric (both none would show nothing), then each group's metrics — the other axis's own
 *  pick marked (highlighted, its tooltip saying where). */
export function curveQcAxisOptions(
  other: CurveQcAxis,
  otherAxis: 'x' | 'y'
): { value: CurveQcAxis; label: string; group?: string; marked?: string }[] {
  return [
    ...(other !== 'none' ? [{ value: 'none' as const, label: 'none (freq)' }] : []),
    ...CURVE_QC_GROUPS.flatMap((g) =>
      CURVE_QC_METRICS.filter((m) => CURVE_QC_GROUP[m] === g).map((m) => ({
        value: m,
        label: CURVE_QC_METRIC_LABEL[m],
        group: g,
        ...(m === other ? { marked: `Picked on the ${otherAxis} axis` } : null)
      }))
    )
  ]
}

export interface CurveMadConfig {
  /** the metrics check, force pEC50: a flat curve (its F-test doesn't reject the flat line) at pEC50 0 — EC50 1 M,
   *  the least potent — instead of none (unset): it has no midpoint to place */
  forcePEC50?: boolean
  /** the residual axis: 'range' spans every residual, outliers included; 'fit' (default) is
   *  symmetric about zero and holds 99.9% of the residuals, so a few extremes don't flatten them */
  yScale?: 'fit' | 'range'
  /** each dose's residuals as a violin (quartile box, outlier dots) or every residual as a
   *  dot (default; quartile box over them) */
  show?: 'violin' | 'dot'
  /** what the residuals are checked against (see ResidualCheck); unset = 'dose' */
  check?: ResidualCheck
  /** the metrics check's x and y (unset = R² against curve log₂FC — CURVE_QC_DEFAULT_X / _Y); one
   *  may be 'none' — the other's
   *  distribution */
  metricX?: CurveQcAxis
  metricY?: CurveQcAxis
  /** cap points: the dot views draw at most `maxPoints` residuals (every outlier kept, the rest
   *  sampled evenly — thinPoints); unset = on, at RESIDUAL_DOT_CAP, which is also the most it
   *  takes (a larger stored value is read as it). Off draws them all (slow past ~20k). Boxes, medians and trend lines always use every residual. */
  capEnabled?: boolean
  maxPoints?: number
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** marker/legend look of the control and dosed samples; unset fields use the defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Sample QC plot (standardize): a per-sample distribution of one quality metric, drawn as
 *  a violin, box, or bar. */
export interface QcConfig {
  /** its categorical palette (unset = the global one, app settings → categorical) */
  categorical?: import('../../ui/color/palettes').CategoricalId
  metric: 'intensity' | 'cv' | 'proteins'
  plot: 'violin' | 'box' | 'bar'
  /** # proteins: the count axis global — from zero (default) — or by range, fitted to the counts
   *  so small differences between samples show */
  yScale?: 'global' | 'range'
  /** the samples (or CV's condition groups) along the axis: natural by condition (default) or the
   *  data's own order */
  sampleOrder?: SampleOrder
  /** the fill: one colour for every sample or by condition (`colorConds`); unset = by condition
   *  with few samples, one colour with many (see qcColorBy) */
  colorBy?: 'single' | 'condition'
  /** the single fill colour (default the QC steel blue) */
  color?: string
  /** Older configs' colour by condition: up to two — one categorical (the colour) and one numeric
   *  (the fade). Read back through conditionColoring; new picks go to colorPicks / fadeCond. */
  colorConds?: ConditionKey[]
  /** colour by condition: the conditions the colours stand for (several: every combination its own
   *  colour) — see conditionColoring */
  colorPicks?: ConditionKey[]
  /** colour by condition: the numeric condition fading them (light = low → dark = high), at most
   *  one, never a colour condition */
  fadeCond?: ConditionKey
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** A QC plot's fill: as set, else by condition while the primary condition's levels fit the
 *  palette, one colour past that (condColorByDefault). */
export const qcColorBy = (c: QcConfig, levels: number): 'single' | 'condition' =>
  c.colorBy ?? (condColorByDefault(levels) ? 'condition' : 'single')

/** What a QC plot colours and fades by (conditionColoring) — null when it uses its single
 *  colour. */
export const qcColoring = (
  c: QcConfig,
  active: readonly ConditionKey[],
  levels: number,
  numeric: NumericConds
): ConditionColoring | null =>
  qcColorBy(c, levels) === 'condition' ? conditionColoring(c, active, numeric) : null

/** Sample correlation matrix (standardize): all-samples × all-samples Pearson r heatmap. */
export interface CorrConfig {
  /** how each sample pair is scored (unset = Pearson r) — see CorrMetric; a metric no longer
   *  offered reads as Pearson (corrMetricOf) */
  metric?: import('../../engine').CorrMetric | 'gini' | 'lorenz'
  /** cluster samples by correlation profile so replicate groups block on the diagonal */
  cluster: boolean
  /** the samples' order while they aren't clustered (unset = natural) — see SampleOrder; read
   *  through sampleOrderOf */
  sampleOrder?: SampleOrder
  /** which settings show as switch bars on the tile (sampleOrder starts off) */
  quick?: QuickAccess
  /** the correlation palette (unset = Greens) */
  palette?: PaletteRef
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
