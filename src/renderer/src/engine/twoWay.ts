/**
 * Two-way ANOVA: per-gene interaction effect for a 2×2 factorial design.
 *
 *   interaction = mean(y11) − mean(y10) − mean(y01) + mean(y00)
 *
 * with a Welch–Satterthwaite t-test on the interaction term. Reimplements
 * omicViz scripts/stats/comparisons.py `_interaction_ttest` + `_run_two_way_anova`
 * (see [[omicviz-conceptual-reuse]]). Values are analysed in log2 space, so the
 * interaction term is itself a log2 fold-change of fold-changes.
 *
 * If cmpd is one of the two factors, vehicle-norm asymmetric dose-exclusion is
 * applied: the treatment side is grouped by (dose, …) while the vehicle side is
 * matched on (…) with dose excluded (vehicle is always at dose 0).
 */
import type { CompareTableResult } from './direct'
import {
  condPresent,
  condValue,
  finaliseCompare,
  groupRowsBy,
  log2Pos,
  setCond,
  valEq,
  type RawStatRow
} from './compare'
import { aggregatePerGene, DEFAULT_THRESHOLD, studentTTwoSided, type ThresholdConfig } from './stats'
import type { ConditionKey, Pair, StandardRow } from './types'

export interface TwoWayFactor {
  condition: ConditionKey
  /** [numerator, denominator] level pairs for this factor */
  pairs: Pair[]
}

export interface TwoWayInput {
  rows: StandardRow[]
  /** exactly two factors */
  factors: [TwoWayFactor, TwoWayFactor]
  activeConditions: ConditionKey[]
  threshold?: ThresholdConfig
}

interface InteractionRow {
  uniqID: string
  log2FC: number
  pVal: number
}

/** Per-gene Welch–Satterthwaite interaction t-test over four 2×2 cells (log2 values). */
function interactionTTest(
  cell11: StandardRow[],
  cell10: StandardRow[],
  cell01: StandardRow[],
  cell00: StandardRow[]
): InteractionRow[] {
  const agg = (rows: StandardRow[]): ReturnType<typeof aggregatePerGene> =>
    aggregatePerGene(rows.map((r) => ({ uniqID: r.uniqID, value: log2Pos(r.value) })))
  const g11 = agg(cell11)
  const g10 = agg(cell10)
  const g01 = agg(cell01)
  const g00 = agg(cell00)

  const out: InteractionRow[] = []
  for (const [uniqID, a11] of g11) {
    const a10 = g10.get(uniqID)
    const a01 = g01.get(uniqID)
    const a00 = g00.get(uniqID)
    if (!a10 || !a01 || !a00) continue // gene must appear in all four cells

    // vi = si²/ni  (0 when n<2, matching omicViz fillna(0))
    const vi = (x: { n: number; variance: number }): number =>
      x.n > 1 && Number.isFinite(x.variance) ? x.variance / x.n : 0
    const v11 = vi(a11)
    const v10 = vi(a10)
    const v01 = vi(a01)
    const v00 = vi(a00)

    const interaction = a11.mean - a10.mean - a01.mean + a00.mean
    const varTotal = v11 + v10 + v01 + v00
    const seTotal = Math.sqrt(Math.max(varTotal, 0))

    // Welch–Satterthwaite degrees of freedom (clip to ≥ 1)
    const contrib = (x: { n: number }, v: number): number => (x.n > 1 ? (v * v) / (x.n - 1) : 0)
    const wsDen = contrib(a11, v11) + contrib(a10, v10) + contrib(a01, v01) + contrib(a00, v00)
    const wsNum = varTotal * varTotal
    let df = wsDen > 0 ? wsNum / wsDen : 1
    if (df < 1) df = 1

    let pVal = NaN
    if (seTotal > 0 && Number.isFinite(interaction)) {
      pVal = studentTTwoSided(Math.abs(interaction / seTotal), df)
    }
    out.push({ uniqID, log2FC: interaction, pVal })
  }
  return out
}

/** Build a raw comparison row from an interaction result (means/sd absent for two-way). */
function rawFrom(
  w: InteractionRow,
  cmpCond: string,
  comparison: string,
  conds: Array<[ConditionKey, string | number | null]>
): RawStatRow {
  const row: RawStatRow = {
    uniqID: w.uniqID,
    cmp_cond: cmpCond,
    comparison,
    mean1: NaN,
    mean2: NaN,
    sd1: NaN,
    sd2: NaN,
    log2FC: w.log2FC,
    pVal: w.pVal
  }
  for (const [c, v] of conds) setCond(row, c, v)
  return row
}

