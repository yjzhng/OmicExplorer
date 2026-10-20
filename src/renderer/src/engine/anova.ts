/**
 * The n-way ANOVA: per gene, a linear model on abundance — log₂, or the values as they are when
 * Clean data presents them unlogged (as the t-test follows it) — with every compared condition a
 * categorical factor at all its levels, terms up to an interaction-order cap (2 by default: the main
 * effects and every two-way interaction). See docs/general_factor_testing.md, stage 1.
 *
 * Per gene and context slice (the other conditions, matched like-for-like as the 2-way contrast
 * always matched them), it gives:
 *  - each term's type II sum of squares — the term against the model of every term that doesn't
 *    contain it — and its F-test against the residual variance;
 *  - the residual variance, plain or moderated (limma-style: towards an abundance-trend prior fitted
 *    across every gene of the run, splineFit's fitPrior);
 *  - the additive attribution: the grand mean and each term's contribution in every design cell
 *    (deviation coding, so in a balanced design a main effect is its level's marginal mean minus the
 *    grand mean), the seam the per-gene shares and a dataset decomposition read;
 *  - linear contrasts of the fitted cell means (a 2×2 interaction, a level against a control), each
 *    tested on the model's residual variance.
 *
 * A contrast's fold change is a log₂ ratio either way: on log₂ values its estimate itself; on linear
 * values the log₂ ratio of its fitted cell means (log₂(m₁₁·m₀₀ / m₁₀·m₀₁) for a 2×2), its SE by the
 * delta method — the t-test's convention. Its test is on the model's own scale.
 *
 * Every term and contrast is computed from the model's fitted cell means, so it holds unbalanced and
 * with missing cells (a column the observed cells can't separate is dropped from the fit); a
 * contrast is only reported for a gene measured in every cell it reads.
 */
import { benjaminiHochberg, studentTTwoSided } from './stats'
import { condValue, valEq } from './compare'
import { fSurvival } from './curveFit'
import { fitPrior, type Moderation } from './splineFit'
import type { CondSelector, ConditionKey, StandardRow } from './types'

/** A factor: a condition and the levels it takes in the model (the order fixes the coding). With
 *  `x`, a numeric condition as a **slope**: one column, linear in each level's position on its
 *  axis (log₁₀ or its own units; a 0 on a log axis one step below the lowest level), centred on
 *  the levels' mean — or at the shared baseline (AnovaInput.sharedBaseline). */
export interface AnovaFactor {
  condition: ConditionKey
  levels: string[]
  /** per level: its position on the slope's axis (absent: categorical) */
  x?: number[]
}

/** The vehicle design, for a categorical factor and a slope: the factor's control exists only at
 *  the slope's lowest level (DMSO only at dose 0). Every level is the control there, so one
 *  baseline (the control at that level) and a slope per treated level through it: the slope is
 *  anchored at its lowest level, the factor coded over its treated levels only, and no term with
 *  the factor but not the slope (its levels can't be shifted apart). */
export interface SharedBaseline {
  /** the categorical factor and the slope, by factor index */
  factor: number
  slope: number
  /** the factor's control level */
  control: string
}

/** A model term: one factor (a main effect) or several (their interaction), by factor index. */
export interface AnovaTerm {
  factors: number[]
  /** "cmpd", "cmpd × dose" */
  label: string
}

/** How the residual variance enters the tests: moderated towards the run's abundance-trend prior
 *  (limma-style; better at 2–3 replicates per cell), or each gene's own. */
export type AnovaVariance = 'moderated' | 'plain'

/** A linear contrast of cell means. A main contrast compares two levels of one factor, averaged over
 *  the others' levels; an interaction contrast is the difference of differences of two factors' two
 *  levels each (num₁ − den₁ at num₂, minus the same at den₂) — or, with `rest`, of three or more
 *  factors' (the n-way interaction: that 2×2 at num₃, minus it at den₃, …) — averaged over any
 *  further factors. */
export type AnovaContrast =
  | { kind: 'main'; a: ContrastSide }
  | { kind: 'interaction'; a: ContrastSide; b: ContrastSide; rest?: ContrastSide[] }
export type ContrastSide =
  | {
      /** factor index */
      factor: number
      num: string
      den: string
    }
  | {
      /** a slope factor's index: its change per unit of x (in place of a num − den) */
      factor: number
      slope: true
    }

const isSlopeSide = (sd: ContrastSide): sd is { factor: number; slope: true } => 'slope' in sd

export interface AnovaInput {
  rows: StandardRow[]
  factors: AnovaFactor[]
  activeConditions: ConditionKey[]
  /** the highest interaction order modelled (default 2) */
  maxOrder?: number
  /** the vehicle design (see SharedBaseline) */
  sharedBaseline?: SharedBaseline
  variance?: AnovaVariance
  /** model log₂ abundance (default) or the values as they are (Clean data presenting them
   *  unlogged) */
  logScale?: boolean
  contrasts?: AnovaContrast[]
  /** the side selectors: a non-factor condition pinned (to the same values) on both is an inclusion
   *  filter on the context — only those values take part */
  num?: CondSelector
  den?: CondSelector
}

