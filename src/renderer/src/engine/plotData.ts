/**
 * Shape engine outputs into plain data structures for Plotly rendering. Kept
 * framework/library-free so the engine has no plotly dependency — the renderer
 * component assembles the actual Plotly traces from these.
 */
import { clusterRowOrder } from './cluster'
import type { ContrastResultRow } from './contrast'
import { embed2D, type ClusterMethod } from './embed'
import { benjaminiHochberg, madNormal, median, normalSf, studentTppf, type Effect } from './stats'
import { VALID_CONDITIONS } from './types'
import type { CompareResultRow, ConditionKey, StandardRow } from './types'

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
  strain?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
}

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

export interface FacetGroup<T = ContextRow> {
  /** stable key, e.g. "strain=WT · dose=10" */
  key: string
  /** the faceting value(s) for this group, in dim order */
  values: Array<{ dim: ConditionKey; value: string | number }>
  rows: T[]
}

/** Split rows into one group per distinct tuple of `dims` values (omicViz groupby). */
export function facetCompareRows<T extends ContextRow>(
  rows: T[],
  dims: ConditionKey[]
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

const yRange = (pts: { y: number }[]): number => {
  const ys = pts.map((p) => p.y)
  return Math.max(...ys) - Math.min(...ys)
}

/** Response curves: log2FC vs dose (or time), one line per gene, top-N by response range. */
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
  series.sort((a, b) => yRange(b.points) - yRange(a.points))
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
  // Show every gene (as faint background lines); topGenes controls only how many of
  // the most-differential are colored on top. All genes stay in one merged view trace.
  return {
    series,
    axis: opts.axis,
    highlight: Math.max(0, opts.topGenes),
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
  genes: string[] // gene axis order (capped/top-N genes)
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

/** Bubble grid: genes × dose(or time), dot color = log2FC, size = significance. Genes
 *  are ordered by their max (signed) log2FC; top-N/cap picks the most dynamic genes. */
export function buildBubble(rows: CompareResultRow[], opts: BubbleOptions): BubbleData {
  const maxAbs = new Map<string, number>() // |log2FC| — which genes to keep
  const maxFC = new Map<string, number>() // signed max log2FC — gene axis order
  const byGene = new Map<string, CompareResultRow[]>()
  for (const r of rows) {
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    maxAbs.set(r.uniqID, Math.max(maxAbs.get(r.uniqID) ?? 0, Math.abs(r.log2FC)))
    maxFC.set(r.uniqID, Math.max(maxFC.get(r.uniqID) ?? -Infinity, r.log2FC))
    let arr = byGene.get(r.uniqID)
    if (!arr) {
      arr = []
      byGene.set(r.uniqID, arr)
    }
    arr.push(r)
  }
  const ranked = [...maxAbs.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
  // Focus genes (when set) override top-N: keep exactly those present in the data.
  const focus = opts.focus ?? []
  const base =
    focus.length > 0
      ? focus.filter((id) => byGene.has(id))
      : ranked.slice(0, geneLimit(opts.topGenes, ranked.length))
  // Order the chosen genes by max log2FC (descending) for the gene axis.
  base.sort((a, b) => (maxFC.get(b) ?? 0) - (maxFC.get(a) ?? 0))
  // Append linked-selection genes not already shown (kept in their own FC order), so a
  // hovered/pinned gene lands at the end of the axis instead of reshuffling the rest.
  const baseSet = new Set(base)
  const extra = (opts.extra ?? [])
    .filter((id) => byGene.has(id) && !baseSet.has(id))
    .sort((a, b) => (maxFC.get(b) ?? 0) - (maxFC.get(a) ?? 0))
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
    genes: top.map((g) => opts.displayMap?.[g] ?? g),
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

/** Dumbbell: FC1 vs FC2 per gene as connected dots, top-N by |FCdiff|. */
export function buildDumbbell(rows: ContrastResultRow[], opts: DumbbellOptions): DumbbellData {
  const valid = rows.filter((r) => r.FC1 != null && r.FC2 != null)
  valid.sort((a, b) => Math.abs(b.FCdiff ?? 0) - Math.abs(a.FCdiff ?? 0))
  const focus = opts.focus ?? []
  const focusSet = new Set(focus)
  const base =
    focus.length > 0
      ? valid.filter((r) => focusSet.has(r.uniqID))
      : valid.slice(0, geneLimit(opts.topGenes, valid.length))
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
    total: valid.length
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
  mean: number
  sd: number
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
  displayMap?: Record<string, string>
): GeneBarData {
  const want = new Set(uniqIDs)
  const byKey = new Map<string, number[]>() // `${uniqID} ${cond}` → values
  const condOrder: string[] = []
  const condSeen = new Set<string>()
  const present = new Set<string>()
  for (const r of rows) {
    if (!want.has(r.uniqID) || r.value == null || !Number.isFinite(r.value)) continue
    present.add(r.uniqID)
    const cond = sampleCond(r)
    if (!condSeen.has(cond)) {
      condSeen.add(cond)
      condOrder.push(cond)
    }
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
      if (!vals || vals.length === 0) continue
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length
      const variance =
        vals.length > 1
          ? vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (vals.length - 1)
          : 0
      bars.push({ cond, gene: label, uniqID, mean, sd: Math.sqrt(variance), n: vals.length })
    }
  }
  return { bars, conds: condOrder, genes }
}

// ── cluster / sample embedding (standardize) ─────────────────────────────────────

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
}
export interface ClusterData {
  points: ClusterPoint[]
  method: ClusterMethod
  /** PCA only: variance fraction on each axis ([0, 0] for UMAP/t-SNE). */
  varExplained: [number, number]
  colorBy: ConditionKey
}
export interface ClusterOptions {
  method: ClusterMethod
  colorBy: ConditionKey
}

/** Core embedding: given a genes×items log2 matrix (NaN = missing) and per-item
 *  labels/colors, center + mean-impute each gene, transpose to items×genes, and embed
 *  to 2-D. Shared by the sample (standardize) and responsome (compare) paths. */
function embedMatrix(
  M: number[][],
  items: Array<{ label: string; group: string; cond: string }>,
  opts: ClusterOptions
): ClusterData {
  const nItems = items.length
  const nG = M.length
  if (nItems < 2 || nG < 1) {
    return { points: [], method: opts.method, varExplained: [0, 0], colorBy: opts.colorBy }
  }
  // center each gene across items (mean-impute missing → 0 after centering)
  for (let g = 0; g < nG; g++) {
    const row = M[g]
    let sum = 0
    let cnt = 0
    for (let s = 0; s < nItems; s++)
      if (Number.isFinite(row[s])) {
        sum += row[s]
        cnt++
      }
    const mean = cnt ? sum / cnt : 0
    for (let s = 0; s < nItems; s++) row[s] = Number.isFinite(row[s]) ? row[s] - mean : 0
  }
  // items×genes matrix D = Mᵀ, fed to the chosen embedding.
  const D: number[][] = Array.from({ length: nItems }, (_, s) => M.map((geneRow) => geneRow[s]))
  const { coords, varExplained } = embed2D(D, opts.method)
  const points: ClusterPoint[] = items.map((it, i) => ({
    x: coords[i][0],
    y: coords[i][1],
    sample: it.label,
    group: it.group,
    cond: it.cond
  }))
  return { points, method: opts.method, varExplained, colorBy: opts.colorBy }
}

/** Sample embedding (PCA / UMAP / t-SNE) from the standardized genes×samples log2
 *  matrix — one point per sample, colored by a condition. */
export function buildCluster(rows: StandardRow[], opts: ClusterOptions): ClusterData {
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
  // genes×samples log2 matrix (NaN for missing)
  const M: number[][] = Array.from({ length: geneIdx.size }, () =>
    new Array(sampleMeta.length).fill(NaN)
  )
  for (const r of rows) {
    const v = r.value
    const lv = v != null && Number.isFinite(v) && v > 0 ? Math.log2(v) : NaN
    M[geneIdx.get(r.uniqID) as number][sampleIdx.get(sampleLabel(r)) as number] = lv
  }
  const items = sampleMeta.map((meta) => ({
    label: sampleLabel(meta),
    group: String((meta as unknown as Record<string, unknown>)[opts.colorBy] ?? ''),
    cond: sampleCond(meta)
  }))
  return embedMatrix(M, items, opts)
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
 *  colored by a condition. Coloring by the comparison's own dimension is degenerate
 *  (it is constant within a single comparison), so an invalid `colorBy` falls back to
 *  the first varying context condition; the effective choice is returned in `colorBy`. */
export function buildResponseCluster(rows: CompareResultRow[], opts: ClusterOptions): ClusterData {
  const contextDims = facetContextDims(rows)
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
      cond: label
    }
  })
  return embedMatrix(M, items, { ...opts, colorBy })
}

// ── heatmap ────────────────────────────────────────────────────────────────────

export interface HeatmapData {
  /** z[geneIndex][sampleIndex] — log2 intensity, null for missing */
  z: Array<Array<number | null>>
  /** sample column labels */
  x: string[]
  /** gene row labels */
  y: string[]
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
  const geneOrder: string[] = []
  const geneSeen = new Set<string>()
  const cells = new Map<string, number | null>() // `${gene} ${sample}` → value

  for (const r of rows) {
    const s = sampleLabel(r)
    if (!sampleSeen.has(s)) {
      sampleSeen.add(s)
      sampleOrder.push(s)
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
    const order = clusterRowOrder(imputed)
    genes = order.map((i) => genes[i])
    z = order.map((i) => z[i])
  }

  const y = genes.map((g) => opts.displayMap?.[g] ?? g)
  return { z, x: sampleOrder, y }
}
