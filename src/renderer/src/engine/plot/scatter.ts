/**
 * The contrast scatter (FC1 vs FC2, its guides and bands) and the intensity scatter.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import { type ContrastResultRow, cutoffsFromLabel } from '../compare/contrast'
import {
  fromLinear,
  fromLog10,
  quantityLabel,
  toLinear,
  type ValueScale,
  type ValueUnit
} from '../data/scale'
import { studentTppf, studentTTwoSided } from '../stats/stats'
import type { CompareResultRow } from '../types'

// ── scatter (contrast) ──────────────────────────────────────────────────────────

export interface ScatterPoint {
  x: number // FC2 — the reference side (omicViz scatter.py: "Plot axes: x = FC2, y = FC1")
  y: number // FC1
  label: string
  signf: boolean
  effect: string
  fcdiff: number
  uniqID: string
}

/**
 * The significance boundary drawn behind the points, matching how the contrast called
 * `signf` (mirrors omicViz `scatter.py::_draw_thresholds`, which likewise recomputes it
 * from the plotted rows):
 *  - `ols` (correlated) → the model's line — the OLS fit, or y = x for the identity model —
 *    plus its prediction-band envelope (99% by default), centred where contrast.ts measures
 *    each gene's residual from, so the genes outside the band are exactly the called ones.
 *  - `cutoff` (independent) → the linear cutoffs' lines, as a volcano's: up to two on each axis
 *    (a tail with no cutoff draws none), carving the plane into up to 9 zones. No line of identity.
 */
export interface ScatterGuide {
  kind: 'ols' | 'cutoff'
  /** ols: sampled polylines across the data range */
  fit?: { x: number[]; y: number[] }
  upper?: { x: number[]; y: number[] }
  lower?: { x: number[]; y: number[] }
  /** cutoff: per-axis lines (x = FC2 axis, y = FC1 axis); absent = none on that tail */
  xLo?: number
  xHi?: number
  yLo?: number
  yHi?: number
  /** ols: what the band is drawn from — so a dragged edge maps back to a confidence (bandConfAt)
   *  and redraws at one (bandEdgePath). Centred on the fitted line; lever at x:
   *  sErr·√(1 + 1/n + (x − xMean)²/Sxx). */
  band?: {
    n: number
    xMean: number
    Sxx: number
    sErr: number
    lo: number
    hi: number
    /** the line y = beta0 + beta1·x the band is centred on: the fit, or y = x (identity) */
    beta0: number
    beta1: number
    /** the critical t's degrees of freedom (n − 2 for a fit, n for identity) */
    df: number
    /** identity: nothing fitted, so the half-width is a constant t·sErr (no leverage term) */
    fixed?: boolean
  }
  /** ols: the band's levels it's drawn at (from the rows' `thrsh`): a drag's starting value */
  cutoffs?: { confUp: number; confDown: number }
}

/** The band's half-width at x for critical t. */
const bandLever = (b: NonNullable<ScatterGuide['band']>, x: number): number =>
  b.fixed ? b.sErr : b.sErr * Math.sqrt(1 + 1 / b.n + ((x - b.xMean) * (x - b.xMean)) / b.Sxx)

/** One edge of the prediction band (centred on the fitted line, as drawn) at confidence `conf`,
 *  as an SVG path in data coordinates — a draggable guide's shape. */
export function bandEdgePath(
  b: NonNullable<ScatterGuide['band']>,
  conf: number,
  side: 1 | -1
): string {
  const t = studentTppf(1 - conf, b.df)
  const N = 120
  const pts: string[] = []
  for (let i = 0; i < N; i++) {
    const x = b.lo + ((b.hi - b.lo) * i) / (N - 1)
    pts.push(`${i ? 'L' : 'M'}${x},${b.beta0 + b.beta1 * x + side * t * bandLever(b, x)}`)
  }
  return pts.join('')
}

/** The band confidence whose edge passes through (x, y): the edge sits t·lever off the fitted
 *  line, so t = |y − ŷ(x)| / lever and the confidence is 1 − its two-sided p. */
export function bandConfAt(b: NonNullable<ScatterGuide['band']>, x: number, y: number): number {
  const t = Math.abs(y - (b.beta0 + b.beta1 * x)) / bandLever(b, x)
  return 1 - studentTTwoSided(t, b.df)
}

export interface ScatterData {
  points: ScatterPoint[]
  /** axis labels from the contrast sides (e.g. "E28 | DMSO") */
  xLabel: string
  yLabel: string
  guide?: ScatterGuide
  /** what the axes hold: fold changes (0 = no change, so the view keeps the origin in range),
   *  log abundances, or another Contrast feature (both fitted to the data — 0 is no reference
   *  there). Unset → fold changes. */
  valueKind?: 'quantity' | 'fc' | 'other'
}

