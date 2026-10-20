/**
 * What an ANOVA's own plots read from its model (CompareTableResult.anova): the slice on
 * show (its context matched to the facet's rows), each gene's shares of variation per factor
 * (the variance plot), and its fitted cell means with their replicates, on the plots' abundance
 * scale (the interaction plot).
 */
import type { AnovaGene, AnovaResult } from './anova'
import { condValue, valEq } from './compare'
import { ctxValue, type ContextRow } from './plotData'
import type { ValueScale } from './scale'
import type { StandardRow } from './types'

export type AnovaSliceResult = AnovaResult['slices'][number]

/** The slice whose context matches a facet's rows (its first row's context values); the first
 *  slice when there's no row, or nothing matches. */
export function anovaSliceFor(a: AnovaResult, row?: ContextRow): AnovaSliceResult | undefined {
  if (!row) return a.slices[0]
  return (
    a.slices.find((s) =>
      s.context.every(([d, v]) => String(ctxValue(row, d) ?? '') === String(v ?? ''))
    ) ?? a.slices[0]
  )
}

/** A NaN read back from a saved project is null: a number, or NaN. */
const num = (v: number | null | undefined): number => (typeof v === 'number' ? v : NaN)

export interface GeneShares {
  uniqID: string
  /** per term (AnovaResult.terms order): its share of the gene's variation, 0–1 */
  shares: number[]
  /** what the terms leave (1 − their sum, at least 0) */
  residual: number
  /** per term: its q */
  q: number[]
}

export function geneShares(g: AnovaGene): GeneShares {
  const shares = g.share.map((s) => Math.max(0, num(s)))
  const sum = shares.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  return {
    uniqID: g.uniqID,
    shares,
    residual: Math.max(0, 1 - sum),
    q: g.q.map(num)
  }
}

/** The genes ranked by their strongest term (smallest q across the terms, or `term`'s own). */
export function rankByQ(genes: AnovaGene[], term?: number): AnovaGene[] {
  const best = (g: AnovaGene): number => {
    const qs = (term == null ? g.q : [g.q[term]]).map(num).filter(Number.isFinite)
    return qs.length ? Math.min(...qs) : Infinity
  }
  return [...genes].sort((a, b) => best(a) - best(b))
}

/** A model-scale value on the plots' abundance scale. */
function toPlotScale(v: number, model: 'log2' | 'linear', plot: ValueScale): number {
  if (!Number.isFinite(v)) return NaN
  if (model === 'log2') return plot === 'log2' ? v : plot === 'log10' ? v * Math.log10(2) : 2 ** v
  if (plot === 'linear') return v
  return v > 0 ? (plot === 'log2' ? Math.log2(v) : Math.log10(v)) : NaN
}
/** A linear value (Clean data's rows) on the plots' abundance scale. */
const linearToPlot = (v: number, plot: ValueScale): number =>
  !Number.isFinite(v)
    ? NaN
    : plot === 'linear'
      ? v
      : v > 0
        ? plot === 'log2'
          ? Math.log2(v)
          : Math.log10(v)
        : NaN

export interface InteractionGene {
  uniqID: string
  /** [line level][x level]: the fitted cell mean, on the plot scale (NaN = a cell not measured) */
  means: number[][]
  /** [line level][x level]: the mean ± its standard error (√(residual variance / n), the model's
   *  own), on the plot scale — asymmetric there when the scale isn't the model's */
  lo: number[][]
  hi: number[][]
  /** [line level][x level]: the replicates' values, on the plot scale */
  reps: number[][][]
  /** a slope along x: each level's position on its axis (log₁₀ or its units), so the fitted
   *  straight lines are drawn to scale; absent: the levels evenly spaced */
  xPositions?: number[]
}

/** The interaction plot's factors (by index into the model's): x — `xFactor`, else the first — and
 *  the lines — `lineFactor` when it isn't x, else the first other factor; none for a one-way model.
 *  Any further factors are averaged. */
export function interactionAxes(
  a: Pick<AnovaResult, 'factors'>,
  xFactor?: string,
  lineFactor?: string
): { x: number; line: number | null } {
  const idx = (c?: string): number => a.factors.findIndex((f) => f.condition === c)
  const x = Math.max(0, idx(xFactor))
  const l = idx(lineFactor)
  const line = l >= 0 && l !== x ? l : a.factors.findIndex((_, i) => i !== x)
  return { x, line: line >= 0 ? line : null }
}

