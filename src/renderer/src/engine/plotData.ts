/**
 * Shape engine outputs into plain data structures for Plotly rendering. Kept
 * framework/library-free so the engine has no plotly dependency — the renderer
 * component assembles the actual Plotly traces from these.
 */
import { clusterRowGroups, clusterRowOrder } from './cluster'
import type { ContrastResultRow } from './contrast'
import { embed2D, type ClusterMethod } from './embed'
import { benjaminiHochberg, madNormal, median, normalSf, studentTppf, type Effect } from './stats'
import { VALID_CONDITIONS } from './types'
import type {
  CompareResultRow,
  ConditionKey,
  StandardizeResult,
  StandardRow
} from './types'

// ── volcano ────────────────────────────────────────────────────────────────────

export interface VolcanoPoint {
  x: number // log2FC
  y: number // −log10(q) or −log10(p)
  label: string
  effect: Effect
  uniqID: string
}

export interface VolcanoData {
  points: VolcanoPoint[]
  fcLow: number
  fcHigh: number
  statMin: number
  statType: 'pP' | 'pQ'
}

export interface VolcanoOptions {
  statType: 'pP' | 'pQ'
  fcLow: number
  fcHigh: number
  statMin: number
  displayMap?: Record<string, string>
}

/** Build volcano points (log2FC vs significance) from comparison rows. */
export function buildVolcano(rows: CompareResultRow[], opts: VolcanoOptions): VolcanoData {
  const points: VolcanoPoint[] = []
  for (const r of rows) {
    const y = opts.statType === 'pP' ? r.pP : r.pQ
    if (r.log2FC == null || y == null || !Number.isFinite(r.log2FC) || !Number.isFinite(y)) continue
    points.push({
      x: r.log2FC,
      y,
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      effect: r.effect,
      uniqID: r.uniqID
    })
  }
  return {
    points,
    fcLow: opts.fcLow,
    fcHigh: opts.fcHigh,
    statMin: opts.statMin,
    statType: opts.statType
  }
}

// ── context faceting ─────────────────────────────────────────────────────────────
// Mirrors omicViz `plot_group_cols` + the per-context groupby in `make_volcanos`:
// a comparison table is split into one plot per context = the active conditions that
// carry values, MINUS the dimension(s) the comparison itself consumes. Those consumed
// dims are read from `cmp_cond` (not hardcoded): 'cmpd' for veh_norm, the compared
// condition for a direct comparison ('strain', 'dose', …), or a colon-joined factor
// pair for a two-way ANOVA ('cmpd:dose'). Excluding them is what stops a clpP-vs-WT
// strain comparison from offering a meaningless single-level "strain" facet, and a
// veh_norm over strain × dose from collapsing into one merged cloud.

/** Minimal shape the faceting helpers need — satisfied by both compare and contrast
 *  result rows (they carry `cmp_cond` plus the condition columns). */
export interface ContextRow {
  cmp_cond?: string
  comparison?: string
  strain?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
}

/** A tab-bar facet dimension: a condition, or the `comparison` label itself (used to split a
 *  multi-pair Compare tile into one plot per comparison instead of merging them). */
export type FacetKey = ConditionKey | 'comparison'

function condPresentInRows(rows: ContextRow[], c: ConditionKey): boolean {
  if (c === 'strain' || c === 'cmpd')
    return rows.some((r) => {
      const v = (r as unknown as Record<string, unknown>)[c]
      return v != null && v !== ''
    })
  return rows.some((r) => (r as unknown as Record<string, unknown>)[c] != null)
}

/** Dimensions the comparison itself consumes (never faceted), parsed from `cmp_cond`. */
function comparisonDims(rows: ContextRow[]): Set<string> {
  const dims = new Set<string>()
  for (const r of rows) for (const part of String(r.cmp_cond).split(':')) if (part) dims.add(part)
  return dims
}

/** Context dimensions present in these rows, excluding the comparison's consumed dims.
 *  Pass `exclude` to remove further dims a plot consumes (e.g. a DR/bubble axis). */
export function facetContextDims(rows: ContextRow[], exclude?: ConditionKey[]): ConditionKey[] {
  const ex = comparisonDims(rows)
  if (exclude) for (const d of exclude) ex.add(d)
  return VALID_CONDITIONS.filter((c) => !ex.has(c) && condPresentInRows(rows, c))
}

/** Colour-by choices for the pooled responsome embedding (buildResponseCluster). Like
 *  facetContextDims it keeps the present context dims, but it ALSO keeps a comparison-consumed
 *  dim (e.g. cmpd in a two-way ANOVA) when the pooled rows span several comparisons and it
 *  genuinely varies — the cluster merges every comparison, so such a dim is not degenerate the
 *  way it is inside a single comparison's facet. */
export function responseColorDims(rows: ContextRow[]): ConditionKey[] {
  const consumed = comparisonDims(rows)
  return VALID_CONDITIONS.filter((c) => {
    if (!condPresentInRows(rows, c)) return false
    if (!consumed.has(c)) return true
    // Consumed dim: only useful to colour by if it takes more than one value across the pool.
    const seen = new Set<string>()
    for (const r of rows) {
      const v = (r as unknown as Record<string, unknown>)[c]
      if (v != null && v !== '') seen.add(String(v))
      if (seen.size > 1) return true
    }
    return false
  })
}

/** Tab-bar facet dimensions: the `comparison` label first (only when several coexist, so a
 *  multi-pair Compare splits per comparison) then the context conditions. */
export function facetDims(rows: ContextRow[], exclude?: ConditionKey[]): FacetKey[] {
  const ctx = facetContextDims(rows, exclude)
  const multiCmp = new Set(rows.map((r) => r.comparison).filter((c) => c != null)).size > 1
  return multiCmp ? ['comparison', ...ctx] : ctx
}

export interface FacetGroup<T = ContextRow> {
  /** stable key, e.g. "strain=WT · dose=10" */
  key: string
  /** the faceting value(s) for this group, in dim order */
  values: Array<{ dim: FacetKey; value: string | number }>
  rows: T[]
}

/** Split rows into one group per distinct tuple of `dims` values (omicViz groupby). */
export function facetCompareRows<T extends ContextRow>(
  rows: T[],
  dims: FacetKey[]
): FacetGroup<T>[] {
  if (dims.length === 0) return [{ key: '', values: [], rows }]
  const groups = new Map<string, FacetGroup<T>>()
  for (const r of rows) {
    const values = dims.map((d) => ({
      dim: d,
      value: (r as unknown as Record<string, unknown>)[d] as string | number
    }))
    const key = values.map((v) => `${v.dim}=${v.value}`).join(' · ')
    let g = groups.get(key)
    if (!g) {
      g = { key, values, rows: [] }
      groups.set(key, g)
    }
    g.rows.push(r)
  }
  // Numeric-aware ordering so dose/time facets read 2.5 < 5 < 10, strings lexical.
  return [...groups.values()].sort((a, b) => {
    for (let i = 0; i < dims.length; i++) {
      const av = a.values[i]?.value
      const bv = b.values[i]?.value
      const an = Number(av)
      const bn = Number(bv)
      // Numeric when both parse (dose 2.5 < 5 < 10); otherwise code-point order to
      // match pandas groupby (uppercase before lowercase, e.g. 'WT' < 'clpP').
      const sa = String(av)
      const sb = String(bv)
      const cmp =
        Number.isFinite(an) && Number.isFinite(bn) ? an - bn : sa < sb ? -1 : sa > sb ? 1 : 0
      if (cmp !== 0) return cmp
    }
    return 0
  })
}

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
 *  - `ols` (correlated) → the line of identity plus a 99% prediction-band envelope around
 *    it; dissonant genes are the ones lying outside the band. (`signf` itself still comes
 *    from omicViz's OLS-fit band — see contrast.ts — so points sitting within a whisker of
 *    the envelope can disagree when the fit is tilted away from identity.)
 *  - `marginal` (independent) → a robust per-axis box at the effective BH boundary: two
 *    thresholds on each axis, carving the plane into 9 zones. No line of identity.
 */
export interface ScatterGuide {
  kind: 'ols' | 'marginal'
  /** ols: sampled polylines across the data range */
  fit?: { x: number[]; y: number[] }
  upper?: { x: number[]; y: number[] }
  lower?: { x: number[]; y: number[] }
  /** marginal: per-axis thresholds (x = FC2 axis, y = FC1 axis) */
  xLo?: number
  xHi?: number
  yLo?: number
  yHi?: number
}

export interface ScatterData {
  points: ScatterPoint[]
  /** axis labels from the contrast sides (e.g. "E28 | DMSO") */
  xLabel: string
  yLabel: string
  guide?: ScatterGuide
}

export interface ScatterOptions {
  displayMap?: Record<string, string>
}

/** Must match contrast.ts's marginal cutoff so the drawn box matches the colouring. */
const SCATTER_Q = 0.01

const avg = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
const stdev = (a: number[]): number => {
  const m = avg(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, a.length - 1))
}

/** Effective BH threshold |z| — the least-extreme gene that still passes, so the drawn
 *  boundary lands exactly where the significance calls flip (omicViz `_bh_z_thresh`). */
function bhZThresh(vals: number[], mu: number, s: number): number {
  const z = vals.map((v) => (v - mu) / s)
  const q = benjaminiHochberg(z.map((v) => 2 * normalSf(Math.abs(v))))
  const sig = z.map((v) => Math.abs(v)).filter((_, i) => q[i] < SCATTER_Q)
  return sig.length ? Math.min(...sig) : studentTppf(1 - SCATTER_Q / 2, 1e6)
}

/** Build the guide for the contrast's relationship, read off the rows' `thrsh` label. */
function scatterGuide(pts: ScatterPoint[], thrsh: string): ScatterGuide | undefined {
  if (pts.length < 3) return undefined
  const x = pts.map((p) => p.x) // FC2
  const y = pts.map((p) => p.y) // FC1

  if (thrsh.startsWith('ols')) {
    const n = x.length
    const xMean = avg(x)
    const Sxx = x.reduce((s, xi) => s + (xi - xMean) * (xi - xMean), 0)
    if (Sxx === 0) return undefined
    const yMean = avg(y)
    const beta1 = x.reduce((s, xi, i) => s + (xi - xMean) * (y[i] - yMean), 0) / Sxx
    const beta0 = yMean - beta1 * xMean
    const sse = y.reduce((s, yi, i) => {
      const d = yi - (beta0 + beta1 * x[i])
      return s + d * d
    }, 0)
    const sErr = Math.sqrt(sse / (n - 2))
    if (!(sErr > 0)) return undefined
    const tCrit = studentTppf(0.995, n - 2)
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
      // Centre the band on the LINE OF IDENTITY: for a correlated contrast the null
      // expectation is "the same response on both sides", so y = x is the meaningful
      // reference rather than the fitted line. The half-width is still the OLS 99%
      // prediction band, so the envelope's width reflects the observed scatter.
      const yi = xi
      const hw = tCrit * sErr * Math.sqrt(1 + 1 / n + ((xi - xMean) * (xi - xMean)) / Sxx)
      xs.push(xi)
      fit.push(yi)
      up.push(yi + hw)
      dn.push(yi - hw)
    }
    return {
      kind: 'ols',
      fit: { x: xs, y: fit },
      upper: { x: xs, y: up },
      lower: { x: xs, y: dn }
    }
  }

  // marginal (independent): robust centre ± effective BH boundary on each axis → 9 zones
  const muX = median(x)
  const muY = median(y)
  const sX = madNormal(x) || stdev(x) || 1
  const sY = madNormal(y) || stdev(y) || 1
  const zX = bhZThresh(x, muX, sX)
  const zY = bhZThresh(y, muY, sY)
  return {
    kind: 'marginal',
    xLo: muX - zX * sX,
    xHi: muX + zX * sX,
    yLo: muY - zY * sY,
    yHi: muY + zY * sY
  }
}

