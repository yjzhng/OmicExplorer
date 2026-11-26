/**
 * The scale data values are on: linear (raw intensity) or already log-transformed (log₂ / log₁₀).
 *
 * Clean data detects the scale its input arrives on and converts it to LINEAR before anything else
 * runs, so its rows are always linear: clean-up, imputation and every downstream step (Compare's
 * log₂ test, the heatmap's log₁₀, the cluster's auto-log) keep working on exact linear values,
 * whatever the input was. Its chosen log-transform is the OUTPUT scale — how its values are shown
 * (the Clean data table) and written (the standardized CSV); see presentStd.
 */
import type { StandardizeResult, StandardRow } from './types'
import { holderTable, lazyCopy, tableWithNumbers } from './lazyRows'

export type ValueScale = 'linear' | 'log2' | 'log10'
/** Clean data's log-transform choice: the scale its values are presented on. */
export type LogTransform = 'none' | 'log2' | 'log10'

/** What a detection saw, for the message beside it. */
export interface ScaleEvidence {
  min: number
  max: number
  median: number
  /** share of values ≤ 0 */
  nonPositive: number
}

/**
 * Guess the scale values arrive on. A heuristic — the user confirms it beside a histogram:
 *  - any value < 0 → logged (raw intensities are never negative; log values / log-ratios can be);
 *  - otherwise a maximum above 60 → linear (log intensities stay small);
 *  - otherwise by SHAPE: raw intensities are strongly right-skewed (a pile near zero, a long
 *    tail), logged ones sit in a roughly symmetric hump — skewness above 2 → linear, else logged.
 *    (Not a max/min ratio: log values near zero make any ratio huge, so logged data read as
 *    linear.)
 * A logged guess picks its base by the median: ≥ 12 → log₂ intensities (log₂ puts the same data
 * at ~3.3× the value of log₁₀); 1.5–12 → log₁₀ intensities; below 1.5 → centred near zero, i.e.
 * log-ratios, conventionally log₂. Empty input → linear.
 */
export function detectScale(values: number[]): { scale: ValueScale; evidence: ScaleEvidence } {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length === 0)
    return { scale: 'linear', evidence: { min: NaN, max: NaN, median: NaN, nonPositive: 0 } }
  const sorted = [...v].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const median = sorted[Math.floor(sorted.length / 2)]
  const nonPositive = sorted.filter((x) => x <= 0).length / sorted.length
  const evidence = { min, max, median, nonPositive }
  const logged = (): { scale: ValueScale; evidence: ScaleEvidence } => ({
    scale: median >= 12 || median < 1.5 ? 'log2' : 'log10',
    evidence
  })
  if (min < 0) return logged()
  if (max > 60) return { scale: 'linear', evidence }
  return skewness(sorted) > 2 ? { scale: 'linear', evidence } : logged()
}

/** Sample skewness (Fisher–Pearson): 0 for a symmetric spread, large and positive for a long right
 *  tail. 0 when there's no spread to judge. */
function skewness(v: number[]): number {
  const n = v.length
  if (n < 3) return 0
  const mean = v.reduce((a, b) => a + b, 0) / n
  let m2 = 0
  let m3 = 0
  for (const x of v) {
    const d = x - mean
    m2 += d * d
    m3 += d * d * d
  }
  m2 /= n
  m3 /= n
  return m2 > 0 ? m3 / m2 ** 1.5 : 0
}

/** A value on `scale` → linear. */
export function toLinear(v: number, scale: ValueScale): number {
  return scale === 'log2' ? 2 ** v : scale === 'log10' ? 10 ** v : v
}

/** A linear value → `scale`; a non-positive value has no log, so it's missing (null). */
export function fromLinear(v: number, scale: ValueScale): number | null {
  if (scale === 'linear') return v
  if (!(v > 0)) return null
  return scale === 'log2' ? Math.log2(v) : Math.log10(v)
}

/** The output scale for a log-transform choice on linear rows: 'none' leaves them on the scale the
 *  input arrived on; a log choice puts them on that log. Unset → none: a log-transform is only
 *  applied when the user picks one. */
export function outputScale(choice: LogTransform | undefined, input: ValueScale): ValueScale {
  const c = choice ?? defaultTransform(input)
  return c === 'none' ? input : c
}

