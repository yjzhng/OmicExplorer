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
 * Context (every other present condition) is matched like-for-like across the four cells — except
 * that a cell is never matched on a condition it is invariant on (a vehicle that only exists at
 * dose 0 has no dose to match; its single slice serves every treated dose). That is the general
 * form of the classic vehicle-norm "dose excluded on the vehicle side"; nothing is keyed on the
 * compound's name or on dose specifically.
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
import type { CondSelector, ConditionKey, Pair, StandardRow } from './types'

export interface TwoWayFactor {
  condition: ConditionKey
  /** [numerator, denominator] level pairs for this factor */
  pairs: Pair[]
}

/** All (numerator, denominator) level pairs for one factor from multi-select numerator/denominator
 *  levels — a two-way run loops these, so e.g. "drugA, drugB vs DMSO" becomes two 2×2 ANOVAs. A
 *  level paired with itself is dropped (degenerate). */
export function crossPairs(numLevels: string[], denLevels: string[]): Pair[] {
  const out: Pair[] = []
  for (const n of numLevels) for (const d of denLevels) if (n !== d) out.push([n, d])
  return out
}

export interface TwoWayInput {
  rows: StandardRow[]
  /** exactly two factors */
  factors: [TwoWayFactor, TwoWayFactor]
  activeConditions: ConditionKey[]
  threshold?: ThresholdConfig
  /** the dialog's side selectors: a NON-factor condition pinned (to the same values) on both is
   *  an inclusion filter on the context — only those values take part */
  num?: CondSelector
  den?: CondSelector
}

/** One 2×2 to test: the four cells for a (pair₁, pair₂) at one matched context. */
interface TwoWayCell {
  pair1: Pair
  pair2: Pair
  c11: StandardRow[]
  c10: StandardRow[]
  c01: StandardRow[]
  c00: StandardRow[]
  /** context condition → value (from the c11 representative) */
  context: Array<[ConditionKey, string | number | null]>
}

/** Rows restricted to the context inclusion filters (a non-factor condition pinned on both sides). */
function applyInclusion(input: TwoWayInput): StandardRow[] {
  const { num, den, factors, activeConditions } = input
  if (!num || !den) return input.rows
  const factorConds = new Set(factors.map((f) => f.condition))
  const filters = activeConditions.filter(
    (c) => !factorConds.has(c) && (num[c]?.length ?? 0) > 0 && (den[c]?.length ?? 0) > 0
  )
  if (filters.length === 0) return input.rows
  return input.rows.filter((r) =>
    filters.every((c) => (num[c] as string[]).some((v) => valEq(condValue(r, c), v)))
  )
}

/** Enumerate every 2×2 the design yields, and which context conditions ended up not matched on
 *  some cell because that cell is invariant on them (reported so the preview can say so). */
function twoWayCells(input: TwoWayInput): { cells: TwoWayCell[]; context: ConditionKey[]; fixed: ConditionKey[] } {
  const rows = applyInclusion(input)
  const { factors, activeConditions } = input
  const [f1, f2] = factors
  const cond1 = f1.condition
  const cond2 = f2.condition
  const ctxDims = activeConditions.filter(
    (c) => c !== cond1 && c !== cond2 && condPresent(rows, c)
  )
  const fixed = new Set<ConditionKey>()
  const cells: TwoWayCell[] = []
  // The context dims a set of rows actually varies on — a cell is matched only on those.
  const varying = (cellRows: StandardRow[]): ConditionKey[] =>
    ctxDims.filter((d) => new Set(cellRows.map((r) => String(condValue(r, d) ?? ''))).size > 1)
  for (const pair1 of f1.pairs) {
    for (const pair2 of f2.pairs) {
      const [n1, d1] = pair1
      const [n2, d2] = pair2
      const is = (r: StandardRow, c: ConditionKey, v: string): boolean => valEq(condValue(r, c), v)
      const all11 = rows.filter((r) => is(r, cond1, n1) && is(r, cond2, n2))
      const all10 = rows.filter((r) => is(r, cond1, n1) && is(r, cond2, d2))
      const all01 = rows.filter((r) => is(r, cond1, d1) && is(r, cond2, n2))
      const all00 = rows.filter((r) => is(r, cond1, d1) && is(r, cond2, d2))
      const dims = [all11, all10, all01, all00].map(varying)
      for (const cellRows of [all10, all01, all00])
        for (const d of ctxDims) if (!varying(cellRows).includes(d) && dims[0].includes(d)) fixed.add(d)
      // Contexts are driven by the c11 cell (the "treated × level 1" corner), grouped on every
      // context dim it varies on; each other cell is sliced to that context on the dims IT varies on.
      const slice = (cellRows: StandardRow[], onDims: ConditionKey[], rep: StandardRow): StandardRow[] =>
        cellRows.filter((r) =>
          onDims.every((d) => valEq(condValue(r, d), condValue(rep, d) as string | number))
        )
      for (const c11 of groupRowsBy(all11, dims[0]).values()) {
        const rep = c11[0]
        const c10 = slice(all10, dims[1], rep)
        const c01 = slice(all01, dims[2], rep)
        const c00 = slice(all00, dims[3], rep)
        if (!c11.length || !c10.length || !c01.length || !c00.length) continue
        cells.push({
          pair1,
          pair2,
          c11,
          c10,
          c01,
          c00,
          context: ctxDims.map((d) => [d, condValue(rep, d)] as [ConditionKey, string | number | null])
        })
      }
    }
  }
  return { cells, context: ctxDims, fixed: ctxDims.filter((d) => fixed.has(d)) }
}