/** Build FC1-vs-FC2 scatter points from contrast rows (identity line drawn by the view). */
export function buildScatter(rows: ContrastResultRow[], opts: ScatterOptions = {}): ScatterData {
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
  return {
    points,
    xLabel: `log₂FC · ${rows[0]?.cmp2 ?? 'FC2'}`,
    yLabel: `log₂FC · ${rows[0]?.cmp1 ?? 'FC1'}`,
    guide: scatterGuide(points, thrsh)
  }
}

/**
 * Intensity scatter from a COMPARISON's group means — the two sides' raw abundances
 * plotted against each other (log10), e.g. basal clpP vs WT from a direct `clpP | WT`
 * comparison restricted to vehicle. Mirrors omicViz, where this comes from a
 * `type: direct` entry (`filter: {cmpd: H2O}`, `strain: [[clpP, WT]]`): the direct output
 * already carries mean1/mean2, so no extra statistics are needed — the comparison's own
 * signf/effect colours the divergent genes and the line of identity is the reference.
 */
export function buildIntensityScatter(
  rows: CompareResultRow[],
  opts: ScatterOptions = {}
): ScatterData {
  const points: ScatterPoint[] = []
  for (const r of rows) {
    // mean1/mean2 are linear-space group means (numerator / denominator).
    if (r.mean1 == null || r.mean2 == null || !(r.mean1 > 0) || !(r.mean2 > 0)) continue
    const y = Math.log10(r.mean1)
    const x = Math.log10(r.mean2)
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
    xLabel: `log₁₀ intensity · ${den || 'denominator'}`,
    yLabel: `log₁₀ intensity · ${num || 'numerator'}`
  }
}

// ── MA (compare) ────────────────────────────────────────────────────────────────

export interface MAPoint {
  x: number // mean log2 abundance A
  y: number // log2FC (M)
  label: string
  effect: Effect
  uniqID: string
}
export interface MAData {
  points: MAPoint[]
  fcLow: number
  fcHigh: number
}
export interface MAOptions {
  fcLow: number
  fcHigh: number
  displayMap?: Record<string, string>
}

/** MA plot: mean log2 abundance (A) vs log2 fold change (M). */
export function buildMA(rows: CompareResultRow[], opts: MAOptions): MAData {
  const points: MAPoint[] = []
  for (const r of rows) {
    if (r.log2FC == null || r.mean1 == null || r.mean2 == null || r.mean1 <= 0 || r.mean2 <= 0)
      continue
    const a = 0.5 * (Math.log2(r.mean1) + Math.log2(r.mean2))
    if (!Number.isFinite(a) || !Number.isFinite(r.log2FC)) continue
    points.push({
      x: a,
      y: r.log2FC,
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      effect: r.effect,
      uniqID: r.uniqID
    })
  }
  return { points, fcLow: opts.fcLow, fcHigh: opts.fcHigh }
}

// ── dose/time-response (compare) ─────────────────────────────────────────────────

export interface DRSeries {
  uniqID: string
  label: string
  points: { x: number; y: number }[]
}
export interface DRData {
  /** every gene, most-differential first; the view draws all as faint background
   *  lines and colors the leading `highlight` of them */
  series: DRSeries[]
  axis: 'dose' | 'time'
  /** how many leading (top differential) series to color/highlight */
  highlight: number
  /** total genes available (for a "top N of M" note) */
  total: number
}
export interface DROptions {
  axis: 'dose' | 'time'
  topGenes: number
  displayMap?: Record<string, string>
  /** focus genes (uniqIDs): when non-empty, colour exactly these curves instead of top-N */
  focus?: string[]
}

/**
 * Bubble/dumbbell put one gene per axis category, so they can't show thousands of
 * genes without Plotly choking (~2000 categories/shapes freezes the renderer). When
 * "all" is requested (topGenes ≤ 0) cap to a safe count; an explicit topGenes overrides
 * it. DR/TR instead show every gene as a faint background line and only color the top-N
 * (see buildDR/DRView), so they never need a cap.
 */
const BUBBLE_DUMBBELL_CAP = 100
const geneLimit = (topGenes: number, total: number, cap = BUBBLE_DUMBBELL_CAP): number =>
  topGenes > 0 ? topGenes : Math.min(total, cap)

/** |log2FC| at the TOP dose/time (the highest axis value). Points are x-sorted ascending before
 *  this is used, so the last point is the top of the axis — genes most differential there rank first. */
const topDoseMag = (pts: { y: number }[]): number => (pts.length ? Math.abs(pts[pts.length - 1].y) : 0)