/** The default log-transform, whatever the input scale: none. Clean data never picks one for the
 *  user (it used to suggest log₁₀ for raw intensities) — the switch has to be set on purpose. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const defaultTransform = (_input: ValueScale): LogTransform => 'none'

/** Whether a distribution looks roughly normal, judged from its histogram's shape: sample skewness
 *  (from the bin centres, weighted by count) within ±1. A quick read of symmetry beside the plot, not
 *  a normality test — raw intensities, with their pile near zero and long right tail, fail it;
 *  logged ones, a roughly symmetric hump, pass. Undefined when there's too little to judge. */
export type Shape = 'normal' | 'non-normal'
export const SHAPE_SKEW_LIMIT = 1
export function histogramShape(h: ValueHistogram): Shape | undefined {
  const k = h.counts.length
  if (k === 0 || h.n < 3) return undefined
  const w = (h.max - h.min) / k
  let n = 0
  let mean = 0
  h.counts.forEach((c, i) => {
    n += c
    mean += c * (h.min + (i + 0.5) * w)
  })
  if (n < 3) return undefined
  mean /= n
  let m2 = 0
  let m3 = 0
  h.counts.forEach((c, i) => {
    const d = h.min + (i + 0.5) * w - mean
    m2 += c * d * d
    m3 += c * d * d * d
  })
  m2 /= n
  m3 /= n
  if (!(m2 > 0)) return undefined
  return Math.abs(m3 / m2 ** 1.5) <= SHAPE_SKEW_LIMIT ? 'normal' : 'non-normal'
}

/** A histogram of values, for a preview: `bins` equal-width bins over [min, max]. */
export interface ValueHistogram {
  min: number
  max: number
  counts: number[]
  /** how many values it was built from (a sample of a large matrix) */
  n: number
}
export function histogram(values: number[], bins = 40): ValueHistogram {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length === 0) return { min: 0, max: 0, counts: [], n: 0 }
  let min = Infinity
  let max = -Infinity
  for (const x of v) {
    if (x < min) min = x
    if (x > max) max = x
  }
  const counts = new Array(bins).fill(0)
  const w = max > min ? (max - min) / bins : 1
  for (const x of v) counts[Math.min(bins - 1, Math.floor((x - min) / w))]++
  return { min, max, counts, n: v.length }
}

/** Up to `cap` values, evenly strided (deterministic), so a preview of a large matrix is cheap and
 *  doesn't change between runs. */
export function sampleValues(values: number[], cap = 50000): number[] {
  if (values.length <= cap) return values
  const step = values.length / cap
  const out: number[] = []
  for (let i = 0; i < cap; i++) out.push(values[Math.floor(i * step)])
  return out
}

/** The scale a Clean data result is presented on — its table, the written data, and every
 *  abundance plot (heatmap, bars, MA, abundance scatter, abundance contrasts, QC, sample
 *  correlation, PCA/clustering) — and the one a Compare tests on: the scale the result carries.
 *  Clean data stamps it from its log-transform (withLogTransform); Merge, Subset and every other
 *  step that makes a Clean-data result pass it on, so a reader takes the scale of what it's fed and
 *  never looks for the step that chose it. No fallback of the plots' own: raw intensities left
 *  unlogged LOOK wrong on every plot, which is the cue to set the log-transform in Clean data. */
export function presentScaleOf(std: StandardizeResult): ValueScale {
  return analysisScaleOf(std)
}

/** How logged values are shown: as their logs ('log' — "log abundance" 5, 6, 7), or as the values
 *  themselves on a log axis ('plain' — 10⁵, 10⁶, 10⁷; fractions 0.01, 0.1, 1). The same positions
 *  and shape either way, and the same analyses: only the axis and colour-bar labels, the tables
 *  and the hovers read differently. Absent: 'plain' for fractions of a reference protein (their
 *  logs are hard to read), 'log' for abundances. */
export type LogDisplay = 'log' | 'plain'
/** Whether `std`'s logged values are shown plain, on a log axis (LogDisplay) — never when linear. */
export function plainLogOf(std: StandardizeResult | undefined): boolean {
  if (!std || analysisScaleOf(std) === 'linear') return false
  return (std.logDisplay ?? (valueUnitOf(std) === 'fraction' ? 'plain' : 'log')) === 'plain'
}
/** The scale a table (or an export) shows `std`'s values on: plain values when they're shown so,
 *  else the scale it's presented on. */
export function tableScaleOf(std: StandardizeResult): ValueScale {
  return plainLogOf(std) ? 'linear' : presentScaleOf(std)
}
/** `std` showing its logged values as `display` — a flip needs no re-run (presentation only). */
export function withLogDisplay(
  std: StandardizeResult,
  display: LogDisplay | undefined
): StandardizeResult {
  if (std.logDisplay === display) return std
  const table = holderTable(std)
  const patch = { logDisplay: display }
  return (table && lazyCopy(std, patch, table)) ?? { ...std, logDisplay: display }
}