export interface ScatterOptions {
  displayMap?: Record<string, string>
  /** what the two sides hold (from ContrastResult.valueKind): fold changes (default) or
   *  abundances from a raw-data contrast — drives the axis titles */
  valueKind?: 'quantity' | 'fc'
  /** the scale abundances are on (see plotScaleOf): the intensity scatter's values, and the
   *  abundance axis titles. Default log₁₀. */
  scale?: ValueScale
  /** a Contrast feature other than the sides' own value (contrastFeatureLabel): the axes hold
   *  it, titled by it */
  valueLabel?: string | null
  /** what quantity sides are (valueUnitOf): abundances, or fractions of a reference protein —
   *  always given, so no axis names fractions "abundance" */
  unit: ValueUnit
  /** abundances shown as plain values on a log axis (scale.ts LogDisplay): the titles say so */
  plain?: boolean
}

/** A linear cutoff of an abundance contrast's own value (stored, and cut, in log₁₀) where the
 *  scatter draws it — on `scale` — and back (a dragged line's value). */
export const cutoffOnScale = (v: number, scale: ValueScale): number => fromLog10(v, scale)
export const cutoffFromScale = (v: number, scale: ValueScale): number =>
  scale === 'log10' ? v : Math.log10(toLinear(v, scale))

/** The band's levels, read back off the rows' `thrsh` label (written by contrast.ts) so the drawn
 *  band matches the colouring: "ols prediction, 95%" / "… 99.9%/90%" (top / bottom). */
function bandFromLabel(thrsh: string): { confUp: number; confDown: number } {
  const pct = /(\d+(?:\.\d+)?)%(?:\/(\d+(?:\.\d+)?)%)?/.exec(thrsh)
  const confUp = pct ? Number(pct[1]) / 100 : 0.99
  const confDown = pct?.[2] ? Number(pct[2]) / 100 : confUp
  return { confUp, confDown }
}

const avg = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length

/** Build the guide for the contrast's relationship, read off the rows' `thrsh` label. A linear
 *  cutoff's values are put where the axes show them (`place`: an abundance's, off log₁₀). */
function scatterGuide(
  pts: ScatterPoint[],
  thrsh: string,
  place: (v: number) => number = (v) => v
): ScatterGuide | undefined {
  const cuts = cutoffsFromLabel(thrsh)
  if (cuts) {
    const at = (v: number | null): number | undefined => (v == null ? undefined : place(v))
    return {
      kind: 'cutoff',
      xLo: at(cuts.bDown),
      xHi: at(cuts.bUp),
      yLo: at(cuts.aDown),
      yHi: at(cuts.aUp)
    }
  }
  if (pts.length < 3) return undefined
  const x = pts.map((p) => p.x) // FC2
  const y = pts.map((p) => p.y) // FC1
  const stat = bandFromLabel(thrsh)

  const identity = thrsh.startsWith('identity')
  if (thrsh.startsWith('ols') || identity) {
    const n = x.length
    const xMean = avg(x)
    const Sxx = x.reduce((s, xi) => s + (xi - xMean) * (xi - xMean), 0)
    if (Sxx === 0 && !identity) return undefined
    const yMean = avg(y)
    // The band's centre line, as contrast.ts calls against it: the OLS fit, or y = x itself.
    const beta1 = identity ? 1 : x.reduce((s, xi, i) => s + (xi - xMean) * (y[i] - yMean), 0) / Sxx
    const beta0 = identity ? 0 : yMean - beta1 * xMean
    const sse = y.reduce((s, yi, i) => {
      const d = yi - (beta0 + beta1 * x[i])
      return s + d * d
    }, 0)
    const df = identity ? n : n - 2
    const sErr = Math.sqrt(sse / df)
    if (!(sErr > 0)) return undefined
    // studentTppf takes a TWO-SIDED p, so the band's critical t is ppf(1 − conf), matching
    // contrast.ts (a one-sided 0.995 here drew a near-zero-width band).
    const tUp = studentTppf(1 - stat.confUp, df)
    const tDown = studentTppf(1 - stat.confDown, df)
    // Span the guide over the SHARED square the view plots (both axes, and always
    // including the origin) so the line of identity runs corner-to-corner through (0,0)
    // instead of starting wherever the x data happens to begin.
    let lo = 0
    let hi = 0
    for (let i = 0; i < n; i++) {
      lo = Math.min(lo, x[i], y[i])
      hi = Math.max(hi, x[i], y[i])
    }
    const N = 120
    const xs: number[] = []
    const fit: number[] = []
    const up: number[] = []
    const dn: number[] = []
    for (let i = 0; i < N; i++) {
      const xi = lo + ((hi - lo) * i) / (N - 1)
      // Centred on the FITTED line — what the calls measure each gene's residual from
      // (contrast.ts) — so the drawn band is exactly where they flip. (Centred on y = x, it
      // disagreed with them wherever the fit ran off the diagonal: genes inside it called,
      // genes outside it not.) The view draws y = x as a reference beside it.
      const yi = beta0 + beta1 * xi
      const lever = identity
        ? sErr
        : sErr * Math.sqrt(1 + 1 / n + ((xi - xMean) * (xi - xMean)) / Sxx)
      xs.push(xi)
      fit.push(yi)
      up.push(yi + tUp * lever)
      dn.push(yi - tDown * lever)
    }
    return {
      kind: 'ols',
      fit: { x: xs, y: fit },
      upper: { x: xs, y: up },
      lower: { x: xs, y: dn },
      band: {
        n,
        xMean,
        Sxx,
        sErr,
        lo,
        hi,
        beta0,
        beta1,
        df,
        ...(identity ? { fixed: true } : null)
      },
      cutoffs: stat
    }
  }
  return undefined
}