/** Response curves: log2FC vs dose (or time), one line per gene, top-N by |log2FC| at the top dose. */
export function buildDR(rows: CompareResultRow[], opts: DROptions): DRData {
  const byGene = new Map<string, { x: number; y: number }[]>()
  for (const r of rows) {
    const x = opts.axis === 'dose' ? r.dose : r.time
    if (x == null || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    let arr = byGene.get(r.uniqID)
    if (!arr) {
      arr = []
      byGene.set(r.uniqID, arr)
    }
    arr.push({ x, y: r.log2FC })
  }
  const series: DRSeries[] = []
  for (const [uniqID, pts] of byGene) {
    if (new Set(pts.map((p) => p.x)).size < 2) continue // needs ≥2 axis points to be a curve
    pts.sort((a, b) => a.x - b.x)
    series.push({ uniqID, label: opts.displayMap?.[uniqID] ?? uniqID, points: pts })
  }
  series.sort((a, b) => topDoseMag(b.points) - topDoseMag(a.points))
  // Focus genes (when set) override top-N: pull them to the front (in focus order) and
  // colour exactly them; the rest stay as faint background lines.
  const focus = opts.focus ?? []
  if (focus.length > 0) {
    const order = new Map(focus.map((id, i) => [id, i]))
    const inFocus = series.filter((s) => order.has(s.uniqID))
    inFocus.sort((a, b) => (order.get(a.uniqID) ?? 0) - (order.get(b.uniqID) ?? 0))
    const rest = series.filter((s) => !order.has(s.uniqID))
    return {
      series: [...inFocus, ...rest],
      axis: opts.axis,
      highlight: inFocus.length,
      total: series.length
    }
  }
  // Show every gene (as faint background lines); topGenes controls only how many of the
  // most-differential are colored on top. All genes stay in one merged view trace. topGenes ≤ 0
  // (unset) defaults to the leading 10 rather than colouring nothing — an all-grey plot is never
  // what's wanted here.
  return {
    series,
    axis: opts.axis,
    highlight: opts.topGenes > 0 ? opts.topGenes : 10,
    total: series.length
  }
}

// ── bubble (compare) ─────────────────────────────────────────────────────────────

export interface BubblePoint {
  x: number // dose or time
  gene: string
  uniqID: string
  log2FC: number // → dot fill color (diverging)
  sig: number // −log10 p significance → dot size
  effect: Effect
  signf: boolean
}
export interface BubbleData {
  points: BubblePoint[]
  genes: string[] // gene axis order as uniqIDs (unique — so same-named genes stay distinct rows)
  geneLabels: string[] // display names aligned to `genes`, for the axis tick labels
  axis: 'dose' | 'time'
  /** total genes available before the cap (for a "top N of M" note) */
  total: number
}
export interface BubbleOptions {
  axis: 'dose' | 'time'
  topGenes: number
  displayMap?: Record<string, string>
  /** focus genes (uniqIDs): when non-empty, show exactly these genes instead of top-N */
  focus?: string[]
  /** linked-selection genes (uniqIDs) appended after the chosen set, so a hovered/pinned
   *  gene shows up alongside the top-N (or GOI) rather than replacing it */
  extra?: string[]
}

/** Bubble grid: genes × dose(or time), dot color = log2FC, size = |log2FC| (view). Top-N genes
 *  are picked (and ordered) by their log2FC at the TOP dose/time level — the same "most
 *  differential at the max dose" ranking DR/TR use — not by their peak across all levels. */
export function buildBubble(rows: CompareResultRow[], opts: BubbleOptions): BubbleData {
  const topX = new Map<string, number>() // the highest dose/time level seen per gene
  const topAbs = new Map<string, number>() // |log2FC| at that top level — which genes to keep
  const topSigned = new Map<string, number>() // signed log2FC at the top level — gene axis order
  const byGene = new Map<string, CompareResultRow[]>()
  for (const r of rows) {
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    const x = opts.axis === 'dose' ? r.dose : r.time
    if (x != null && Number.isFinite(x)) {
      const cur = topX.get(r.uniqID)
      if (cur == null || x > cur) {
        topX.set(r.uniqID, x)
        topAbs.set(r.uniqID, Math.abs(r.log2FC))
        topSigned.set(r.uniqID, r.log2FC)
      }
    }
    let arr = byGene.get(r.uniqID)
    if (!arr) {
      arr = []
      byGene.set(r.uniqID, arr)
    }
    arr.push(r)
  }
  const ranked = [...topAbs.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
  // Focus genes (when set) override top-N: keep exactly those present in the data.
  const focus = opts.focus ?? []
  const base =
    focus.length > 0
      ? focus.filter((id) => byGene.has(id))
      : ranked.slice(0, geneLimit(opts.topGenes, ranked.length, 20)) // unset ⇒ top 20
  // Order the chosen genes by their top-level log2FC (descending) for the gene axis.
  base.sort((a, b) => (topSigned.get(b) ?? 0) - (topSigned.get(a) ?? 0))
  // Append linked-selection genes not already shown (kept in their own FC order), so a
  // hovered/pinned gene lands at the end of the axis instead of reshuffling the rest.
  const baseSet = new Set(base)
  const extra = (opts.extra ?? [])
    .filter((id) => byGene.has(id) && !baseSet.has(id))
    .sort((a, b) => (topSigned.get(b) ?? 0) - (topSigned.get(a) ?? 0))
  const top = [...base, ...extra]
  const points: BubblePoint[] = []
  for (const g of top) {
    const label = opts.displayMap?.[g] ?? g
    for (const r of byGene.get(g) ?? []) {
      const x = opts.axis === 'dose' ? r.dose : r.time
      if (x == null || r.log2FC == null) continue
      points.push({
        x,
        gene: label,
        uniqID: g,
        log2FC: r.log2FC,
        sig: r.pP ?? 0,
        effect: r.effect,
        signf: r.signf
      })
    }
  }
  return {
    points,
    genes: top, // uniqIDs — the axis category keys (unique per feature)
    geneLabels: top.map((g) => opts.displayMap?.[g] ?? g),
    axis: opts.axis,
    total: ranked.length
  }
}

// ── dumbbell (contrast) ──────────────────────────────────────────────────────────

export interface DumbbellRow {
  label: string
  uniqID: string
  fc1: number
  fc2: number
  signf: boolean
  effect: string
}
export interface DumbbellData {
  rows: DumbbellRow[]
  xLabel1: string
  xLabel2: string
  /** total genes available before the cap (for a "top N of M" note) */
  total: number
}
export interface DumbbellOptions {
  topGenes: number
  displayMap?: Record<string, string>
  /** focus genes (uniqIDs): when non-empty, show exactly these genes instead of top-N */
  focus?: string[]
  /** linked-selection genes (uniqIDs) appended after the chosen set (hover/pin highlight) */
  extra?: string[]
}

/** Dumbbell: FC1 vs FC2 per gene as connected dots. Only SIGNIFICANT genes are shown (top-N by
 *  |FCdiff|); an explicit focus/GOI pick or a linked selection still surfaces any gene. */
export function buildDumbbell(rows: ContrastResultRow[], opts: DumbbellOptions): DumbbellData {
  const valid = rows.filter((r) => r.FC1 != null && r.FC2 != null)
  valid.sort((a, b) => Math.abs(b.FCdiff ?? 0) - Math.abs(a.FCdiff ?? 0))
  const sig = valid.filter((r) => r.signf)
  const focus = opts.focus ?? []
  const focusSet = new Set(focus)
  const base =
    focus.length > 0
      ? valid.filter((r) => focusSet.has(r.uniqID))
      : sig.slice(0, geneLimit(opts.topGenes, sig.length, 20)) // significant only; unset ⇒ top 20
  // Append linked-selection genes not already shown (hover/pin highlight), preserving the
  // |FCdiff| order, so a selected gene appears at the end of the list instead of replacing.
  const baseIds = new Set(base.map((r) => r.uniqID))
  const extraIds = new Set((opts.extra ?? []).filter((id) => !baseIds.has(id)))
  const top = [...base, ...valid.filter((r) => extraIds.has(r.uniqID))]
  return {
    rows: top.map((r) => ({
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      uniqID: r.uniqID,
      fc1: r.FC1 as number,
      fc2: r.FC2 as number,
      signf: r.signf,
      effect: r.effect
    })),
    xLabel1: rows[0]?.cmp1 ?? 'FC1',
    xLabel2: rows[0]?.cmp2 ?? 'FC2',
    total: sig.length
  }
}

// ── TDR: time-series dose-response for one gene (compare) ────────────────────────

export interface TdrSeries {
  /** time value as a label (one line per time level) */
  time: string
  points: { x: number; y: number }[]
}
export interface TdrData {
  gene: string
  uniqID: string
  /** one line per time level, x = dose, y = log2FC */
  series: TdrSeries[]
}

/** One gene's dose×time response: x = dose, a line per time level, y = log2FC. */
export function buildTdr(
  rows: CompareResultRow[],
  uniqID: string,
  displayMap?: Record<string, string>
): TdrData {
  const byTime = new Map<number, { x: number; y: number }[]>()
  for (const r of rows) {
    if (r.uniqID !== uniqID) continue
    if (r.dose == null || r.time == null || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    let arr = byTime.get(r.time)
    if (!arr) {
      arr = []
      byTime.set(r.time, arr)
    }
    arr.push({ x: r.dose, y: r.log2FC })
  }
  const series: TdrSeries[] = [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, pts]) => ({ time: String(t), points: pts.sort((a, b) => a.x - b.x) }))
  return { gene: displayMap?.[uniqID] ?? uniqID, uniqID, series }
}

// ── gene bar: one gene's standardized value across every condition ───────────────

export interface GeneBarValue {
  cond: string
  gene: string
  uniqID: string
  /** central value (arithmetic mean, or geometric mean when log): the bar height. null when
   *  this condition has no finite value (missing → NaN). */
  mean: number | null
  /** spread on the working scale (linear sd, or log10 sd when log) — informational */
  sd: number
  /** error-bar lengths above/below `mean` in the data's native units. Symmetric (= sd) for
   *  linear; asymmetric for log (a symmetric log spread maps to unequal linear whiskers). */
  errUp: number
  errDown: number
  n: number
}
export interface GeneBarData {
  bars: GeneBarValue[]
  /** condition x-axis order */
  conds: string[]
  /** genes present (for the legend / series order) */
  genes: { uniqID: string; label: string }[]
}

/** Focus genes' standardized values across every condition (mean ± sd over replicates),
 *  one grouped series per gene. */
export function buildGeneBar(
  rows: StandardRow[],
  uniqIDs: string[],
  displayMap?: Record<string, string>,
  /** log-scaled data → compute the central value and spread in log10 space (geometric mean ±
   *  geometric sd), matching the log value axis / colour map. */
  log = false
): GeneBarData {
  const want = new Set(uniqIDs)
  const byKey = new Map<string, number[]>() // `${uniqID} ${cond}` → values
  const condOrder: string[] = []
  const condSeen = new Set<string>()
  const present = new Set<string>()
  for (const r of rows) {
    const cond = sampleCond(r)
    // The axis shows every condition in the data, so a gene missing a value in some condition
    // still keeps that slot on the axis (drawn as an empty NaN position).
    if (!condSeen.has(cond)) {
      condSeen.add(cond)
      condOrder.push(cond)
    }
    if (!want.has(r.uniqID)) continue
    present.add(r.uniqID) // gene is in the data (listed even if every value is missing)
    if (r.value == null || !Number.isFinite(r.value)) continue
    const k = `${r.uniqID} ${cond}`
    let arr = byKey.get(k)
    if (!arr) {
      arr = []
      byKey.set(k, arr)
    }
    arr.push(r.value)
  }
  condOrder.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const genes = uniqIDs
    .filter((id) => present.has(id))
    .map((id) => ({ uniqID: id, label: displayMap?.[id] ?? id }))
  const bars: GeneBarValue[] = []
  for (const { uniqID, label } of genes) {
    for (const cond of condOrder) {
      const vals = byKey.get(`${uniqID} ${cond}`)
      // No finite replicate here → a missing bar (mean null): the view leaves the position
      // empty and labels it NaN.
      if (!vals || vals.length === 0) {
        bars.push({ cond, gene: label, uniqID, mean: null, sd: 0, errUp: 0, errDown: 0, n: 0 })
        continue
      }
      // Log data: geometric mean ± geometric sd — compute in log10 space, then map back, so the
      // whiskers are symmetric on the log axis and the lower one never crosses zero. Linear data:
      // arithmetic mean ± sample sd (symmetric).
      const stat = log ? vals.map((v) => Math.log10(v)) : vals
      const m = stat.reduce((s, v) => s + v, 0) / stat.length
      const variance =
        stat.length > 1
          ? stat.reduce((s, v) => s + (v - m) * (v - m), 0) / (stat.length - 1)
          : 0
      const sd = Math.sqrt(variance)
      if (log) {
        const center = Math.pow(10, m)
        bars.push({
          cond,
          gene: label,
          uniqID,
          mean: center,
          sd,
          errUp: Math.pow(10, m + sd) - center,
          errDown: center - Math.pow(10, m - sd),
          n: vals.length
        })
      } else {
        bars.push({ cond, gene: label, uniqID, mean: m, sd, errUp: sd, errDown: sd, n: vals.length })
      }
    }
  }
  return { bars, conds: condOrder, genes }
}

// ── cluster / sample embedding (standardize) ─────────────────────────────────────

/** Per-point condition values, so the view can drive multi-condition (complex-legend)
 *  aesthetics — colour by a qualitative condition, shade/arrow by a quantitative one. */
export interface ClusterMeta {
  strain: string
  cmpd: string
  dose: number | null
  time: number | null
}
export interface ClusterPoint {
  x: number
  y: number
  /** full identity of this point (sample incl. replicate, or condition) */
  sample: string
  /** color group value (the colorBy condition) */
  group: string
  /** condition identity without the replicate — replicates of one condition share
   *  it, so the view can collapse them to a centroid + territory. */
  cond: string
  /** condition values, for the view's complex-legend aesthetics */
  meta: ClusterMeta
}
export interface ClusterData {
  points: ClusterPoint[]
  method: ClusterMethod
  /** PCA only: variance fraction on each axis ([0, 0] for UMAP/t-SNE). */
  varExplained: [number, number]
  colorBy: ConditionKey
  /** What the embedding actually ran on, for a diagnostic caption (scree = variance fraction of
   *  each PC, descending; PCA only). `transform` = the log applied ('log2'|'log10'|'linear');
   *  `range` = raw value [min, max]. */
  diag?: {
    items: number
    features: number
    missingPct: number
    scree?: number[]
    transform?: string
    range?: [number, number]
  }
}
export interface ClusterOptions {
  method: ClusterMethod
  colorBy: ConditionKey
  /** Per-gene scaling before embedding. 'unit' z-scores each gene to unit variance
   *  (correlation PCA — every gene weighted equally). 'none' only mean-centers each gene, so
   *  high-variance genes keep their weight (covariance PCA — matches tools like Spectronaut).
   *  Defaults to 'unit'. */
  scale?: 'unit' | 'none'
  /** Missing-value policy. 'impute' fills each gene's gaps with its mean (keeps every gene, but
   *  flattens genes detected in only some samples). 'complete' drops any gene with a missing value
   *  in any item (Spectronaut-style — no imputation). Defaults to 'impute'. */
  missing?: 'impute' | 'complete'
  /** Per-sample normalization before embedding (standardize path only). 'median' subtracts each
   *  sample's median (offset). 'zscore' also divides by each sample's SD (per-sample standardization
   *  — removes scale too, like Pearson correlation). 'quantile' forces a common distribution.
   *  'none' leaves the log2 values as-is. Defaults to 'median'. */
  center?: 'median' | 'zscore' | 'quantile' | 'none'
  /** Feature selection: run the embedding on only the N most-variable genes (0 / undefined = all).
   *  With p ≫ n, restricting to the most variable proteins keeps the sample covariance from going
   *  isotropic, so a real group axis dominates PC1 instead of being buried in noise dimensions. */
  topVar?: number
  /** Log transform (standardize path). 'auto' logs only raw-looking intensity (positive, ≥2
   *  decades); 'log2'/'log10' force it; 'none' forces linear. A wrong auto-guess (PCA on linear
   *  intensity) is a common cause of a flat scree. Defaults to 'auto'. */
  transform?: 'auto' | 'log2' | 'log10' | 'none'
  /** Replicate handling (standardize path). 'individual' embeds every replicate; 'mean' averages
   *  replicates to condition means first, cutting per-protein noise so a real group axis rises above
   *  the noise floor. Defaults to 'individual'. */
  replicates?: 'individual' | 'mean'
}

/** Pull the four condition values off a standardized/compare row into a ClusterMeta. Numeric
 *  dose/time are coerced to numbers (null when absent); strain/cmpd stay strings. */
function clusterMetaOf(row: Record<string, unknown> | object): ClusterMeta {
  const r = row as Record<string, unknown>
  const num = (v: unknown): number | null =>
    v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  return {
    strain: r.strain != null ? String(r.strain) : '',
    cmpd: r.cmpd != null ? String(r.cmpd) : '',
    dose: num(r.dose),
    time: num(r.time)
  }
}

/** Core embedding: given a genes×items log2 matrix (NaN = missing) and per-item
 *  labels/colors, z-score each gene (center + scale to unit SD, mean-imputing missing),
 *  transpose to items×genes, and embed to 2-D. Shared by the sample (standardize) and
 *  responsome (compare) paths. */
function embedMatrix(
  M: number[][],
  items: Array<{ label: string; group: string; cond: string; meta: ClusterMeta }>,
  opts: ClusterOptions
): ClusterData {
  const nItems = items.length
  // Missing-value fraction across the full gene×item matrix — reported so a flat scree can be
  // diagnosed (heavy missingness + mean-imputation is a common cause).
  let missCnt = 0
  let cellCnt = 0
  for (const row of M)
    for (let s = 0; s < nItems; s++) {
      cellCnt++
      if (!Number.isFinite(row[s])) missCnt++
    }
  const missingPct = cellCnt ? (100 * missCnt) / cellCnt : 0
  // 'complete' (Spectronaut-style): drop any gene with a gap in any item, so PCA runs on fully
  // quantified proteins with no imputation. 'impute' (default): keep every gene (gaps filled with
  // the gene mean below).
  let Mused =
    (opts.missing ?? 'complete') === 'complete'
      ? M.filter((row) => row.every((v) => Number.isFinite(v)))
      : M
  // Feature selection: keep only the `topVar` most-variable genes (by log2 variance across items).
  // With p ≫ n, the many low-signal genes make the sample covariance nearly isotropic, so every PC
  // gets ~1/(n−1) of the variance and a real group axis is buried; restricting to the most variable
  // proteins (standard proteomics PCA practice) concentrates the variance on the informative axes.
  const topVar = opts.topVar ?? 0
  if (topVar > 0 && Mused.length > topVar) {
    const geneVar = (row: number[]): number => {
      let sum = 0
      let cnt = 0
      for (let s = 0; s < nItems; s++)
        if (Number.isFinite(row[s])) {
          sum += row[s]
          cnt++
        }
      if (cnt < 2) return 0
      const mean = sum / cnt
      let ss = 0
      for (let s = 0; s < nItems; s++) if (Number.isFinite(row[s])) ss += (row[s] - mean) ** 2
      return ss / (cnt - 1)
    }
    Mused = Mused.map((row) => ({ row, v: geneVar(row) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, topVar)
      .map((e) => e.row)
  }
  const nG = Mused.length
  if (nItems < 2 || nG < 1) {
    return {
      points: [],
      method: opts.method,
      varExplained: [0, 0],
      colorBy: opts.colorBy,
      diag: { items: nItems, features: nG, missingPct }
    }
  }
  // Center each gene across items (subtract the gene mean), and — in 'unit' mode — divide by its
  // SD so every gene contributes equally to the embedding (correlation PCA: a high-variance
  // protein no longer dominates). In 'none' mode we only center, keeping each gene's native
  // variance so high-variance discriminators dominate (covariance PCA — matches Spectronaut).
  // Missing → 0 (the centered mean); a constant gene (SD 0) in 'unit' mode → all 0.
  const unit = (opts.scale ?? 'none') === 'unit'
  for (let g = 0; g < nG; g++) {
    const row = Mused[g]
    let sum = 0
    let cnt = 0
    for (let s = 0; s < nItems; s++)
      if (Number.isFinite(row[s])) {
        sum += row[s]
        cnt++
      }
    const mean = cnt ? sum / cnt : 0
    let ss = 0
    for (let s = 0; s < nItems; s++) if (Number.isFinite(row[s])) ss += (row[s] - mean) ** 2
    const sd = cnt > 1 ? Math.sqrt(ss / (cnt - 1)) : 0
    const denom = unit ? sd : 1
    for (let s = 0; s < nItems; s++)
      row[s] = Number.isFinite(row[s]) && denom > 0 ? (row[s] - mean) / denom : 0
  }
  // items×genes matrix D = Mᵀ, fed to the chosen embedding.
  const D: number[][] = Array.from({ length: nItems }, (_, s) => Mused.map((geneRow) => geneRow[s]))
  const { coords, varExplained, scree } = embed2D(D, opts.method)
  const points: ClusterPoint[] = items.map((it, i) => ({
    x: coords[i][0],
    y: coords[i][1],
    sample: it.label,
    group: it.group,
    cond: it.cond,
    meta: it.meta
  }))
  return {
    points,
    method: opts.method,
    varExplained,
    colorBy: opts.colorBy,
    diag: { items: nItems, features: nG, missingPct, scree }
  }
}

/** Per-sample (column) normalization of a genes×samples matrix, in place. NaN = missing (skipped).
 *  'median': subtract each column's median. 'zscore': subtract mean and divide by SD (per-sample
 *  standardization — removes offset AND scale, like Pearson). 'quantile': map every column to a
 *  common reference distribution (the average of the columns' sorted values, rank-interpolated to
 *  handle unequal missingness). 'none': leave untouched. */
function normalizeSamples(
  M: number[][],
  nSamp: number,
  mode: 'median' | 'zscore' | 'quantile' | 'none'
): void {
  if (mode === 'none') return
  const nG = M.length
  if (mode === 'quantile') {
    // Reference distribution on a fixed quantile grid, averaged across columns.
    const Q = 256
    const ref = new Float64Array(Q)
    let usedCols = 0
    const colSorted: number[][] = []
    for (let c = 0; c < nSamp; c++) {
      const col: number[] = []
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) col.push(M[g][c])
      col.sort((a, b) => a - b)
      colSorted.push(col)
      if (col.length < 2) continue
      usedCols++
      for (let q = 0; q < Q; q++) ref[q] += quantileAt(col, q / (Q - 1))
    }
    if (usedCols === 0) return
    for (let q = 0; q < Q; q++) ref[q] /= usedCols
    // Map each finite value to the reference at its within-column fractional rank.
    for (let c = 0; c < nSamp; c++) {
      const col = colSorted[c]
      const m = col.length
      if (m < 2) continue
      for (let g = 0; g < nG; g++) {
        const v = M[g][c]
        if (!Number.isFinite(v)) continue
        // fractional rank of v within the sorted column (ties → average position)
        let lo = 0
        let hi = m
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (col[mid] < v) lo = mid + 1
          else hi = mid
        }
        let hi2 = lo
        while (hi2 < m && col[hi2] === v) hi2++
        const rank = (lo + hi2 - 1) / 2
        M[g][c] = quantileAtGrid(ref, m > 1 ? rank / (m - 1) : 0.5)
      }
    }
    return
  }
  for (let c = 0; c < nSamp; c++) {
    let sum = 0
    let cnt = 0
    for (let g = 0; g < nG; g++)
      if (Number.isFinite(M[g][c])) {
        sum += M[g][c]
        cnt++
      }
    if (cnt === 0) continue
    if (mode === 'zscore') {
      const mean = sum / cnt
      let ss = 0
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) ss += (M[g][c] - mean) ** 2
      const sd = cnt > 1 ? Math.sqrt(ss / (cnt - 1)) : 0
      for (let g = 0; g < nG; g++)
        if (Number.isFinite(M[g][c])) M[g][c] = sd > 0 ? (M[g][c] - mean) / sd : 0
    } else {
      // median
      const col: number[] = []
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) col.push(M[g][c])
      col.sort((a, b) => a - b)
      const h = col.length >> 1
      const med = col.length % 2 ? col[h] : (col[h - 1] + col[h]) / 2
      for (let g = 0; g < nG; g++) if (Number.isFinite(M[g][c])) M[g][c] -= med
    }
  }
}