/** One gene's fit in one slice. */
export interface AnovaGene {
  uniqID: string
  /** observations, and the residual df (observations − the fit's rank) */
  n: number
  dfResid: number
  /** residual variance: the gene's own, and the one its tests use (moderated, or its own) */
  s2: number
  s2Post: number
  /** the tests' denominator df (residual + prior df; 1e6 standing in for an infinite prior) */
  dfTest: number
  /** mean abundance on the model's scale (the prior's trend variable) */
  abundance: number
  /** per term (AnovaRun.terms order): type II SS, its df, F, p and q (BH per term across the run's
   *  genes in this slice) */
  ss: number[]
  df: number[]
  F: number[]
  p: number[]
  q: number[]
  /** the attribution: the grand mean, and per term its contribution in each design cell (by
   *  AnovaSlice.cells index; NaN for a cell this gene wasn't measured in) */
  grand: number
  contrib: number[][]
  /** per term: its contribution's root mean square over the gene's observations, on the model's
   *  scale — the term's effect size (on log₂ values, a fold change's scale) */
  rms: number[]
  /** per term: the effect size on log₂ — `rms` on log₂ values; on linear ones the same
   *  decomposition of the log₂ fitted cell means (NaN where a fitted mean isn't positive) — so a
   *  term's size reads as a fold change whatever the model's scale */
  rmsLog2: number[]
  /** per design cell (AnovaSlice.cells index): the gene's observations there (0 = not measured) —
   *  with s2Post, a cell mean's standard error */
  cellN: number[]
  /** per term: its share of the gene's total sum of squares (the residual's is 1 − their sum when
   *  the design is balanced) */
  share: number[]
}

/** A contrast's result for one gene in one slice. */
export interface AnovaContrastGene {
  uniqID: string
  /** on the model's scale, and its SE (what the test reads) */
  estimate: number
  se: number
  /** the fold change as a log₂ ratio, and its SE (on log₂ values the estimate and its SE) */
  log2FC: number
  fcSE: number
  t: number
  df: number
  p: number
}

export interface AnovaSlice {
  /** the context: each non-factor condition's value in this slice */
  context: Array<[ConditionKey, string | number | null]>
  /** the design cells present (level index per factor) */
  cells: number[][]
  genes: AnovaGene[]
  /** per input contrast: its genes (those measured in every cell it reads), and the context
   *  values a row of it carries (from its first cell's samples) */
  contrasts: Array<{
    genes: AnovaContrastGene[]
    context: Array<[ConditionKey, string | number | null]>
  }>
}

export interface AnovaRun {
  /** the model's scale */
  scale: 'log2' | 'linear'
  factors: AnovaFactor[]
  sharedBaseline?: SharedBaseline
  terms: AnovaTerm[]
  slices: AnovaSlice[]
  /** the context conditions a slice is matched on, and those some cell is invariant on (its single
   *  slice serving every value of them: a vehicle that only exists at dose 0) */
  context: ConditionKey[]
  fixed: ConditionKey[]
  /** the variance prior (moderated runs) */
  prior?: Moderation
}

/** The model's terms: every set of 1 … maxOrder factors, main effects first — under a shared
 *  baseline, none with its factor but not its slope. */
export function anovaTerms(
  factors: AnovaFactor[],
  maxOrder = 2,
  shared?: SharedBaseline
): AnovaTerm[] {
  const out: AnovaTerm[] = []
  const n = factors.length
  const pick = (start: number, size: number, acc: number[]): void => {
    if (acc.length === size) {
      out.push({ factors: acc, label: acc.map((i) => factors[i].condition).join(' × ') })
      return
    }
    for (let i = start; i < n; i++) pick(i + 1, size, [...acc, i])
  }
  for (let size = 1; size <= Math.min(maxOrder, n); size++) pick(0, size, [])
  return shared
    ? out.filter((t) => !t.factors.includes(shared.factor) || t.factors.includes(shared.slope))
    : out
}

/** A factor's columns in the model: a slope's one; a categorical factor's levels − 1 (under a
 *  shared baseline, its treated levels − 1). */
export function factorWidth(factors: AnovaFactor[], f: number, shared?: SharedBaseline): number {
  if (factors[f].x) return 1
  return factors[f].levels.length - (shared?.factor === f ? 2 : 1)
}

// ── design ───────────────────────────────────────────────────────────────────────────────────

/** The model matrix's columns: the intercept, then each term's (deviation-coded: a factor of L
 *  levels gives L − 1 columns, level k < L − 1 as 1 at k and −1 at the last level; a slope one
 *  column, x minus its centre; an interaction's columns are the products of its factors'). `term[c]`
 *  is column c's term (−1 = the intercept). */
interface Design {
  term: number[]
  /** the model row of a design cell (level index per factor); `at` places slope factors at an x of
   *  their own instead (a contrast's per-unit change, between levels) */
  rowOf: (cell: number[], at?: Partial<Record<number, number>>) => number[]
  /** a slope factor's centre on x: the levels' mean, or a shared baseline's lowest level */
  centre: (f: number) => number
}