export function runTwoWayAnova(input: TwoWayInput): CompareTableResult {
  const { rows, factors, activeConditions } = input
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const [f1, f2] = factors

  const cmpdFactor = factors.find((f) => f.condition === 'cmpd')
  const otherFactor = factors.find((f) => f.condition !== 'cmpd')

  const raw: RawStatRow[] = []
  const comparisons: string[] = []
  const note = (label: string): void => {
    if (!comparisons.includes(label)) comparisons.push(label)
  }

  if (cmpdFactor && otherFactor) {
    // ── Asymmetric: cmpd factor uses vehicle-norm dose-exclusion ──────────────
    const otherCond = otherFactor.condition
    const trtDims = activeConditions.filter(
      (c) => c !== 'cmpd' && c !== otherCond && condPresent(rows, c)
    )
    const vehDims = trtDims.filter((c) => c !== 'dose')

    for (const [numC, denC] of cmpdFactor.pairs) {
      const dfTrt = rows.filter((r) => valEq(condValue(r, 'cmpd'), numC))
      const dfVeh = rows.filter((r) => valEq(condValue(r, 'cmpd'), denC))

      for (const [numS, denS] of otherFactor.pairs) {
        const cmpStr = `${numC}|${denC} × ${numS}|${denS}`
        note(cmpStr)

        for (const ctxTrt of groupRowsBy(dfTrt, trtDims).values()) {
          const rep = ctxTrt[0]
          const c11 = ctxTrt.filter((r) => valEq(condValue(r, otherCond), numS))
          const c10 = ctxTrt.filter((r) => valEq(condValue(r, otherCond), denS))

          // vehicle slice matched on veh dims (dose excluded) of this context
          const vehSlice = dfVeh.filter((r) =>
            vehDims.every((d) => valEq(condValue(r, d), condValue(rep, d) as string | number))
          )
          const c01 = vehSlice.filter((r) => valEq(condValue(r, otherCond), numS))
          const c00 = vehSlice.filter((r) => valEq(condValue(r, otherCond), denS))
          if (!c11.length || !c10.length || !c01.length || !c00.length) continue

          const ctx: Array<[ConditionKey, string | number | null]> = [
            ['cmpd', numC],
            [otherCond, numS],
            ...trtDims.map((d) => [d, condValue(rep, d)] as [ConditionKey, string | number | null])
          ]
          for (const w of interactionTTest(c11, c10, c01, c00)) {
            raw.push(rawFrom(w, `cmpd:${otherCond}`, cmpStr, ctx))
          }
        }
      }
    }
  } else {
    // ── Symmetric: neither factor is cmpd ─────────────────────────────────────
    const cond1 = f1.condition
    const cond2 = f2.condition
    const groupConds = activeConditions.filter(
      (c) => c !== cond1 && c !== cond2 && condPresent(rows, c)
    )

    for (const [num1, den1] of f1.pairs) {
      for (const [num2, den2] of f2.pairs) {
        const cmpStr = `${num1}|${den1} × ${num2}|${den2}`
        note(cmpStr)

        for (const grp of groupRowsBy(rows, groupConds).values()) {
          const rep = grp[0]
          const m1n = (r: StandardRow): boolean => valEq(condValue(r, cond1), num1)
          const m1d = (r: StandardRow): boolean => valEq(condValue(r, cond1), den1)
          const m2n = (r: StandardRow): boolean => valEq(condValue(r, cond2), num2)
          const m2d = (r: StandardRow): boolean => valEq(condValue(r, cond2), den2)

          const c11 = grp.filter((r) => m1n(r) && m2n(r))
          const c10 = grp.filter((r) => m1n(r) && m2d(r))
          const c01 = grp.filter((r) => m1d(r) && m2n(r))
          const c00 = grp.filter((r) => m1d(r) && m2d(r))
          if (!c11.length || !c10.length || !c01.length || !c00.length) continue

          const ctx: Array<[ConditionKey, string | number | null]> = [
            [cond1, num1],
            [cond2, num2],
            ...groupConds.map(
              (d) => [d, condValue(rep, d)] as [ConditionKey, string | number | null]
            )
          ]
          for (const w of interactionTTest(c11, c10, c01, c00)) {
            raw.push(rawFrom(w, `${cond1}:${cond2}`, cmpStr, ctx))
          }
        }
      }
    }
  }

  return { rows: finaliseCompare(raw, threshold), comparisons }
}