/** Value at fractional position t∈[0,1] of an ascending array (linear interpolation). */
function quantileAt(sorted: number[], t: number): number {
  const n = sorted.length
  if (n === 0) return 0
  if (n === 1) return sorted[0]
  const pos = t * (n - 1)
  const i = Math.floor(pos)
  const f = pos - i
  return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i]
}

/** Value at fractional position t∈[0,1] of an ascending Float64Array grid (linear interpolation). */
function quantileAtGrid(grid: Float64Array, t: number): number {
  const n = grid.length
  const pos = Math.max(0, Math.min(1, t)) * (n - 1)
  const i = Math.floor(pos)
  const f = pos - i
  return i + 1 < n ? grid[i] * (1 - f) + grid[i + 1] * f : grid[i]
}

/** Average replicates to one row per (uniqID × condition), so the embedding runs on condition
 *  means instead of individual replicates. Replicate averaging cuts per-protein technical noise
 *  (~√n_rep), which in a noisy p ≫ n dataset can lift a real group axis well above the noise floor
 *  (a flat scree over individual replicates is a common symptom). */
function collapseReplicates(rows: StandardRow[]): StandardRow[] {
  const key = (r: StandardRow): string =>
    `${r.uniqID}${r.strain}${r.cmpd}${r.dose ?? ''}${r.time ?? ''}`
  const agg = new Map<string, { sum: number; n: number; proto: StandardRow }>()
  for (const r of rows) {
    if (r.value == null || !Number.isFinite(r.value)) continue
    const k = key(r)
    let a = agg.get(k)
    if (!a) agg.set(k, (a = { sum: 0, n: 0, proto: r }))
    a.sum += r.value
    a.n++
  }
  return [...agg.values()].map((a) => ({ ...a.proto, rep: 1, value: a.sum / a.n }))
}

/** Sample embedding (PCA / UMAP / t-SNE) from the standardized genes×samples log2
 *  matrix — one point per sample, colored by a condition. */