function buildDesign(factors: AnovaFactor[], terms: AnovaTerm[], shared?: SharedBaseline): Design {
  const centres = factors.map((f, i) =>
    !f.x
      ? 0
      : shared?.slope === i
        ? Math.min(...f.x)
        : f.x.reduce((a, v) => a + v, 0) / f.x.length
  )
  // under a shared baseline the factor is coded over its treated levels; its control is all 0
  const coded = factors.map((f, i) =>
    shared?.factor === i ? f.levels.filter((l) => l !== shared.control) : f.levels
  )
  const code = (f: number, level: number, at?: number): number[] => {
    const x = factors[f].x
    if (x) return [(at ?? x[level]) - centres[f]]
    const k = coded[f].indexOf(factors[f].levels[level])
    const L = coded[f].length
    return Array.from({ length: L - 1 }, (_, j) => (k === j ? 1 : k === L - 1 ? -1 : 0))
  }
  const term: number[] = [-1]
  const width = terms.map((t) => t.factors.reduce((w, f) => w * factorWidth(factors, f, shared), 1))
  terms.forEach((_, ti) => {
    for (let k = 0; k < width[ti]; k++) term.push(ti)
  })
  return {
    term,
    centre: (f) => centres[f],
    rowOf: (cell, at) => {
      const row = [1]
      for (const t of terms) {
        let cols = [1]
        for (const f of t.factors) {
          const c = code(f, cell[f], at?.[f])
          cols = cols.flatMap((a) => c.map((b) => a * b))
        }
        row.push(...cols)
      }
      return row
    }
  }
}

/** A least-squares fit's reusable part for one model and one pattern of observed cells: the kept
 *  columns' orthonormal basis (Q, n × k) and R (k × k, upper triangular). Columns the observed
 *  cells can't separate from earlier ones are dropped (modified Gram–Schmidt with a tolerance). */
interface Basis {
  cols: number[]
  Q: Float64Array[]
  R: number[][]
}

function basisOf(X: number[][], cols: number[]): Basis {
  const n = X.length
  const kept: number[] = []
  const Q: Float64Array[] = []
  const R: number[][] = []
  for (const c of cols) {
    const v = new Float64Array(n)
    let norm0 = 0
    for (let i = 0; i < n; i++) {
      v[i] = X[i][c]
      norm0 += v[i] * v[i]
    }
    if (!(norm0 > 0)) continue
    const r: number[] = []
    for (let j = 0; j < Q.length; j++) {
      let d = 0
      for (let i = 0; i < n; i++) d += Q[j][i] * v[i]
      r.push(d)
      for (let i = 0; i < n; i++) v[i] -= d * Q[j][i]
    }
    let norm = 0
    for (let i = 0; i < n; i++) norm += v[i] * v[i]
    if (norm <= 1e-10 * norm0) continue
    const s = Math.sqrt(norm)
    for (let i = 0; i < n; i++) v[i] /= s
    // R gains this column: its projections on the earlier basis vectors above, its norm on the
    // diagonal
    R.forEach((row, j) => row.push(r[j]))
    R.push([...new Array<number>(kept.length).fill(0), s])
    kept.push(c)
    Q.push(v)
  }
  return { cols: kept, Q, R }
}

/** Q'y and the residual sum of squares of y on a basis. */
function project(b: Basis, y: number[]): { qy: number[]; rss: number } {
  let yy = 0
  for (const v of y) yy += v * v
  const qy = b.Q.map((q) => {
    let d = 0
    for (let i = 0; i < y.length; i++) d += q[i] * y[i]
    return d
  })
  const rss = Math.max(0, yy - qy.reduce((s, v) => s + v * v, 0))
  return { qy, rss }
}

/** Solve R x = z (back substitution). */
function backSolve(R: number[][], z: number[]): number[] {
  const k = z.length
  const x = new Array<number>(k).fill(0)
  for (let i = k - 1; i >= 0; i--) {
    let s = z[i]
    for (let j = i + 1; j < k; j++) s -= R[i][j] * x[j]
    x[i] = s / R[i][i]
  }
  return x
}

/** Solve Rᵀ x = g (forward substitution) — ‖x‖² is g'(X'X)⁻¹g, a fitted contrast's variance factor. */
function forwardSolveT(R: number[][], g: number[]): number[] {
  const k = g.length
  const x = new Array<number>(k).fill(0)
  for (let i = 0; i < k; i++) {
    let s = g[i]
    for (let j = 0; j < i; j++) s -= R[j][i] * x[j]
    x[i] = s / R[i][i]
  }
  return x
}

// ── slicing ──────────────────────────────────────────────────────────────────────────────────

const levelOf = (factors: AnovaFactor[], r: StandardRow): number[] | null => {
  const cell: number[] = []
  for (const f of factors) {
    const v = condValue(r, f.condition)
    const k = f.levels.findIndex((l) => valEq(v, l))
    if (k < 0) return null
    cell.push(k)
  }
  return cell
}

/** The rows of each context slice: every non-factor condition matched like-for-like, except that a
 *  cell is never matched on a condition it's invariant on (its one value serves every slice). The
 *  slices are the contexts of the cells that vary on the most of them. */