/**
 * One gene's interaction profile in a slice: the model's fitted cell means (grand mean plus every
 * term's contribution) across factor `x`'s levels, a line per level of factor `line` (one line for
 * a one-way model), and each cell's replicates from Clean data's rows — those at the cell's factor
 * levels and the slice's context (a cell measured at one context value only, a vehicle at dose 0,
 * serves every slice). With three or more factors, each point is the model's marginal mean: the
 * fitted means of the cells there, averaged equally over the other factors' levels present (its SE
 * from theirs), and its replicates are those cells' together.
 */
export function interactionGene(
  a: AnovaResult,
  slice: AnovaSliceResult,
  g: AnovaGene,
  axes: { x: number; line: number | null },
  plot: ValueScale,
  std?: StandardRow[]
): InteractionGene {
  const { x, line } = axes
  const nx = a.factors[x].levels.length
  const nl = line == null ? 1 : a.factors[line].levels.length
  const lineOf = (cell: number[]): number => (line == null ? 0 : cell[line])
  const grid = (): number[][] => Array.from({ length: nl }, () => new Array<number>(nx).fill(NaN))
  const means = grid()
  const lo = grid()
  const hi = grid()
  const reps = Array.from({ length: nl }, () => Array.from({ length: nx }, () => [] as number[]))
  // each cell's replicates found (a count for results kept before the fit carried its own)
  const found = new Array<number>(slice.cells.length).fill(0)
  const fits = slice.cells.map((cell, ci) => ({
    cell,
    ci,
    fit: num(g.grand + g.contrib.reduce((acc, tc) => acc + num(tc[ci]), 0))
  }))
  if (std) {
    // the gene's rows in the model: every factor at one of its levels
    const mine = std.filter(
      (r) =>
        r.uniqID === g.uniqID &&
        a.factors.every((f) => f.levels.some((l) => valEq(condValue(r, f.condition), l)))
    )
    const levelIs = (r: StandardRow, f: number, i: number): boolean =>
      valEq(condValue(r, a.factors[f].condition), a.factors[f].levels[i])
    // each design cell's replicates, at the slice's context on the context conditions the cell
    // varies on (as the model matched it: one it's invariant on — a vehicle at dose 0 only —
    // serves every slice)
    slice.cells.forEach((cell, ci) => {
      const at = mine.filter((r) => cell.every((li, f) => levelIs(r, f, li)))
      const varies = slice.context.filter(
        ([d]) => new Set(at.map((r) => String(condValue(r, d) ?? ''))).size > 1
      )
      const inCtx = at.filter((r) =>
        varies.every(([d, v]) => String(condValue(r, d) ?? '') === String(v ?? ''))
      )
      for (const r of inCtx) {
        const v = linearToPlot(num(r.value), plot)
        if (Number.isFinite(v)) {
          reps[lineOf(cell)][cell[x]].push(v)
          found[ci]++
        }
      }
    })
  }
  // per point: the cells there (one, unless further factors are averaged); a cell's count kept
  // with the fit (results from before it was: its replicates found here)
  const at = new Map<string, Array<{ fit: number; n: number }>>()
  for (const { cell, ci, fit } of fits) {
    if (!Number.isFinite(fit)) continue
    const k = `${lineOf(cell)},${cell[x]}`
    const n = num(g.cellN?.[ci]) || found[ci]
    const list = at.get(k)
    if (list) list.push({ fit, n })
    else at.set(k, [{ fit, n }])
  }
  for (const [k, cs] of at) {
    const [li, xi] = k.split(',').map(Number)
    const mean = cs.reduce((acc, c) => acc + c.fit, 0) / cs.length
    // Var(Σ m_i / k) = s² Σ (1 / n_i) / k²
    const inv = cs.reduce((acc, c) => acc + (c.n > 0 ? 1 / c.n : NaN), 0)
    const se = Math.sqrt(num(g.s2Post) * inv) / cs.length
    means[li][xi] = toPlotScale(mean, a.scale, plot)
    lo[li][xi] = toPlotScale(mean - se, a.scale, plot)
    hi[li][xi] = toPlotScale(mean + se, a.scale, plot)
  }
  // The vehicle design along its slope, a line per level of its factor: every level's line starts
  // from the shared baseline — the control at the slope's lowest level, the one point it has.
  const sb = a.sharedBaseline
  const xs = a.factors[x].x
  if (sb && xs && sb.slope === x && sb.factor === line) {
    const ctrl = a.factors[line].levels.indexOf(sb.control)
    const low = xs.indexOf(Math.min(...xs))
    for (let li = 0; li < nl; li++)
      if (li !== ctrl && ctrl >= 0 && !Number.isFinite(means[li][low])) {
        means[li][low] = means[ctrl][low]
        lo[li][low] = lo[ctrl][low]
        hi[li][low] = hi[ctrl][low]
      }
  }
  return { uniqID: g.uniqID, means, lo, hi, reps, ...(xs ? { xPositions: xs } : null) }
}
