/** What a dataset's shape allows a Compare to run: replicates for a t-test / 2-way ANOVA, two
 *  factors for the ANOVA, a numeric condition with enough points for a curve fit. Read off Clean
 *  data's sample list (the samplesheet, as imported), so an analysis the data can't support is
 *  ruled out before it's picked. */
import { condValue, numValue } from './compare'
import {
  isNumericCond,
  numericOf,
  type ConditionKey,
  type CustomConditionKey,
  type NumericConds,
  type SampleConds,
  type StandardRow
} from './types'

/** Without a sample list (a result saved before it was kept), the genes the shape is read from,
 *  at each end of the rows: every gene carries the same samples, so a handful tells. */
const SAMPLE_GENES = 25

export interface DataShape {
  /** distinct values each active condition takes */
  levels: Partial<Record<ConditionKey, number>>
  /** how many condition groups hold replicates (≥2 values of one gene) — a t-test needs two:
   *  one per side, each with a variance */
  replicatedGroups: number
  /** per numeric condition present: the most points any context (the other conditions held
   *  fixed) has off its lowest level — the treated points a curve over it would fit */
  treated: Partial<Record<ConditionKey, number>>
  /** the active conditions that are numeric (dose, time, any declared numeric): what a curve can
   *  run over */
  numeric: ConditionKey[]
}

/** A 4-parameter logistic needs more than 4 points; the control is one of them (see fitCurve). */
export const CURVE_MIN_TREATED = 4

/** What dataShape reads: a Clean data result (or a pool of them). */
export interface ShapeSource {
  rows: StandardRow[]
  samples?: SampleConds[]
  activeConditions: ConditionKey[]
  /** its declared numeric custom conditions (see numericOf) */
  numericConditions?: readonly CustomConditionKey[]
}

const cache = new WeakMap<ShapeSource, DataShape>()

export function dataShape(std: ShapeSource): DataShape {
  const hit = cache.get(std)
  if (hit) return hit
  // The sample list is one "gene" carrying every sample — a few dozen entries, not the rows.
  const shape = std.samples
    ? computeShape(
        std.samples.map((s) => ({ ...s, uniqID: '', value: null })),
        std.activeConditions,
        numericOf(std)
      )
    : computeShape(std.rows, std.activeConditions, numericOf(std))
  cache.set(std, shape)
  return shape
}

const str = (r: StandardRow, c: ConditionKey): string => {
  const v = condValue(r, c)
  return v == null ? '' : String(v)
}

function computeShape(
  rows: StandardRow[],
  active: readonly ConditionKey[],
  numericConds: NumericConds
): DataShape {
  const levelSets = new Map<ConditionKey, Set<string>>(active.map((c) => [c, new Set()]))
  // The sampled genes: the first and the last few — pooled datasets append one after the other, so
  // both ends are read. Everything is read off these genes alone; a full pass over every
  // gene × sample row would cost far more than the answer needs.
  const genes = new Set<string>()
  const take = (i: number, n: number): number => {
    if (genes.has(rows[i].uniqID)) return n
    genes.add(rows[i].uniqID)
    return n + 1
  }
  for (let i = 0, n = 0; i < rows.length && n < SAMPLE_GENES; i++) n = take(i, n)
  for (let i = rows.length - 1, n = 0; i >= 0 && n < SAMPLE_GENES; i--) n = take(i, n)
  // (gene, condition group) → replicate count
  const reps = new Map<string, number>()
  const numeric = active.filter((c) => isNumericCond(c, numericConds))
  // per numeric axis: (gene, context without the axis) → the axis values seen
  const along = new Map<ConditionKey, Map<string, number[]>>(numeric.map((a) => [a, new Map()]))
  for (const r of rows) {
    if (!genes.has(r.uniqID)) continue
    const group = active.map((c) => str(r, c))
    active.forEach((c, i) => {
      if (group[i] !== '') levelSets.get(c)!.add(group[i])
    })
    const gk = `${r.uniqID}\u0001${group.join('\u0001')}`
    reps.set(gk, (reps.get(gk) ?? 0) + 1)
    for (const a of numeric) {
      const x = numValue(r, a)
      if (x == null) continue
      const ctx = `${r.uniqID}\u0001${active.map((c, i) => (c === a ? '' : group[i])).join('\u0001')}`
      const m = along.get(a)!
      const xs = m.get(ctx)
      if (xs) xs.push(x)
      else m.set(ctx, [x])
    }
  }
  const levels: DataShape['levels'] = {}
  for (const [c, s] of levelSets) levels[c] = s.size
  // Per gene, the groups with ≥2 values; the best-covered gene speaks for the dataset.
  const perGene = new Map<string, number>()
  for (const [gk, n] of reps) {
    if (n < 2) continue
    const g = gk.slice(0, gk.indexOf('\u0001'))
    perGene.set(g, (perGene.get(g) ?? 0) + 1)
  }
  const replicatedGroups = Math.max(0, ...perGene.values())
  const treated: DataShape['treated'] = {}
  for (const [a, m] of along) {
    let best = 0
    for (const xs of m.values()) {
      const lo = Math.min(...xs)
      best = Math.max(best, xs.filter((x) => x > lo).length)
    }
    treated[a] = best
  }
  return { levels, replicatedGroups, treated, numeric }
}

export type CompareAnalysis = 'compare' | 'anova' | 'curve_fit'

/** Why the data can't take this analysis — null when it can. */
export function analysisUnmet(shape: DataShape, analysis: CompareAnalysis): string | null {
  const factors = Object.values(shape.levels).filter((n) => (n ?? 0) >= 2).length
  const noReps = 'Needs replicates on both sides'
  if (analysis === 'compare') {
    if (factors < 1) return 'Needs a condition with at least two values to compare'
    return shape.replicatedGroups < 2 ? noReps : null
  }
  // the ANOVA: a factor of three or more levels (one-way), or two factors — at two levels
  // of one condition the t-test answers it
  if (analysis === 'anova') {
    const multi = Object.values(shape.levels).some((n) => (n ?? 0) >= 3)
    if (factors < 2 && !multi)
      return 'Needs a condition with at least three values, or two conditions with two or more each'
    return shape.replicatedGroups < 2 ? noReps : null
  }
  const axes = shape.numeric.filter((a) => (shape.levels[a] ?? 0) >= 2)
  if (axes.length === 0) return 'Needs a numeric condition with at least two values'
  if (axes.every((a) => (shape.treated[a] ?? 0) < CURVE_MIN_TREATED))
    return `Needs at least ${CURVE_MIN_TREATED} points beyond the lowest dose / time (a 4-parameter fit)`
  return null
}