function slicesOf(input: AnovaInput): {
  slices: Array<{ rep: StandardRow; cellRows: Map<string, StandardRow[]> }>
  context: ConditionKey[]
  fixed: ConditionKey[]
} {
  const { factors, activeConditions, num, den } = input
  const factorConds = new Set(factors.map((f) => f.condition))
  // context inclusion filters: a non-factor condition pinned alike on both sides
  const filters =
    num && den
      ? activeConditions.filter(
          (c) => !factorConds.has(c) && (num[c]?.length ?? 0) > 0 && (den[c]?.length ?? 0) > 0
        )
      : []
  const rows = input.rows.filter(
    (r) =>
      filters.every((c) => (num![c] as string[]).some((v) => valEq(condValue(r, c), v))) &&
      levelOf(factors, r) != null
  )
  const ctx = activeConditions.filter(
    (c) =>
      !factorConds.has(c) && rows.some((r) => condValue(r, c) != null && condValue(r, c) !== '')
  )
  const byCell = new Map<string, StandardRow[]>()
  for (const r of rows) {
    const k = levelOf(factors, r)!.join(',')
    const a = byCell.get(k)
    if (a) a.push(r)
    else byCell.set(k, [r])
  }
  const varying = (rs: StandardRow[]): ConditionKey[] =>
    ctx.filter((d) => new Set(rs.map((r) => String(condValue(r, d) ?? ''))).size > 1)
  const vary = new Map([...byCell].map(([k, rs]) => [k, varying(rs)]))
  const widest = Math.max(0, ...[...vary.values()].map((v) => v.length))
  const drivers = [...byCell.keys()].filter((k) => vary.get(k)!.length === widest)
  const dims = drivers.length ? vary.get(drivers[0])! : []
  const fixed = ctx.filter(
    (d) => dims.includes(d) && [...vary.values()].some((v) => !v.includes(d))
  )
  // every distinct context of the driving cells, on the dims they vary on
  const keyOn = (r: StandardRow, on: ConditionKey[]): string =>
    on.map((d) => String(condValue(r, d) ?? '')).join('\u0001')
  const reps = new Map<string, StandardRow>()
  for (const k of drivers)
    for (const r of byCell.get(k)!) {
      const key = keyOn(r, dims)
      if (!reps.has(key)) reps.set(key, r)
    }
  if (!reps.size && rows.length) reps.set('', rows[0])
  const slices = [...reps.values()].map((rep) => {
    const cellRows = new Map<string, StandardRow[]>()
    for (const [k, rs] of byCell) {
      const on = vary.get(k)!.filter((d) => dims.includes(d))
      const want = keyOn(rep, on)
      const sel = rs.filter((r) => keyOn(r, on) === want)
      if (sel.length) cellRows.set(k, sel)
    }
    return { rep, cellRows }
  })
  return { slices, context: ctx, fixed }
}

/** What a run would fit, without the genes: each slice's context and the design cells present
 *  (level index per factor) — the Compare window's preview, on its one row per sample. */
export function anovaLayout(input: AnovaInput): {
  slices: Array<{ context: Array<[ConditionKey, string | number | null]>; cells: number[][] }>
  context: ConditionKey[]
  fixed: ConditionKey[]
} {
  const { slices, context, fixed } = slicesOf(input)
  return {
    slices: slices.map(({ rep, cellRows }) => ({
      context: context.map((d) => [d, condValue(rep, d)] as [ConditionKey, string | number | null]),
      cells: [...cellRows.keys()].map((k) => k.split(',').map(Number))
    })),
    context,
    fixed
  }
}

/** Each term's type II df on a set of design cells (one observation each), as a run gives a gene
 *  measured in every one of them — 0 for a term the cells can't estimate (a nested design), less
 *  than its full df where combinations are missing. */
export function termDf(
  factors: AnovaFactor[],
  terms: AnovaTerm[],
  cells: number[][],
  shared?: SharedBaseline
): number[] {
  const design = buildDesign(factors, terms, shared)
  const X = cells.map((c) => design.rowOf(c))
  const allCols = design.term.map((_, c) => c)
  const contains = (u: AnovaTerm, t: AnovaTerm): boolean =>
    t.factors.every((f) => u.factors.includes(f))
  return terms.map((t, ti) => {
    const without = terms.map((u, ui) => (contains(u, t) ? -1 : ui)).filter((ui) => ui >= 0)
    const colsOf = (ts: number[]): number[] =>
      allCols.filter((c) => design.term[c] === -1 || ts.includes(design.term[c]))
    return (
      basisOf(X, colsOf([...without, ti])).cols.length - basisOf(X, colsOf(without)).cols.length
    )
  })
}

// ── the run ──────────────────────────────────────────────────────────────────────────────────

const log2v = (v: number | null): number => (v != null && v > 0 ? Math.log2(v) : NaN)
const linv = (v: number | null): number => (v != null && Number.isFinite(v) ? v : NaN)

interface RawGene {
  uniqID: string
  y: number[]
  cell: number[]
  full: { basis: Basis; qy: number[]; rss: number }
  ss: number[]
  df: number[]
}