interface InteractionRow {
  uniqID: string
  log2FC: number
  pVal: number
  /** SE of the interaction term (the t-test denominator) — the two-way FC's uncertainty. */
  fcSE: number
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
    out.push({ uniqID, log2FC: interaction, pVal, fcSE: seTotal > 0 ? seTotal : NaN })
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
    pVal: w.pVal,
    fcSE: w.fcSE
  }
  for (const [c, v] of conds) setCond(row, c, v)
  return row
}

export function runTwoWayAnova(input: TwoWayInput): CompareTableResult {
  const { factors } = input
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const [f1, f2] = factors
  const raw: RawStatRow[] = []
  const comparisons: string[] = []
  const { cells } = twoWayCells(input)
  for (const cell of cells) {
    const [n1, d1] = cell.pair1
    const [n2, d2] = cell.pair2
    const cmpStr = `${n1}|${d1} × ${n2}|${d2}`
    if (!comparisons.includes(cmpStr)) comparisons.push(cmpStr)
    const ctx: Array<[ConditionKey, string | number | null]> = [
      [f1.condition, n1],
      [f2.condition, n2],
      ...cell.context
    ]
    for (const w of interactionTTest(cell.c11, cell.c10, cell.c01, cell.c00)) {
      raw.push(rawFrom(w, `${f1.condition}:${f2.condition}`, cmpStr, ctx))
    }
  }
  return { rows: finaliseCompare(raw, threshold), comparisons, threshold }
}

/** A dry-run of the two-way grouping for the config dialog: the interaction is computed once per
 *  context combination (every non-factor condition, matched like-for-like) that has a complete
 *  2×2. Returns those context labels + the count, mirroring runTwoWayAnova's grouping. */
export interface TwoWayPreview {
  /** "cmpd × dose" */
  factors: string
  /** conditions faceting the interaction (matched like-for-like) */
  context: ConditionKey[]
  /** table headers: [factor1, factor2, ...context dims] */
  columns: string[]
  /** table body, one row per context combo with a full 2×2 (aligned to `columns`) */
  rows: string[][]
  groups: number
  /** context conditions some cell is invariant on (so not matched there — its single slice serves
   *  every level of the others), e.g. dose on a vehicle that only exists at 0 */
  fixed: ConditionKey[]
  warnings: string[]
}

export function previewTwoWay(input: TwoWayInput): TwoWayPreview {
  const [f1, f2] = input.factors
  const { cells, context, fixed } = twoWayCells(input)
  const tableRows: string[][] = cells.map((cell) => {
    const p1 = `${cell.pair1[0]}|${cell.pair1[1]}`
    const p2 = `${cell.pair2[0]}|${cell.pair2[1]}`
    return [`${p1} × ${p2}`, p1, p2, ...cell.context.map(([, v]) => String(v ?? ''))]
  })
  const warnings: string[] = []
  if (tableRows.length === 0)
    warnings.push('No context has a complete 2×2 — some cell (factor-level combination) has no rows.')
  return {
    factors: `${f1.condition} × ${f2.condition}`,
    context,
    columns: ['comparison', f1.condition, f2.condition, ...context],
    rows: tableRows,
    groups: tableRows.length,
    fixed,
    warnings
  }
}