/** Build FC1-vs-FC2 scatter points from contrast rows (identity line drawn by the view). */
export function buildScatter(rows: ContrastResultRow[], opts: ScatterOptions): ScatterData {
  const points: ScatterPoint[] = []
  for (const r of rows) {
    if (r.FC1 == null || r.FC2 == null || !Number.isFinite(r.FC1) || !Number.isFinite(r.FC2))
      continue
    points.push({
      x: r.FC2,
      y: r.FC1,
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      signf: r.signf,
      effect: r.effect,
      fcdiff: r.FCdiff ?? r.FC1 - r.FC2,
      uniqID: r.uniqID
    })
  }
  const thrsh = rows.find((r) => r.thrsh)?.thrsh ?? ''
  // Group A (FC1) on y, group B (FC2) on x.
  const unit =
    opts.valueLabel ??
    (opts.valueKind === 'quantity'
      ? quantityLabel(opts.scale ?? 'log10', opts.unit, opts.plain)
      : 'log₂FC')
  return {
    points,
    xLabel: `${unit} · ${rows[0]?.cmp2 ?? 'group B'}`,
    yLabel: `${unit} · ${rows[0]?.cmp1 ?? 'group A'}`,
    // an abundance's own value is cut in log₁₀ (as stored), drawn on the plots' scale
    guide: scatterGuide(
      points,
      thrsh,
      opts.valueKind === 'quantity' && !opts.valueLabel
        ? (v) => cutoffOnScale(v, opts.scale ?? 'log10')
        : undefined
    ),
    valueKind: opts.valueLabel ? 'other' : (opts.valueKind ?? 'fc')
  }
}

/**
 * Intensity scatter from a COMPARISON's group means — the two sides' raw abundances
 * plotted against each other (log10), e.g. basal clpP vs WT from a direct `clpP | WT`
 * comparison restricted to vehicle. Mirrors omicViz, where this comes from a
 * `type: direct` entry (`filter: {cmpd: H2O}`, `cell: [[clpP, WT]]`): the direct output
 * already carries mean1/mean2, so no extra statistics are needed — the comparison's own
 * signf/effect colours the divergent genes and the line of identity is the reference.
 */
export function buildIntensityScatter(rows: CompareResultRow[], opts: ScatterOptions): ScatterData {
  const points: ScatterPoint[] = []
  const scale = opts.scale ?? 'log10'
  for (const r of rows) {
    // mean1/mean2 are linear-space group means (numerator / denominator), put on the scale the
    // plots show abundance on (a log has no value for a non-positive mean).
    if (r.mean1 == null || r.mean2 == null) continue
    const y = fromLinear(r.mean1, scale)
    const x = fromLinear(r.mean2, scale)
    if (y == null || x == null || !Number.isFinite(y) || !Number.isFinite(x)) continue
    points.push({
      x,
      y,
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      signf: r.signf,
      effect: r.effect,
      fcdiff: r.log2FC ?? y - x,
      uniqID: r.uniqID
    })
  }
  // "clpP | WT" → numerator on y, denominator on x.
  const [num, den] = (rows[0]?.comparison ?? '').split(' | ').map((v) => v.trim())
  return {
    points,
    // "abundance" (with its log base) — the same word the MA plot and contrast scatter use.
    xLabel: `${quantityLabel(scale, opts.unit, opts.plain)} · ${den || 'denominator'}`,
    yLabel: `${quantityLabel(scale, opts.unit, opts.plain)} · ${num || 'numerator'}`,
    valueKind: 'quantity'
  }
}