export function runAnova(input: AnovaInput): AnovaRun {
  const { factors } = input
  const shared = input.sharedBaseline
  const terms = anovaTerms(factors, input.maxOrder ?? 2, shared)
  const design = buildDesign(factors, terms, shared)
  const allCols = design.term.map((_, c) => c)
  // per term: the type II pair — every term not containing it, without and with it
  const contains = (u: AnovaTerm, t: AnovaTerm): boolean =>
    t.factors.every((f) => u.factors.includes(f))
  const pairs = terms.map((t) => {
    const without = terms.map((u, ui) => (contains(u, t) ? -1 : ui)).filter((ui) => ui >= 0)
    const ti = terms.indexOf(t)
    const colsOf = (ts: number[]): number[] =>
      allCols.filter((c) => design.term[c] === -1 || ts.includes(design.term[c]))
    return { minus: colsOf(without), plus: colsOf([...without, ti]) }
  })
  const { slices: raw, context, fixed } = slicesOf(input)
  const logScale = input.logScale ?? true
  const valueOf = logScale ? log2v : linv

  // Fit every gene of every slice; bases are shared by genes measured in the same cells.
  const fitted = raw.map(({ rep, cellRows }) => {
    const cells = [...cellRows.keys()].map((k) => k.split(',').map(Number))
    const cellIndex = new Map([...cellRows.keys()].map((k, i) => [k, i]))
    const byGene = new Map<string, { y: number[]; cell: number[] }>()
    for (const [k, rs] of cellRows)
      for (const r of rs) {
        const y = valueOf(r.value)
        if (!Number.isFinite(y)) continue
        let g = byGene.get(r.uniqID)
        if (!g) byGene.set(r.uniqID, (g = { y: [], cell: [] }))
        g.y.push(y)
        g.cell.push(cellIndex.get(k)!)
      }
    const cellRow = cells.map((c) => design.rowOf(c))
    const cache = new Map<string, Basis>()
    const basis = (pattern: string, X: number[][], cols: number[], tag: string): Basis => {
      const key = `${tag}|${pattern}`
      let b = cache.get(key)
      if (!b) cache.set(key, (b = basisOf(X, cols)))
      return b
    }
    const genes: RawGene[] = []
    for (const [uniqID, g] of byGene) {
      const pattern = g.cell.join(',')
      const X = g.cell.map((ci) => cellRow[ci])
      const fb = basis(pattern, X, allCols, 'full')
      const full = { basis: fb, ...project(fb, g.y) }
      const ss: number[] = []
      const df: number[] = []
      pairs.forEach((pr, ti) => {
        const bm = basis(pattern, X, pr.minus, `m${ti}`)
        const bp = basis(pattern, X, pr.plus, `p${ti}`)
        ss.push(Math.max(0, project(bm, g.y).rss - project(bp, g.y).rss))
        df.push(bp.cols.length - bm.cols.length)
      })
      genes.push({ uniqID, y: g.y, cell: g.cell, full, ss, df })
    }
    return { rep, cellRows, cells, cellRow, genes }
  })

  // The residual variance's prior: across every gene of every slice, by abundance.
  const moderated = (input.variance ?? 'moderated') === 'moderated'
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
  const all = fitted.flatMap((s) =>
    s.genes.map((g) => {
      const d = g.y.length - g.full.basis.cols.length
      return { s2: d > 0 ? g.full.rss / d : NaN, d, abundance: mean(g.y) }
    })
  )
  const prior = moderated ? fitPrior(all) : undefined

  let at = 0
  const slices: AnovaSlice[] = fitted.map((s) => {
    const genes: AnovaGene[] = s.genes.map((g) => {
      const { s2, d, abundance } = all[at++]
      const d0 = prior?.d0 ?? 0
      const s0 = prior ? prior.s0sq(abundance) : NaN
      // posterior variance: the prior's weight d0 against the gene's own d (no usable prior → own)
      const post =
        d0 === Infinity && Number.isFinite(s0)
          ? s0
          : d0 > 0 && Number.isFinite(s0)
            ? (d0 * s0 + (d > 0 ? d * s2 : 0)) / (d0 + Math.max(d, 0))
            : s2
      const dfTest =
        d0 === Infinity && Number.isFinite(s0)
          ? 1e6
          : d0 > 0 && Number.isFinite(s0)
            ? d0 + Math.max(d, 0)
            : d
      const F = g.ss.map((ss, ti) => (g.df[ti] > 0 && post > 0 ? ss / g.df[ti] / post : NaN))
      const p = F.map((f, ti) =>
        Number.isFinite(f) && dfTest > 0 ? fSurvival(f, g.df[ti], dfTest) : NaN
      )
      // the attribution: coefficients on the kept columns (a dropped column's is 0)
      const coef = new Array<number>(design.term.length).fill(0)
      const b = backSolve(g.full.basis.R, g.full.qy)
      g.full.basis.cols.forEach((c, j) => (coef[c] = b[j]))
      const seen = new Set(g.cell)
      const contribOf = (cf: number[]): number[][] =>
        terms.map((_, ti) =>
          s.cellRow.map((row, ci) =>
            seen.has(ci)
              ? row.reduce((acc, x, c) => (design.term[c] === ti ? acc + x * cf[c] : acc), 0)
              : NaN
          )
        )
      const contrib = contribOf(coef)
      const ym = mean(g.y)
      const sst = g.y.reduce((acc, v) => acc + (v - ym) ** 2, 0)
      const rmsOf = (cb: number[][]): number[] =>
        cb.map((tc) => Math.sqrt(mean(g.cell.map((ci) => tc[ci] ** 2))))
      const rms = rmsOf(contrib)
      // On linear values, the effect size on log₂: the log₂ fitted means decomposed on the same
      // basis (the fit through every observation's fitted mean, so each cell weighs by its count).
      let rmsLog2 = rms
      if (!logScale) {
        const fittedAt = g.cell.map((ci) =>
          s.cellRow[ci].reduce((acc, x, c) => acc + x * coef[c], 0)
        )
        if (fittedAt.every((m) => m > 0)) {
          const { qy } = project(g.full.basis, fittedAt.map(Math.log2))
          const cf = new Array<number>(design.term.length).fill(0)
          backSolve(g.full.basis.R, qy).forEach((v, j) => (cf[g.full.basis.cols[j]] = v))
          rmsLog2 = rmsOf(contribOf(cf))
        } else rmsLog2 = terms.map(() => NaN)
      }
      const share = contrib.map((tc) =>
        sst > 0 ? g.cell.reduce((acc, ci) => acc + tc[ci] ** 2, 0) / sst : NaN
      )
      return {
        uniqID: g.uniqID,
        n: g.y.length,
        dfResid: d,
        s2,
        s2Post: post,
        dfTest,
        abundance,
        ss: g.ss,
        df: g.df,
        F,
        p,
        q: [],
        grand: coef[0],
        contrib,
        rms,
        rmsLog2,
        cellN: s.cells.map((_, ci) => g.cell.reduce((acc, c) => acc + (c === ci ? 1 : 0), 0)),
        share
      }
    })
    // q per term across this slice's genes
    terms.forEach((_, ti) => {
      const q = benjaminiHochberg(genes.map((g) => g.p[ti]))
      genes.forEach((g, i) => (g.q[ti] = q[i]))
    })
    const cellKey = (c: number[]): string => c.join(',')
    const contrasts = (input.contrasts ?? []).map((ct) => {
      const cr = contrastRows(factors, ct, s.cells, design, shared)
      const firstCell = cr.cells.length ? s.cells[cr.cells[0]] : undefined
      const rep = firstCell ? s.cellRows.get(cellKey(firstCell))?.[0] : undefined
      const ctxOf: Array<[ConditionKey, string | number | null]> = rep
        ? context.map((d) => [d, condValue(rep, d)])
        : []
      if (!cr.rows.length) return { genes: [], context: ctxOf }
      // g = Σ w·(the model row), shared by every gene
      const gAll = new Array<number>(design.term.length).fill(0)
      for (const { row, weight } of cr.rows) row.forEach((x, c) => (gAll[c] += weight * x))
      const out: AnovaContrastGene[] = []
      s.genes.forEach((g, gi) => {
        if (!cr.measured(new Set(g.cell))) return
        const fit = g.full
        const b = backSolve(fit.basis.R, fit.qy)
        // a model row restricted to this gene's kept columns
        const fit0 = (row: number[]): number[] => fit.basis.cols.map((c) => row[c])
        const gk = fit0(gAll)
        const estimate = gk.reduce((acc, v, j) => acc + v * b[j], 0)
        const v = forwardSolveT(fit.basis.R, gk).reduce((acc, x) => acc + x * x, 0)
        const gene = genes[gi]
        const se = Math.sqrt(gene.s2Post * v)
        const t = se > 0 ? estimate / se : NaN
        const p =
          Number.isFinite(t) && gene.dfTest > 0 ? studentTTwoSided(Math.abs(t), gene.dfTest) : NaN
        // the fold change: on log₂ values the estimate; on linear ones the log₂ ratio of the fitted
        // cell means, its SE by the delta method (∂/∂m of log₂ m is 1 / (m ln 2))
        let log2FC = estimate
        let fcSE = se
        if (!logScale) {
          const fit = cr.rows.map(({ row, weight }) => ({
            weight,
            row: fit0(row),
            m: fit0(row).reduce((acc, x, j) => acc + x * b[j], 0)
          }))
          if (fit.every((c) => c.m > 0)) {
            log2FC = fit.reduce((acc, c) => acc + (c.weight * Math.log(c.m)) / Math.LN2, 0)
            const G = new Array<number>(b.length).fill(0)
            for (const c of fit)
              c.row.forEach((x, j) => (G[j] += (c.weight / (c.m * Math.LN2)) * x))
            fcSE = Math.sqrt(
              gene.s2Post * forwardSolveT(g.full.basis.R, G).reduce((a, x) => a + x * x, 0)
            )
          } else {
            log2FC = NaN
            fcSE = NaN
          }
        }
        out.push({ uniqID: g.uniqID, estimate, se, log2FC, fcSE, t, df: gene.dfTest, p })
      })
      return { genes: out, context: ctxOf }
    })
    return {
      context: context.map(
        (d) => [d, condValue(s.rep, d)] as [ConditionKey, string | number | null]
      ),
      cells: s.cells,
      genes,
      contrasts
    }
  })
  return {
    scale: logScale ? 'log2' : 'linear',
    factors,
    ...(shared ? { sharedBaseline: shared } : null),
    terms,
    slices,
    context,
    fixed,
    ...(prior ? { prior } : null)
  }
}