export function buildCluster(rows: StandardRow[], opts: ClusterOptions): ClusterData {
  if ((opts.replicates ?? 'individual') === 'mean') rows = collapseReplicates(rows)
  const sampleIdx = new Map<string, number>()
  const sampleMeta: StandardRow[] = []
  const geneIdx = new Map<string, number>()
  for (const r of rows) {
    const s = sampleLabel(r)
    if (!sampleIdx.has(s)) {
      sampleIdx.set(s, sampleMeta.length)
      sampleMeta.push(r)
    }
    if (!geneIdx.has(r.uniqID)) geneIdx.set(r.uniqID, geneIdx.size)
  }
  // Only log2 the matrix when the values look like RAW intensity (all positive, ≥2 decades of
  // range) — the same heuristic the heatmap/QC/table use. If the standardized values are already
  // on a log scale, they're used as-is (double-logging would distort the embedding, and negative
  // log values would be dropped as NaN). NaN = missing.
  let min = Infinity
  let max = -Infinity
  for (const r of rows)
    if (r.value != null && Number.isFinite(r.value)) {
      if (r.value < min) min = r.value
      if (r.value > max) max = r.value
    }
  // Which log transform to apply. 'auto' (default) logs only when the values look like RAW
  // intensity (all positive, ≥2 decades of range) — matching the heatmap/QC/table; already-log
  // values are left as-is (double-logging distorts the embedding). 'log2'/'log10' force it (needed
  // when the auto guess is wrong — e.g. a narrow-range raw matrix reads as "already log" and PCA
  // then runs on linear intensities, which high-abundance proteins dominate). 'none' forces linear.
  const tOpt = opts.transform ?? 'auto'
  const applied: 'log2' | 'log10' | 'none' =
    tOpt === 'auto' ? (min > 0 && max / min >= 100 ? 'log2' : 'none') : tOpt
  const tf = (v: number): number =>
    applied === 'log2'
      ? v > 0
        ? Math.log2(v)
        : NaN
      : applied === 'log10'
        ? v > 0
          ? Math.log10(v)
          : NaN
        : v
  const M: number[][] = Array.from({ length: geneIdx.size }, () =>
    new Array(sampleMeta.length).fill(NaN)
  )
  for (const r of rows) {
    const v = r.value
    const lv = v != null && Number.isFinite(v) ? tf(v) : NaN
    M[geneIdx.get(r.uniqID) as number][sampleIdx.get(sampleLabel(r)) as number] = lv
  }
  // Per-sample (column) normalization, so per-run technical differences don't dominate the
  // embedding. 'median' subtracts each sample's median (removes an OFFSET only). 'zscore' also
  // divides by each sample's SD (removes SCALE too — the same per-sample standardization Pearson
  // correlation applies, so PCA reflects pattern rather than a sample's dynamic range). 'quantile'
  // forces every sample to a common distribution (the strongest normalization; matches tools that
  // quantile/median-normalize before PCA). 'none' leaves the log2 values untouched.
  normalizeSamples(M, sampleMeta.length, opts.center ?? 'none')
  const items = sampleMeta.map((meta) => ({
    label: sampleLabel(meta),
    group: String((meta as unknown as Record<string, unknown>)[opts.colorBy] ?? ''),
    cond: sampleCond(meta),
    meta: clusterMetaOf(meta)
  }))
  const out = embedMatrix(M, items, opts)
  // Record what the log decision was and the raw value range, so the caption can show whether the
  // PCA ran on log or linear values (a wrong auto-guess is a common cause of a flat scree).
  if (out.diag) out.diag.transform = applied === 'none' ? 'linear' : applied
  if (out.diag && Number.isFinite(min) && Number.isFinite(max)) out.diag.range = [min, max]
  return out
}

/** Condition key for a comparison row: its present context columns joined, e.g.
 *  "E28|10|24". Mirrors omicViz pca_response's `_cond`. */
function conditionLabel(r: CompareResultRow): string {
  return VALID_CONDITIONS.map((c) => (r as unknown as Record<string, unknown>)[c])
    .filter((v) => v !== '' && v != null)
    .join('|')
}

/** Responsome embedding: the same PCA / UMAP / t-SNE, but over a comparison's
 *  genes×conditions log2FC matrix — one point per condition (omicViz's pca_response),
 *  colored by a condition. Valid colour-by dims come from responseColorDims: the context
 *  conditions plus any comparison dim (e.g. cmpd in a multi-compound two-way ANOVA) that
 *  actually varies across the pooled comparisons. An invalid `colorBy` falls back to the
 *  first such dim; the effective choice is returned in `colorBy`. */
export function buildResponseCluster(rows: CompareResultRow[], opts: ClusterOptions): ClusterData {
  const contextDims = responseColorDims(rows)
  const colorBy = contextDims.includes(opts.colorBy)
    ? opts.colorBy
    : (contextDims[0] ?? opts.colorBy)
  const condIdx = new Map<string, number>()
  const condMeta: CompareResultRow[] = []
  const geneIdx = new Map<string, number>()
  for (const r of rows) {
    const c = conditionLabel(r)
    if (!condIdx.has(c)) {
      condIdx.set(c, condMeta.length)
      condMeta.push(r)
    }
    if (!geneIdx.has(r.uniqID)) geneIdx.set(r.uniqID, geneIdx.size)
  }
  // genes×conditions log2FC matrix (NaN for missing)
  const M: number[][] = Array.from({ length: geneIdx.size }, () =>
    new Array(condMeta.length).fill(NaN)
  )
  for (const r of rows) {
    const v = r.log2FC
    M[geneIdx.get(r.uniqID) as number][condIdx.get(conditionLabel(r)) as number] =
      v != null && Number.isFinite(v) ? v : NaN
  }
  const items = condMeta.map((meta) => {
    const label = conditionLabel(meta)
    // Each condition carries a single log2FC (no replicates), so cond == label —
    // centroid mode collapses to the point itself (the single-replicate fallback).
    return {
      label,
      group: String((meta as unknown as Record<string, unknown>)[colorBy] ?? ''),
      cond: label,
      meta: clusterMetaOf(meta)
    }
  })
  return embedMatrix(M, items, { ...opts, colorBy })
}

// ── heatmap ────────────────────────────────────────────────────────────────────

/** Per-sample condition values, for the annotation tracks along the sample axis. */
export interface SampleMeta {
  strain: string
  cmpd: string
  dose: number | null
  time: number | null
  rep: number | null
}

export interface HeatmapData {
  /** z[geneIndex][sampleIndex] — log2 intensity, null for missing */
  z: Array<Array<number | null>>
  /** sample column labels */
  x: string[]
  /** gene row labels */
  y: string[]
  /** per-sample condition values, aligned with `x` (one entry per sample column) */
  samples: SampleMeta[]
  /** conditions present in the data (with values), shown as annotation tracks in this order */
  conds: ConditionKey[]
}

export interface HeatmapOptions {
  displayMap?: Record<string, string>
  /** cap the number of genes shown (by variance); 0 = all */
  maxGenes?: number
  /** log10-transform intensities for display (default true) */
  log10?: boolean
  /** cluster gene rows (average-linkage, euclidean) so similar genes are adjacent
   *  (default true; mirrors omicViz's clustered heatmap) */
  cluster?: boolean
  /** when clustering, cut the dendrogram into this many groups and order the GROUPS by their mean
   *  (log10) value, high→low, keeping the clustering within each group (default 8). */
  clusterGroups?: number
  /** focus genes (uniqIDs): when non-empty, show exactly these rows instead of top-by-variance */
  focus?: string[]
}

function sampleLabel(r: StandardRow): string {
  const parts = [r.strain, r.cmpd, r.dose ?? '', r.time ?? '', r.rep != null ? `r${r.rep}` : '']
  return parts.filter((p) => p !== '').join('_')
}

/** Sample condition identity without the replicate — replicates of one condition
 *  share it, so the cluster can group them into a centroid. */
function sampleCond(r: StandardRow): string {
  return [r.strain, r.cmpd, r.dose ?? '', r.time ?? ''].filter((p) => p !== '').join('_')
}

/** Pivot the standardized long table into a genes × samples matrix for a heatmap. */
export function buildHeatmap(rows: StandardRow[], opts: HeatmapOptions = {}): HeatmapData {
  const log10 = opts.log10 ?? true
  const sampleOrder: string[] = []
  const sampleSeen = new Set<string>()
  const sampleMeta = new Map<string, SampleMeta>()
  const geneOrder: string[] = []
  const geneSeen = new Set<string>()
  const cells = new Map<string, number | null>() // `${gene} ${sample}` → value

  for (const r of rows) {
    const s = sampleLabel(r)
    if (!sampleSeen.has(s)) {
      sampleSeen.add(s)
      sampleOrder.push(s)
      sampleMeta.set(s, { strain: r.strain, cmpd: r.cmpd, dose: r.dose, time: r.time, rep: r.rep })
    }
    if (!geneSeen.has(r.uniqID)) {
      geneSeen.add(r.uniqID)
      geneOrder.push(r.uniqID)
    }
    let v: number | null = r.value
    if (v != null && Number.isFinite(v) && log10) v = v > 0 ? Math.log10(v) : null
    else if (v != null && !Number.isFinite(v)) v = null
    cells.set(`${r.uniqID} ${s}`, v)
  }

  // Order the sample columns by condition — strain, then cmpd, then dose, then time (then
  // replicate) — so samples sharing a strain/compound/dose block together, rather than appearing
  // in the raw data order.
  const strCmp = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const numCmp = (a: number | null, b: number | null): number =>
    a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a - b
  sampleOrder.sort((a, b) => {
    const ma = sampleMeta.get(a) as SampleMeta
    const mb = sampleMeta.get(b) as SampleMeta
    return (
      strCmp(ma.strain, mb.strain) ||
      strCmp(ma.cmpd, mb.cmpd) ||
      numCmp(ma.dose, mb.dose) ||
      numCmp(ma.time, mb.time) ||
      numCmp(ma.rep, mb.rep)
    )
  })

  // Focus genes (when set) override the variance cap: show exactly those rows.
  const focus = opts.focus ?? []
  let genes = geneOrder
  if (focus.length > 0) {
    const present = new Set(geneOrder)
    genes = focus.filter((g) => present.has(g))
  } else if (opts.maxGenes && opts.maxGenes > 0 && geneOrder.length > opts.maxGenes) {
    const variance = (g: string): number => {
      const vals: number[] = []
      for (const s of sampleOrder) {
        const v = cells.get(`${g} ${s}`)
        if (v != null && Number.isFinite(v)) vals.push(v)
      }
      if (vals.length < 2) return -1
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      return vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1)
    }
    genes = [...geneOrder].sort((a, b) => variance(b) - variance(a)).slice(0, opts.maxGenes)
  }

  let z = genes.map((g) => sampleOrder.map((s) => cells.get(`${g} ${s}`) ?? null))
  // Cluster gene rows so similar profiles sit together (omicViz's clustered heatmap).
  // Impute missing cells with the sample-column mean before clustering, matching
  // omicViz's `fillna(pivot.mean())`; the displayed z keeps its real nulls.
  if ((opts.cluster ?? true) && genes.length > 2) {
    const colMean = sampleOrder.map((_, c) => {
      let sum = 0
      let cnt = 0
      for (let r = 0; r < z.length; r++) {
        const v = z[r][c]
        if (v != null && Number.isFinite(v)) {
          sum += v
          cnt++
        }
      }
      return cnt > 0 ? sum / cnt : 0
    })
    const imputed = z.map((row) =>
      row.map((v, c) => (v != null && Number.isFinite(v) ? v : colMean[c]))
    )
    // Cluster, then cut into groups and order the GROUPS by mean (log10) value, high→low — the
    // within-group clustering (leaf order) is preserved. Each gene's value = mean of its real cells.
    const geneVal = (row: (number | null)[]): number => {
      let sum = 0
      let cnt = 0
      for (const v of row)
        if (v != null && Number.isFinite(v)) {
          sum += v
          cnt++
        }
      return cnt > 0 ? sum / cnt : -Infinity // all-missing genes sink to the bottom
    }
    const groups = clusterRowGroups(imputed, opts.clusterGroups ?? 8)
    groups.sort((ga, gb) => {
      const va = ga.reduce((s, i) => s + geneVal(z[i]), 0) / ga.length
      const vb = gb.reduce((s, i) => s + geneVal(z[i]), 0) / gb.length
      return vb - va // descending: highest-value group first (top)
    })
    const order = groups.flat()
    genes = order.map((i) => genes[i])
    z = order.map((i) => z[i])
  }

  const y = genes.map((g) => opts.displayMap?.[g] ?? g)
  const samples = sampleOrder.map(
    (s) => sampleMeta.get(s) ?? { strain: '', cmpd: '', dose: null, time: null, rep: null }
  )
  // Conditions that actually carry values become annotation tracks (strain/cmpd non-empty,
  // dose/time non-null across the samples); empty conditions are skipped.
  const conds = VALID_CONDITIONS.filter((c) =>
    c === 'strain' || c === 'cmpd'
      ? samples.some((m) => m[c] !== '')
      : samples.some((m) => m[c] != null)
  )
  return { z, x: sampleOrder, y, samples, conds }
}

