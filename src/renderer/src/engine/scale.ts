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
 *  input arrived on; a log choice puts them on that log. Unset → the default for the input: log₁₀
 *  when it arrived linear, none (its own log) when it arrived logged. */
export function outputScale(choice: LogTransform | undefined, input: ValueScale): ValueScale {
  const c = choice ?? defaultTransform(input)
  return c === 'none' ? input : c
}

/** The default log-transform for an input scale: log₁₀ for linear input, none for logged. */
export const defaultTransform = (input: ValueScale): LogTransform =>
  input === 'linear' ? 'log10' : 'none'

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

const presented = new WeakMap<StandardizeResult, StandardizeResult>()
/** A Clean data result with its values on its output scale (`scale`), for display and export —
 *  its own rows stay linear for every analysis. Cached per result. */
export function presentStd(std: StandardizeResult): StandardizeResult {
  const scale = std.scale ?? 'linear'
  if (scale === 'linear') return std
  let out = presented.get(std)
  if (!out) {
    out = {
      ...std,
      rows: std.rows.map((r): StandardRow => ({
        ...r,
        value: r.value == null ? null : fromLinear(r.value, scale)
      }))
    }
    presented.set(std, out)
  }
  return out
}