/** The scale analyses run on — a Compare's test (logged or not), the cluster's auto-log, the
 *  sample correlation: Clean data's log-transform, as the result carries it — the same scale every
 *  plot positions its values on (presentScaleOf). */
export function analysisScaleOf(std: StandardizeResult): ValueScale {
  return std.scale ?? 'linear'
}

/** `std` presented on `choice` — its rows as they are (linear), only the scale it carries changed:
 *  a log-transform flipped in Clean data needs no re-run. The same object when nothing changes; a
 *  result without `inputScale` (from before it was kept) keeps the scale it has. */
export function withLogTransform(
  std: StandardizeResult,
  choice: LogTransform | undefined
): StandardizeResult {
  return std.inputScale ? withScale(std, outputScale(choice, std.inputScale)) : std
}

/** `std` carrying `scale` — a lazy result's rows left lazy (a spread would build every row). */
export function withScale(std: StandardizeResult, scale: ValueScale): StandardizeResult {
  if (std.scale === scale) return std
  const table = holderTable(std)
  return (table && lazyCopy(std, { scale }, table)) ?? { ...std, scale }
}

/** What Clean data's values are: abundances, or — divided by a reference protein (normalize.ts)
 *  — fractions of that protein. Every axis, legend and column that names the values uses it. */
export type ValueUnit = 'abundance' | 'fraction'
/** A Clean data result's unit: 'fraction' once its samples were divided by a reference protein. */
export function valueUnitOf(std: Pick<StandardizeResult, 'normalization'> | undefined): ValueUnit {
  const nz = std?.normalization
  return nz?.used === 'protein' && nz.samples > 0 ? 'fraction' : 'abundance'
}

/** A quantity axis title on `scale`: "log abundance" (log₁₀ — the app's plain "log"), "log₂
 *  abundance", or just "abundance" when linear. `noun` is the values' unit — always given, so no
 *  axis can name fractions "abundance" (valueUnitOf: "log fraction" after a reference protein) —
 *  or a phrase built on it ("mean abundance"). `plain`: shown as plain values on a log axis — just
 *  "fraction", the ticks showing the axis is logged. */
/** A scale's name as the UI writes it, base subscripted: "log₂", "log₁₀", "linear". */
export function scaleName(scale: ValueScale | LogTransform): string {
  return scale === 'log2'
    ? 'log₂'
    : scale === 'log10'
      ? 'log₁₀'
      : scale === 'none'
        ? 'none'
        : 'linear'
}

export function quantityLabel(scale: ValueScale, noun: string, plain = false): string {
  // shown plain on a log axis (LogDisplay 'plain'): the noun itself — the axis's labels (0.01,
  // 0.1, 1) say it's logged
  if (plain && scale !== 'linear') return noun
  return scale === 'log10' ? `log ${noun}` : scale === 'log2' ? `log₂ ${noun}` : noun
}

/** A log₁₀ value (how an abundance contrast stores its sides) → `scale`. */
export function fromLog10(v: number, scale: ValueScale): number {
  return scale === 'log10' ? v : scale === 'log2' ? v / Math.log10(2) : 10 ** v
}

const presented = new WeakMap<StandardizeResult, Map<ValueScale, StandardizeResult>>()
/** A Clean data result with its values on `scale` (default: the scale it was run with), for display
 *  and export — its own rows stay linear for every analysis. Cached per result and scale, so
 *  switching back and forth is instant. */
export function presentStd(
  std: StandardizeResult,
  scale: ValueScale = std.scale ?? 'linear'
): StandardizeResult {
  if (scale === 'linear') return std
  let byScale = presented.get(std)
  if (!byScale) presented.set(std, (byScale = new Map()))
  let out = byScale.get(scale)
  // A columnar result: the value column rescaled, its rows still built only when read.
  const table = out ? null : tableWithNumbers(std, 'value', (v) => fromLinear(v, scale))
  if (!out && table) {
    out = lazyCopy(std, { scale }, table) ?? undefined
    if (out) byScale.set(scale, out)
  }
  if (!out) {
    out = {
      ...std,
      scale,
      rows: std.rows.map((r): StandardRow => ({
        ...r,
        value: r.value == null ? null : fromLinear(r.value, scale)
      }))
    }
    byScale.set(scale, out)
  }
  return out
}