// ── log2FC heatmap (compare): genes × comparison-columns, signed fold change ──────

export interface FcHeatmapData {
  /** gene display labels (row order) */
  genes: string[]
  /** gene uniqIDs, aligned to `genes` (for linked selection) */
  geneIds: string[]
  /** column labels — one per comparison × context */
  columns: string[]
  /** z[geneRow][col] = log2FC (null = missing) */
  z: Array<Array<number | null>>
  /** symmetric colour limit: max |log2FC| across the matrix (≥ tiny) */
  absMax: number
}

export interface FcHeatmapOptions {
  displayMap?: Record<string, string>
  /** cap to the top-N genes by max |log2FC| (0 = all); ignored when `focus` is set */
  maxGenes?: number
  /** focus genes (uniqIDs) — show exactly these rows when non-empty */
  focus?: string[]
  /** bicluster gene rows AND comparison columns by log2FC profile (default true) */
  cluster?: boolean
  /** keep only genes that are significant (`signf`) in ≥1 comparison column, AND drop columns
   *  with no significant cell (removes near-zero baseline stripes). Genes are ignored when
   *  `focus` is set (an explicit gene pick always shows); column pruning still applies. */
  differentialOnly?: boolean
}

/** Pivot a comparison result into a genes × (comparison × context) matrix of log2FC. Each column
 *  is one vehicle-normalised / compared condition; cells are the signed fold change. */
export function buildFcHeatmap(
  rows: CompareResultRow[],
  opts: FcHeatmapOptions = {}
): FcHeatmapData {
  // Context dims = present conditions that AREN'T the comparison axis (cmp_cond) — they distinguish
  // one comparison column from another alongside the `comparison` label.
  const consumed = new Set<string>()
  for (const r of rows) for (const p of r.cmp_cond.split(':')) if (p) consumed.add(p)
  const ctxDims = VALID_CONDITIONS.filter(
    (c) => !consumed.has(c) && rows.some((r) => r[c] != null && r[c] !== '')
  )
  const colLabel = (r: CompareResultRow): string =>
    [r.comparison, ...ctxDims.map((c) => `${c}=${r[c]}`)].join(' · ')

  const colOrder: string[] = []
  const colSeen = new Set<string>()
  const colSig = new Set<string>() // columns with ≥1 significant (signf) cell
  const geneOrder: string[] = []
  const geneSeen = new Set<string>()
  const diffGenes = new Set<string>() // genes significant (signf) in ≥1 comparison column
  const cells = new Map<string, Map<string, number | null>>() // gene → col → log2FC

  for (const r of rows) {
    const col = colLabel(r)
    if (!colSeen.has(col)) {
      colSeen.add(col)
      colOrder.push(col)
    }
    if (!geneSeen.has(r.uniqID)) {
      geneSeen.add(r.uniqID)
      geneOrder.push(r.uniqID)
    }
    if (r.signf) {
      diffGenes.add(r.uniqID)
      colSig.add(col)
    }
    let m = cells.get(r.uniqID)
    if (!m) {
      m = new Map()
      cells.set(r.uniqID, m)
    }
    m.set(col, r.log2FC != null && Number.isFinite(r.log2FC) ? r.log2FC : null)
  }
  const cellVal = (g: string, c: string): number | null => cells.get(g)?.get(c) ?? null

  // Differential mode also drops columns with no significant cell (e.g. the time=0 baseline
  // slab, low-dose columns) so the grid isn't dominated by near-zero "banding" stripes.
  let activeCols = opts.differentialOnly ? colOrder.filter((c) => colSig.has(c)) : colOrder

  const focus = opts.focus ?? []
  // Restrict to differential genes (significant somewhere) before top-N / clustering — an
  // explicit focus pick bypasses this and always shows.
  const universe = opts.differentialOnly ? geneOrder.filter((g) => diffGenes.has(g)) : geneOrder
  let genes = universe
  if (focus.length > 0) {
    const present = new Set(geneOrder)
    genes = focus.filter((g) => present.has(g))
  } else if (opts.maxGenes && opts.maxGenes > 0 && universe.length > opts.maxGenes) {
    const score = (g: string): number => {
      let mx = -1
      for (const c of activeCols) {
        const v = cellVal(g, c)
        if (v != null) mx = Math.max(mx, Math.abs(v))
      }
      return mx
    }
    genes = [...universe].sort((a, b) => score(b) - score(a)).slice(0, opts.maxGenes)
  }

  let z = genes.map((g) => activeCols.map((c) => cellVal(g, c)))
  // Bicluster — order BOTH gene rows and comparison columns by fold-change PROFILE so
  // co-regulated genes and co-varying conditions form visible blocks (pattern discovery).
  // Impute missing cells with the column mean, then z-score each vector before clustering:
  // raw euclidean is dominated by amplitude and sorts into a magnitude ramp that reads as
  // unclustered, whereas standardizing clusters by shape (up/down pattern). Columns are
  // reordered first, then rows. The displayed z keeps its real values/nulls; standardization
  // only drives the ordering. (Ordinal dose/time order is intentionally traded for pattern.)
  const zscore = (vec: number[]): number[] => {
    const mean = vec.reduce((a, b) => a + b, 0) / vec.length
    const sd = Math.sqrt(vec.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vec.length)
    return sd > 1e-9 ? vec.map((v) => (v - mean) / sd) : vec.map(() => 0)
  }
  if (opts.cluster ?? true) {
    const colMean = activeCols.map((_, ci) => {
      let sum = 0
      let cnt = 0
      for (let ri = 0; ri < z.length; ri++) {
        const v = z[ri][ci]
        if (v != null && Number.isFinite(v)) {
          sum += v
          cnt++
        }
      }
      return cnt > 0 ? sum / cnt : 0
    })
    let imputed = z.map((row) => row.map((v, ci) => (v != null && Number.isFinite(v) ? v : colMean[ci])))
    // Columns first: cluster on each column's gene-response profile (z-scored across genes).
    if (activeCols.length > 2 && genes.length > 1) {
      const colVecs = activeCols.map((_, ci) => zscore(imputed.map((row) => row[ci])))
      const corder = clusterRowOrder(colVecs)
      activeCols = corder.map((i) => activeCols[i])
      z = z.map((row) => corder.map((i) => row[i]))
      imputed = imputed.map((row) => corder.map((i) => row[i]))
    }
    // Rows: cluster on each gene's (now column-reordered) profile.
    if (genes.length > 2 && activeCols.length > 1) {
      const order = clusterRowOrder(imputed.map((row) => zscore(row)))
      genes = order.map((i) => genes[i])
      z = order.map((i) => z[i])
    }
  }

  let absMax = 0
  for (const row of z) for (const v of row) if (v != null && Number.isFinite(v)) absMax = Math.max(absMax, Math.abs(v))

  const dm = opts.displayMap ?? {}
  return {
    genes: genes.map((g) => dm[g] ?? g),
    geneIds: genes,
    columns: activeCols,
    z,
    absMax: absMax || 1
  }
}

// ── standardize QC (per-sample distributions) ─────────────────────────────────────

export type QcMetric = 'intensity' | 'cv' | 'proteins'

export interface QcGroup {
  /** sample / condition-group label (x-axis category) */
  label: string
  /** the metric's values for this group (distribution for intensity/CV; a single count for
   *  proteins). `bar` renders their summary; violin/box render the distribution. */
  values: number[]
}

export interface QcData {
  groups: QcGroup[]
  /** y-axis title for the chosen metric */
  yLabel: string
  metric: QcMetric
  /** bar height uses a per-group summary: 'median' (intensity/CV) or 'count' (proteins). */
  summary: 'median' | 'count'
}

/** Numeric-aware label sort so dose/time samples read in order (e.g. `dose=2` before `dose=10`). */
function qcLabelCmp(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Per-sample QC distributions for a standardized result, for the QC plot (violin/box/bar):
 *  - `intensity`: every protein's intensity in each sample (log10 when values look like raw
 *    intensity), so a box/violin per sample flags mis-normalised samples.
 *  - `proteins`: count of proteins identified per sample (one value → a bar per sample).
 *  - `cv`: per-protein %CV across replicates within each condition group (replicates pooled),
 *    so each condition's reproducibility is a distribution.
 * A "sample" is the active-condition combo + replicate; a CV "group" drops the replicate.
 */
export function buildQc(std: StandardizeResult, metric: QcMetric): QcData {
  const conds = std.activeConditions
  const parts = (r: StandardRow): string[] =>
    conds.map((c) => String(r[c] ?? '')).filter((x) => x !== '')
  const sampleLabel = (r: StandardRow): string => {
    const p = parts(r)
    if (r.rep != null) p.push(`r${r.rep}`)
    return p.join(' · ') || 'sample'
  }
  const condLabel = (r: StandardRow): string => parts(r).join(' · ') || 'all'
  const push = (m: Map<string, number[]>, k: string, v: number): void => {
    const a = m.get(k)
    if (a) a.push(v)
    else m.set(k, [v])
  }

  if (metric === 'proteins') {
    const count = new Map<string, number>()
    for (const r of std.rows)
      if (r.value != null && Number.isFinite(r.value))
        count.set(sampleLabel(r), (count.get(sampleLabel(r)) ?? 0) + 1)
    const groups = [...count]
      .map(([label, n]) => ({ label, values: [n] }))
      .sort((a, b) => qcLabelCmp(a.label, b.label))
    return { groups, yLabel: '# proteins', metric, summary: 'count' }
  }

  if (metric === 'intensity') {
    const map = new Map<string, number[]>()
    let min = Infinity
    let max = -Infinity
    for (const r of std.rows)
      if (r.value != null && Number.isFinite(r.value)) {
        push(map, sampleLabel(r), r.value)
        if (r.value < min) min = r.value
        if (r.value > max) max = r.value
      }
    // log10 the distribution when the values look like raw intensity (all positive, ≥2 decades),
    // matching the heatmap/table value scale.
    const log = min > 0 && max / min >= 100
    const groups = [...map]
      .map(([label, vals]) => ({ label, values: log ? vals.map((v) => Math.log10(v)) : vals }))
      .sort((a, b) => qcLabelCmp(a.label, b.label))
    return { groups, yLabel: log ? 'log₁₀ intensity' : 'intensity', metric, summary: 'median' }
  }

  // cv: per condition group, the %CV of each protein across its replicates.
  const byGroup = new Map<string, Map<string, number[]>>() // condLabel → uniqID → replicate values
  for (const r of std.rows)
    if (r.value != null && Number.isFinite(r.value)) {
      const gk = condLabel(r)
      let gm = byGroup.get(gk)
      if (!gm) {
        gm = new Map()
        byGroup.set(gk, gm)
      }
      push(gm, r.uniqID, r.value)
    }
  const groups = [...byGroup]
    .map(([label, geneMap]) => {
      const cvs: number[] = []
      for (const vals of geneMap.values()) {
        if (vals.length < 2) continue // CV needs ≥2 replicates
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length
        if (mean <= 0) continue
        const sd = Math.sqrt(
          vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1)
        )
        cvs.push((100 * sd) / mean)
      }
      return { label, values: cvs }
    })
    .sort((a, b) => qcLabelCmp(a.label, b.label))
  return { groups, yLabel: 'CV %', metric, summary: 'median' }
}

