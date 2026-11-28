/** A distribution's box and violin, worked out once from its values rather than by Plotly from
 *  every value on each draw. A QC violin of a full proteome is tens of thousands of values per
 *  sample, hundreds of thousands per plot: Plotly sorts them and runs a kernel density over them
 *  on the UI thread at every redraw (a resize, a theme switch, a tab shown again).
 *
 *  So: the statistics a box draws, as Plotly would compute them (its 'linear' quartiles; its
 *  whiskers, with no points shown, run to the min and max), handed over precomputed; and for a violin, the values' quantiles at
 *  `cap` evenly spaced points (its first and last the min and max) with the kernel bandwidth
 *  Plotly would pick for ALL the values — the same density, drawn from a fraction of the points. */

export interface DistShape {
  n: number
  min: number
  max: number
  mean: number
  /** Plotly's 'linear' quartiles */
  q1: number
  median: number
  q3: number
  /** the quartiles interpolated at (n − 1)·p, as a tooltip states them */
  tipQ1: number
  tipQ3: number
  /** the violin's kernel bandwidth for all n values (Plotly's rule of thumb) */
  bandwidth: number
  /** the values the violin is drawn from: all of them up to `cap`, else `cap` quantiles */
  sample: number[]
}

/** the violin's points past which it's drawn from quantiles */
export const VIOLIN_CAP = 1000

/** Plotly's Lib.interp: the p-quantile of sorted values, at position p·n − ½ */
function interp(s: ArrayLike<number>, p: number): number {
  const at = p * s.length - 0.5
  if (at < 0) return s[0]
  if (at > s.length - 1) return s[s.length - 1]
  const lo = Math.floor(at)
  const f = at - lo
  return f ? f * s[lo + 1] + (1 - f) * s[lo] : s[lo]
}

/** the p-quantile of sorted values, interpolated at (n − 1)·p */
function quantile7(s: ArrayLike<number>, p: number): number {
  const at = (s.length - 1) * p
  const lo = Math.floor(at)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo)
}

/** The shape of `values`' finite numbers, or null with none. */
export function distShape(values: readonly number[], cap = VIOLIN_CAP): DistShape | null {
  const s = Float64Array.from(values.filter(Number.isFinite)).sort()
  const n = s.length
  if (!n) return null
  let sum = 0
  for (let i = 0; i < n; i++) sum += s[i]
  const mean = sum / n
  let ss = 0
  for (let i = 0; i < n; i++) ss += (s[i] - mean) * (s[i] - mean)
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0
  const q1 = interp(s, 0.25)
  const median = interp(s, 0.5)
  const q3 = interp(s, 0.75)
  const iqr = q3 - q1
  const span = s[n - 1] - s[0]
  // Plotly's violin bandwidth (violin/calc.js): Silverman's rule, at least 1% of the span
  const bandwidth = Math.max(1.059 * Math.min(sd, iqr / 1.349) * Math.pow(n, -0.2), span / 100)
  let sample: number[]
  if (n <= cap) sample = Array.from(s)
  else {
    sample = new Array<number>(cap)
    // the (i / (cap − 1))-quantiles, interpolated between neighbours: min … max
    for (let i = 0; i < cap; i++) {
      const at = (i * (n - 1)) / (cap - 1)
      const lo = Math.floor(at)
      const f = at - lo
      sample[i] = f ? s[lo] + (s[lo + 1] - s[lo]) * f : s[lo]
    }
  }
  return {
    n,
    min: s[0],
    max: s[n - 1],
    mean,
    q1,
    median,
    q3,
    tipQ1: quantile7(s, 0.25),
    tipQ3: quantile7(s, 0.75),
    bandwidth,
    sample
  }
}