/** What a result keeps of a run: the model's terms and per-gene fits (tests, attribution) per
 *  slice. The contrasts are the result's rows already; the prior keeps only its df (its trend is a
 *  function). Saved with the project, where a NaN reads back as null. */
export interface AnovaResult {
  scale: 'log2' | 'linear'
  variance: AnovaVariance
  maxOrder: number
  factors: AnovaFactor[]
  sharedBaseline?: SharedBaseline
  terms: AnovaTerm[]
  context: ConditionKey[]
  fixed: ConditionKey[]
  priorD0?: number
  slices: Array<Omit<AnovaSlice, 'contrasts'>>
}

export function anovaResult(run: AnovaRun, variance: AnovaVariance, maxOrder: number): AnovaResult {
  return {
    scale: run.scale,
    variance,
    maxOrder,
    factors: run.factors,
    ...(run.sharedBaseline ? { sharedBaseline: run.sharedBaseline } : null),
    terms: run.terms,
    context: run.context,
    fixed: run.fixed,
    ...(run.prior ? { priorD0: run.prior.d0 } : null),
    slices: run.slices.map(({ context, cells, genes }) => ({ context, cells, genes }))
  }
}

/** A contrast's weights over a slice's cells (by index): its sides' cells, averaged equally over
 *  every other factor's levels present at all of them. Empty when a cell it needs is absent. */