// ── standardize sample-correlation matrix ─────────────────────────────────────────

export interface CorrData {
  /** sample labels, in (optionally clustered) row/column order */
  labels: string[]
  /** symmetric correlation matrix z[i][j] = r(sample_i, sample_j); diagonal = 1 */
  z: number[][]
  /** smallest off-diagonal correlation (colour-scale floor) */
  min: number
}

/**
 * All-samples × all-samples Pearson correlation of a standardized result, for a QC
 * correlation heatmap. A "sample" is the active-condition combo + replicate; each pair is
 * correlated over the proteins present in BOTH (pairwise-complete, since per-sample dropout
 * makes a global complete-case intersection nearly empty at scale). Values are log10'd first
 * when they look like raw intensity (matching the heatmap/QC scale). Rows/cols are clustered
 * by correlation profile so replicate groups block along the diagonal (unless `cluster:false`).
 */
export function buildSampleCorr(
  std: StandardizeResult,
  opts: { cluster?: boolean } = {}
): CorrData {
  const conds = std.activeConditions
  const sampleLabel = (r: StandardRow): string => {
    const p = conds.map((c) => String(r[c] ?? '')).filter((x) => x !== '')
    if (r.rep != null) p.push(`r${r.rep}`)
    return p.join(' · ') || 'sample'
  }
  // Register samples and genes; find the value range for the log heuristic.
  const sampleIdx = new Map<string, number>()
  const geneIdx = new Map<string, number>()
  let labels: string[] = []
  let min = Infinity
  let max = -Infinity
  for (const r of std.rows) {
    if (r.value == null || !Number.isFinite(r.value)) continue
    if (!sampleIdx.has(sampleLabel(r))) {
      sampleIdx.set(sampleLabel(r), labels.length)
      labels.push(sampleLabel(r))
    }
    if (!geneIdx.has(r.uniqID)) geneIdx.set(r.uniqID, geneIdx.size)
    if (r.value < min) min = r.value
    if (r.value > max) max = r.value
  }
  const S = labels.length
  const G = geneIdx.size
  const log = min > 0 && max / min >= 100

  // Dense per-sample vectors over the gene axis (NaN = protein absent in that sample).
  const vecs = Array.from({ length: S }, () => new Float64Array(G).fill(NaN))
  for (const r of std.rows) {
    if (r.value == null || !Number.isFinite(r.value)) continue
    vecs[sampleIdx.get(sampleLabel(r))!][geneIdx.get(r.uniqID)!] = log
      ? Math.log10(r.value)
      : r.value
  }

  // Pairwise-complete Pearson r for every sample pair.
  let z = Array.from({ length: S }, () => new Array<number>(S).fill(1))
  let lo = 1
  for (let i = 0; i < S; i++) {
    const a = vecs[i]
    for (let j = i + 1; j < S; j++) {
      const b = vecs[j]
      let n = 0
      let sx = 0
      let sy = 0
      let sxx = 0
      let syy = 0
      let sxy = 0
      for (let k = 0; k < G; k++) {
        const x = a[k]
        const y = b[k]
        if (Number.isNaN(x) || Number.isNaN(y)) continue
        n++
        sx += x
        sy += y
        sxx += x * x
        syy += y * y
        sxy += x * y
      }
      const cov = n * sxy - sx * sy
      const vx = n * sxx - sx * sx
      const vy = n * syy - sy * sy
      const denom = Math.sqrt(vx * vy)
      const r = n >= 2 && denom > 0 ? cov / denom : 0
      z[i][j] = r
      z[j][i] = r
      if (r < lo) lo = r
    }
  }

  // Cluster samples by their correlation profile so replicate groups sit together; reorder
  // both axes symmetrically.
  if ((opts.cluster ?? true) && S > 2) {
    const order = clusterRowOrder(z)
    labels = order.map((i) => labels[i])
    z = order.map((i) => order.map((j) => z[i][j]))
  }

  return { labels, z, min: Number.isFinite(lo) ? lo : 0 }
}

// ── enrichment (over-representation analysis) ────────────────────────────────────

/** Which annotation term set to test. */
export type EnrichSource = 'go' | 'kegg'
/** Enrichment method. `ora` is over-representation (hypergeometric on the significant set);
 *  `gsea` is ranked gene-set enrichment (weighted running-sum over the log2FC-ranked list with
 *  gene-label permutation). */
export type EnrichMethod = 'ora' | 'gsea'

/** DB annotation column each source reads (see engine/ingest annotationMap). */
const ENRICH_COL: Record<EnrichSource, string> = { go: 'GO', kegg: 'keggPathway' }

export interface EnrichTerm {
  /** the GO term / KEGG pathway name */
  term: string
  /** ORA: query genes hitting the term (k). GSEA: leading-edge gene count. */
  count: number
  /** genes in the background / data annotated with this term (K) */
  setSize: number
  /** ORA: k / n (query fraction). GSEA: leading-edge / setSize. */
  geneRatio: number
  /** ORA: K / N (background fraction). GSEA: unused (0). */
  bgRatio: number
  /** ORA: fold enrichment (geneRatio / bgRatio). GSEA: unused (0). */
  fold: number
  /** nominal p-value (ORA: hypergeometric tail; GSEA: permutation) */
  pValue: number
  /** Benjamini–Hochberg FDR-adjusted p-value */
  pAdjust: number
  /** display names of the driving genes (ORA: query hits; GSEA: leading-edge genes) */
  genes: string[]
  /** uniqIDs of the driving genes, aligned to `genes` (for cross-view hover linking); GSEA only */
  geneIds?: string[]
  /** GSEA normalized enrichment score (sign = direction); undefined for ORA */
  nes?: number
  /** GSEA: the ranking metric (log2FC) of every member gene, for the ridgeline density */
  dist?: number[]
  /** GSEA: the ranking metric (log2FC) of the leading-edge genes, aligned to `genes` */
  leadingDist?: number[]
  /** KEGG top-level category (BRITE) of this pathway, when the source is KEGG and it's known */
  category?: string
}

export interface EnrichData {
  /** which analysis produced these terms */
  method: EnrichMethod
  /** up-regulated enrichment — ORA: enriched among up-significant genes; GSEA: positive-NES sets */
  up: EnrichTerm[]
  /** down-regulated enrichment — ORA: down-significant genes; GSEA: negative-NES sets */
  down: EnrichTerm[]
  source: EnrichSource
  /** ORA: annotated significant genes per direction. GSEA: sets tested per direction. */
  querySize: { up: number; down: number }
  /** ORA: annotated background genes N. GSEA: ranked genes N. */
  bgSize: number
  /** terms tested per direction (before the topTerms cap) */
  totalTested: { up: number; down: number }
  /** GSEA: the ranking metric (log2FC) of every ranked gene — the global reference distribution
   *  for the ridgeline plot. Undefined for ORA. */
  ranked?: number[]
}

export interface EnrichOptions {
  /** 'ora' (over-representation) or 'gsea' (ranked). Defaults to 'ora'. */
  method?: EnrichMethod
  source: EnrichSource
  /** how many top terms to keep per direction (<= 0 → default 15) */
  topTerms: number
  /** uniqID → { column → value } from the ID-map DB (carries GO / keggPathway) */
  annotationMap: Record<string, Record<string, string>>
  /** uniqID → display name (for the per-term gene lists) */
  displayMap?: Record<string, string>
  /** KEGG source only: pathway name → top-level category, for grouping/colouring terms */
  keggCategories?: Record<string, string>
  /** ORA: minimum query-gene hits for a term to be tested (default 2) */
  minCount?: number
  /** GSEA: minimum / maximum genes a set must have in the data (default 5 / 500) */
  minSet?: number
  maxSet?: number
  /** GSEA: number of gene-label permutations (default 1000) */
  permutations?: number
}

/** Split a semicolon/pipe-separated annotation cell into distinct trimmed terms. */
function splitTerms(raw: string | undefined): string[] {
  if (!raw) return []
  const out = new Set<string>()
  for (const s of raw.split(/[;|]/)) {
    const t = s.trim()
    if (t) out.add(t)
  }
  return [...out]
}

/** ln Γ(z) via the Lanczos approximation — for hypergeometric log-binomials. */
function lnGamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/** ln C(n, k). */
function lnChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity
  return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)
}

/** P(X ≥ k) for X ~ Hypergeometric(N, K, n): drawing n from N with K "successes".
 *  Equivalent to a one-tailed Fisher exact test for over-representation. */
function hyperTail(k: number, K: number, n: number, N: number): number {
  if (n === 0 || N === 0) return 1
  const hi = Math.min(K, n)
  const denom = lnChoose(N, n)
  let p = 0
  for (let i = k; i <= hi; i++) p += Math.exp(lnChoose(K, i) + lnChoose(N - K, n - i) - denom)
  return Math.min(1, Math.max(0, p))
}

/** Enrichment dispatcher: ORA (over-representation) or GSEA (ranked). See runOra / runGsea. */
export function buildEnrichment(rows: CompareResultRow[], opts: EnrichOptions): EnrichData {
  return (opts.method ?? 'ora') === 'gsea' ? runGsea(rows, opts) : runOra(rows, opts)
}

/** Over-representation analysis, run separately for UP- and DOWN-regulated significant genes.
 *  The background is all annotated genes (shared); the up query is the significant genes whose
 *  effect is 'up', the down query those whose effect is 'down'. Each direction is tested with
 *  the hypergeometric (Fisher) tail and BH-corrected independently. `rows` are one facet's Compare
 *  result; genes with no term of the chosen source are excluded from both query and background. */