export function contrastWeights(
  factors: AnovaFactor[],
  ct: AnovaContrast,
  cells: number[][]
): Array<{ cell: number; weight: number }> {
  const sides = (ct.kind === 'main' ? [ct.a] : [ct.a, ct.b, ...(ct.rest ?? [])]).filter(
    (sd): sd is { factor: number; num: string; den: string } => !isSlopeSide(sd)
  )
  const lv = sides.map((sd) => ({
    f: sd.factor,
    num: factors[sd.factor].levels.indexOf(sd.num),
    den: factors[sd.factor].levels.indexOf(sd.den)
  }))
  if (lv.some((s) => s.num < 0 || s.den < 0)) return []
  // the corners: each side at num (+1) or den (−1); the sign is their product
  const corners: Array<{ at: Array<[number, number]>; sign: number }> = [{ at: [], sign: 1 }]
  for (const s of lv)
    corners.splice(
      0,
      corners.length,
      ...corners.flatMap((c) => [
        { at: [...c.at, [s.f, s.num] as [number, number]], sign: c.sign },
        { at: [...c.at, [s.f, s.den] as [number, number]], sign: -c.sign }
      ])
    )
  const fixedF = new Set(lv.map((s) => s.f))
  const others = factors.map((_, i) => i).filter((i) => !fixedF.has(i))
  // the other factors' level combinations present at every corner
  const otherKey = (c: number[]): string => others.map((i) => c[i]).join(',')
  const at = (c: number[], corner: (typeof corners)[number]): boolean =>
    corner.at.every(([f, l]) => c[f] === l)
  const combos = corners
    .map((corner) => new Set(cells.filter((c) => at(c, corner)).map(otherKey)))
    .reduce((a, b) => new Set([...a].filter((k) => b.has(k))))
  if (!combos.size) return []
  const out: Array<{ cell: number; weight: number }> = []
  for (const corner of corners)
    cells.forEach((c, i) => {
      if (at(c, corner) && combos.has(otherKey(c)))
        out.push({ cell: i, weight: corner.sign / combos.size })
    })
  return out
}

/**
 * A contrast as model rows with weights (Σ weight · row · coefficients is its estimate), the cells
 * it reads, and whether a gene's measured cells support it. Over levels only, the fitted means of
 * its cells (contrastWeights). With a slope side, its change per unit of x: the model row at the
 * slope's centre + 1 against at its centre (its per-unit slope; at a shared baseline, from the
 * baseline), times the categorical sides' corners, the other factors averaged as before (another
 * slope at its centre). A gene supports it when, at every categorical corner, it was measured at
 * two or more of each slope side's levels — under a shared baseline the control's cells (the
 * slope's lowest level) count for every level, and the control's own corner drops out (it has no
 * slope: a level's contrast against it is the level's own slope from the baseline).
 */