function runOra(rows: CompareResultRow[], opts: EnrichOptions): EnrichData {
  const col = ENRICH_COL[opts.source]
  const ann = opts.annotationMap ?? {}
  const dm = opts.displayMap ?? {}
  const termsOf = (uid: string): string[] => splitTerms(ann[uid]?.[col])
  const push = (m: Map<string, string[]>, t: string, uid: string): void => {
    const arr = m.get(t)
    if (arr) arr.push(uid)
    else m.set(t, [uid])
  }
  const minCount = opts.minCount ?? 2
  const limit = opts.topTerms > 0 ? opts.topTerms : 15

  // Per gene: is it a significant UP hit / significant DOWN hit? (A gene pooled across several
  // comparisons in one facet could be both; it then counts toward each direction it hits.)
  const dir = new Map<string, { up: boolean; down: boolean }>()
  for (const r of rows) {
    let e = dir.get(r.uniqID)
    if (!e) dir.set(r.uniqID, (e = { up: false, down: false }))
    if (r.signf && r.effect === 'up') e.up = true
    if (r.signf && r.effect === 'down') e.down = true
  }

  // Background = annotated genes; also collect the two directional query sets.
  const bgByTerm = new Map<string, string[]>()
  const upGenes = new Set<string>()
  const downGenes = new Set<string>()
  let N = 0
  for (const [uid, e] of dir) {
    const terms = termsOf(uid)
    if (terms.length === 0) continue
    N++
    if (e.up) upGenes.add(uid)
    if (e.down) downGenes.add(uid)
    for (const t of terms) push(bgByTerm, t, uid)
  }

  const runDir = (queryGenes: Set<string>): { terms: EnrichTerm[]; total: number } => {
    const n = queryGenes.size
    const qByTerm = new Map<string, string[]>()
    for (const uid of queryGenes) for (const t of termsOf(uid)) push(qByTerm, t, uid)
    const staged: { term: string; k: number; K: number; genes: string[] }[] = []
    for (const [t, qg] of qByTerm) {
      if (qg.length < minCount) continue
      staged.push({ term: t, k: qg.length, K: (bgByTerm.get(t) ?? qg).length, genes: qg })
    }
    const pvals = staged.map((e) => hyperTail(e.k, e.K, n, N))
    const padj = benjaminiHochberg(pvals)
    const terms: EnrichTerm[] = staged.map((e, i) => ({
      term: e.term,
      count: e.k,
      setSize: e.K,
      geneRatio: n > 0 ? e.k / n : 0,
      bgRatio: N > 0 ? e.K / N : 0,
      fold: n > 0 && N > 0 && e.K > 0 ? e.k / n / (e.K / N) : 0,
      pValue: pvals[i],
      pAdjust: padj[i],
      genes: e.genes.map((uid) => dm[uid] ?? uid).sort(),
      category: opts.keggCategories?.[e.term]
    }))
    terms.sort((a, b) => a.pAdjust - b.pAdjust || b.count - a.count)
    return { terms: terms.slice(0, limit), total: terms.length }
  }

  const up = runDir(upGenes)
  const down = runDir(downGenes)
  return {
    method: 'ora',
    up: up.terms,
    down: down.terms,
    source: opts.source,
    querySize: { up: upGenes.size, down: downGenes.size },
    bgSize: N,
    totalTested: { up: up.total, down: down.total }
  }
}

// ── GSEA (ranked gene-set enrichment) ────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) — GSEA permutations are seeded so a facet's result is stable
 *  across re-renders instead of shifting every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Weighted running-sum enrichment score for a set, given its member positions (ascending) in the
 *  ranked list and the per-position weights |metric|. Returns the signed peak ES and the peak
 *  position (the deepest point of the walk), from which the leading edge is read.
 *  Between hits the sum falls by 1/(N−K) per miss; at a hit it rises by w/N_R (N_R = Σ member w). */
function runningEs(
  positions: number[],
  weightAt: (pos: number) => number,
  N: number
): { es: number; peakAt: number } {
  const K = positions.length
  if (K === 0 || K >= N) return { es: 0, peakAt: -1 }
  let nr = 0
  for (const pos of positions) nr += weightAt(pos)
  if (nr <= 0) return { es: 0, peakAt: -1 }
  const missPenalty = 1 / (N - K)
  let cum = 0
  let prev = -1
  let maxDev = 0
  let minDev = 0
  let peakAt = positions[0]
  for (const pos of positions) {
    cum -= (pos - prev - 1) * missPenalty // misses since the previous hit
    if (cum < minDev) minDev = cum
    cum += weightAt(pos) / nr
    if (cum > maxDev) {
      maxDev = cum
      if (maxDev >= -minDev) peakAt = pos
    }
    prev = pos
  }
  const es = maxDev >= -minDev ? maxDev : minDev
  // For a negative ES the peak is the deepest trough — recover it by tracking the min side.
  if (es < 0) {
    cum = 0
    prev = -1
    let dev = 0
    for (const pos of positions) {
      cum -= (pos - prev - 1) * missPenalty
      if (cum < dev) {
        dev = cum
        peakAt = pos
      }
      cum += weightAt(pos) / nr
      prev = pos
    }
  }
  return { es, peakAt }
}

/** Ranked gene-set enrichment. Genes are ranked by log2FC (descending); each GO term / KEGG
 *  pathway is scored by the weighted running-sum ES, with significance from gene-label
 *  permutation (sets of random genes of the same size). Positive-NES sets (enriched at the
 *  up-regulated top) go to `up`, negative-NES sets to `down`. `rows` are one facet's Compare
 *  result. Gene-set (not phenotype) permutation is used since only per-gene fold changes are
 *  available; p-values are nominal and BH-adjusted within each direction. */
function runGsea(rows: CompareResultRow[], opts: EnrichOptions): EnrichData {
  const col = ENRICH_COL[opts.source]
  const ann = opts.annotationMap ?? {}
  const dm = opts.displayMap ?? {}
  const termsOf = (uid: string): string[] => splitTerms(ann[uid]?.[col])
  const minSet = Math.max(2, opts.minSet ?? 5)
  const maxSet = opts.maxSet ?? 500
  const nPerm = Math.max(100, opts.permutations ?? 1000)
  const limit = opts.topTerms > 0 ? opts.topTerms : 15
  const empty: EnrichData = {
    method: 'gsea',
    up: [],
    down: [],
    source: opts.source,
    querySize: { up: 0, down: 0 },
    bgSize: 0,
    totalTested: { up: 0, down: 0 }
  }

  // Rank metric: mean log2FC per gene (one entry per gene), most up-regulated first.
  const fc = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    const e = fc.get(r.uniqID) ?? { sum: 0, n: 0 }
    e.sum += r.log2FC
    e.n += 1
    fc.set(r.uniqID, e)
  }
  const ranked = [...fc.entries()]
    .map(([uid, e]) => ({ uid, metric: e.sum / e.n }))
    .sort((a, b) => b.metric - a.metric)
  const N = ranked.length
  if (N < minSet + 1) return empty
  const weights = ranked.map((g) => Math.abs(g.metric)) // p = 1 weighting
  const posOf = new Map<string, number>()
  ranked.forEach((g, i) => posOf.set(g.uid, i))

  // Gene sets: term → member positions within the ranked list (size-filtered).
  const members = new Map<string, number[]>()
  ranked.forEach((g, i) => {
    for (const t of termsOf(g.uid)) {
      const arr = members.get(t)
      if (arr) arr.push(i)
      else members.set(t, [i])
    }
  })
  const sets = [...members.entries()]
    .map(([term, pos]) => ({ term, pos: pos.sort((a, b) => a - b) }))
    .filter((s) => s.pos.length >= minSet && s.pos.length <= maxSet)
  if (sets.length === 0) return empty

  const wAt = (pos: number): number => weights[pos]

  // Null ES per set size (permutations depend only on K), reused across sets of equal size.
  const rand = mulberry32(0x9e3779b9 ^ N ^ (sets.length << 8))
  const nullBySize = new Map<number, { es: number[]; posMean: number; negMean: number }>()
  const sample = (k: number): number[] => {
    // Partial Fisher–Yates over an index pool for k distinct ranked positions.
    const pool = new Set<number>()
    const out: number[] = []
    while (out.length < k) {
      const idx = (rand() * N) | 0
      if (!pool.has(idx)) {
        pool.add(idx)
        out.push(idx)
      }
    }
    return out.sort((a, b) => a - b)
  }
  const nullFor = (k: number): { es: number[]; posMean: number; negMean: number } => {
    const cached = nullBySize.get(k)
    if (cached) return cached
    const es: number[] = []
    let posSum = 0
    let posN = 0
    let negSum = 0
    let negN = 0
    for (let i = 0; i < nPerm; i++) {
      const e = runningEs(sample(k), wAt, N).es
      es.push(e)
      if (e >= 0) {
        posSum += e
        posN++
      } else {
        negSum += -e
        negN++
      }
    }
    const rec = {
      es,
      posMean: posN > 0 ? posSum / posN : 1e-9,
      negMean: negN > 0 ? negSum / negN : 1e-9
    }
    nullBySize.set(k, rec)
    return rec
  }

  interface Scored {
    term: string
    nes: number
    p: number
    setSize: number
    leading: string[]
    /** leading-edge genes' uniqIDs, aligned to `leading` */
    leadIds: string[]
    /** leading-edge genes' log2FC, aligned to `leading` */
    leadDist: number[]
    dist: number[]
  }
  const scored: Scored[] = []
  for (const s of sets) {
    const { es, peakAt } = runningEs(s.pos, wAt, N)
    if (es === 0) continue
    const nul = nullFor(s.pos.length)
    const mean = es >= 0 ? nul.posMean : nul.negMean
    const nes = mean > 0 ? es / mean : 0
    // Nominal p: fraction of same-sign null ES at least as extreme.
    let as = 0
    let tot = 0
    for (const e of nul.es) {
      if (es >= 0 ? e >= 0 : e < 0) {
        tot++
        if (Math.abs(e) >= Math.abs(es)) as++
      }
    }
    const p = tot > 0 ? (as + 1) / (tot + 1) : 1
    // Leading edge: members up to (positive) / from (negative) the peak position, ordered by
    // |log2FC| so the most extreme drivers come first (names + values kept aligned).
    const leadPos = s.pos
      .filter((pos) => (es >= 0 ? pos <= peakAt : pos >= peakAt))
      .sort((a, b) => Math.abs(ranked[b].metric) - Math.abs(ranked[a].metric))
    const leading = leadPos.map((pos) => dm[ranked[pos].uid] ?? ranked[pos].uid)
    const leadIds = leadPos.map((pos) => ranked[pos].uid)
    const leadDist = leadPos.map((pos) => ranked[pos].metric)
    const dist = s.pos.map((pos) => ranked[pos].metric)
    scored.push({ term: s.term, nes, p, setSize: s.pos.length, leading, leadIds, leadDist, dist })
  }
  if (scored.length === 0) return empty

  // BH within each direction.
  const pack = (group: Scored[]): { terms: EnrichTerm[]; total: number } => {
    const padj = benjaminiHochberg(group.map((g) => g.p))
    const terms: EnrichTerm[] = group.map((g, i) => ({
      term: g.term,
      count: g.leading.length,
      setSize: g.setSize,
      geneRatio: g.setSize > 0 ? g.leading.length / g.setSize : 0,
      bgRatio: 0,
      fold: 0,
      pValue: g.p,
      pAdjust: padj[i],
      genes: g.leading,
      geneIds: g.leadIds,
      nes: g.nes,
      dist: g.dist,
      leadingDist: g.leadDist,
      category: opts.keggCategories?.[g.term]
    }))
    terms.sort((a, b) => a.pAdjust - b.pAdjust || Math.abs(b.nes ?? 0) - Math.abs(a.nes ?? 0))
    return { terms: terms.slice(0, limit), total: terms.length }
  }
  const up = pack(scored.filter((s) => s.nes > 0))
  const down = pack(scored.filter((s) => s.nes < 0))
  return {
    method: 'gsea',
    up: up.terms,
    down: down.terms,
    source: opts.source,
    querySize: { up: up.total, down: down.total },
    bgSize: N,
    totalTested: { up: up.total, down: down.total },
    ranked: ranked.map((g) => g.metric)
  }
}