export function contrastRows(
  factors: AnovaFactor[],
  ct: AnovaContrast,
  cells: number[][],
  design: Pick<Design, 'rowOf' | 'centre'>,
  shared?: SharedBaseline
): {
  rows: Array<{ row: number[]; weight: number }>
  cells: number[]
  measured: (seen: Set<number>) => boolean
} {
  const all: ContrastSide[] = ct.kind === 'main' ? [ct.a] : [ct.a, ct.b, ...(ct.rest ?? [])]
  const slopes = all.filter(isSlopeSide).map((sd) => sd.factor)
  if (!slopes.length) {
    const w = contrastWeights(factors, ct, cells)
    return {
      rows: w.map(({ cell, weight }) => ({ row: design.rowOf(cells[cell]), weight })),
      cells: w.map((x) => x.cell),
      measured: (seen) => w.every(({ cell }) => seen.has(cell))
    }
  }
  const cat = all.filter((sd): sd is { factor: number; num: string; den: string } => !isSlopeSide(sd))
  const lv = cat.map((sd) => ({
    f: sd.factor,
    num: factors[sd.factor].levels.indexOf(sd.num),
    den: factors[sd.factor].levels.indexOf(sd.den)
  }))
  const none = { rows: [], cells: [], measured: () => false }
  if (lv.some((x) => x.num < 0 || x.den < 0)) return none
  const ctrl = shared ? factors[shared.factor].levels.indexOf(shared.control) : -1
  // the categorical corners, signed
  let corners: Array<{ at: Array<[number, number]>; sign: number }> = [{ at: [], sign: 1 }]
  for (const x of lv)
    corners = corners.flatMap((c) => [
      { at: [...c.at, [x.f, x.num] as [number, number]], sign: c.sign },
      { at: [...c.at, [x.f, x.den] as [number, number]], sign: -c.sign }
    ])
  const sideF = new Set([...lv.map((x) => x.f), ...slopes])
  const others = factors.map((_, i) => i).filter((i) => !sideF.has(i) && !factors[i].x)
  const otherKey = (c: number[]): string => others.map((i) => c[i]).join(',')
  const atCorner = (c: number[], corner: (typeof corners)[number]): boolean =>
    corner.at.every(([f, l]) => c[f] === l || (shared?.factor === f && c[f] === ctrl))
  // the other categorical factors' combinations present at every corner
  const combos = corners
    .map((corner) => new Set(cells.filter((c) => atCorner(c, corner)).map(otherKey)))
    .reduce((a, b) => new Set([...a].filter((k) => b.has(k))))
  if (!combos.size) return none
  const rows: Array<{ row: number[]; weight: number }> = []
  const read = new Set<number>()
  const needs: Array<{ cells: number[]; slope: number }> = []
  for (const corner of corners)
    for (const k of combos) {
      // under a shared baseline the control has no slope (it exists at the baseline only): its
      // corner adds nothing, so a level's row is its own slope from the baseline
      const isCtrl = corner.at.some(([f, l]) => shared?.factor === f && l === ctrl)
      if (isCtrl) continue
      const cell = factors.map(() => 0)
      for (const [f, l] of corner.at) cell[f] = l
      const ks = k ? k.split(',').map(Number) : []
      others.forEach((i, j) => (cell[i] = ks[j]))
      // every slope at its centre; each slope side, one up
      const base: Partial<Record<number, number>> = {}
      factors.forEach((f, i) => {
        if (f.x) base[i] = design.centre(i)
      })
      let parts: Array<{ at: Partial<Record<number, number>>; sign: number }> = [
        { at: base, sign: 1 }
      ]
      for (const f of slopes)
        parts = parts.flatMap((p) => [
          { at: { ...p.at, [f]: design.centre(f) + 1 }, sign: p.sign },
          { at: p.at, sign: -p.sign }
        ])
      for (const p of parts)
        rows.push({
          row: design.rowOf(cell, p.at),
          weight: (corner.sign * p.sign) / combos.size
        })
      const here = cells
        .map((c, i) => ({ c, i }))
        .filter(
          ({ c }) =>
            corner.at.every(([f, l]) => c[f] === l) && others.every((o, j) => c[o] === ks[j])
        )
        .map(({ i }) => i)
      {
        const baseCells = shared
          ? cells
              .map((c, i) => ({ c, i }))
              .filter(({ c }) => c[shared.factor] === ctrl && others.every((o, j) => c[o] === ks[j]))
              .map(({ i }) => i)
          : []
        for (const f of slopes) needs.push({ cells: [...here, ...baseCells], slope: f })
      }
      here.forEach((i) => read.add(i))
    }
  return {
    rows,
    cells: [...read],
    measured: (seen) =>
      needs.every(
        (n) => new Set(n.cells.filter((i) => seen.has(i)).map((i) => cells[i][n.slope])).size >= 2
      )
  }
}

/** Whether a contrast has the cells it needs on a set of design cells (the preview's question):
 *  its rows over these cells, with a gene measured in every one of them. */
export function contrastRuns(
  factors: AnovaFactor[],
  terms: AnovaTerm[],
  ct: AnovaContrast,
  cells: number[][],
  shared?: SharedBaseline
): boolean {
  const cr = contrastRows(factors, ct, cells, buildDesign(factors, terms, shared), shared)
  return cr.rows.length > 0 && cr.measured(new Set(cells.map((_, i) => i)))
}
