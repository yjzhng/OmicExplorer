/**
 * The Compare's ANOVA: the compared conditions as factors, each at the levels
 * its pairs name (the test levels and the control), in one model per context on the n-way ANOVA
 * (anova.ts) — the full factorial, no interaction cap. Its rows:
 *
 *  - overall, signed: with one factor, each test level against the control; with two or more, the
 *    n-way interaction of every combination of the factors' pairs — at two factors the 2×2
 *
 *      interaction = mean(y11) − mean(y10) − mean(y01) + mean(y00)
 *
 *    in log₂ (a log₂ fold-change of fold-changes), at three the 2×2×2 (that 2×2 at num₃ minus it
 *    at den₃) — each a contrast of the fitted cell means, tested on the model's residual variance
 *    (moderated by default, pooled over every cell);
 *  - one per model term (`term`), unsigned: the term's effect size and its F-test.
 *
 * `variance: 'welch'` keeps the former two-factor test — a Welch–Satterthwaite t-test on the four
 * cells alone, omicViz's scripts/stats/comparisons.py `_interaction_ttest` + `_run_two_way_anova`
 * (see [[omicviz-conceptual-reuse]]) — for parity with omicViz.
 *
 * Context (every other present condition) is matched like-for-like across the cells — except that
 * a cell is never matched on a condition it is invariant on (a vehicle that only exists at dose 0
 * has no dose to match; its single slice serves every treated dose). That is the general form of
 * the classic vehicle-norm "dose excluded on the vehicle side"; nothing is keyed on the compound's
 * name or on dose specifically.
 */
import {
  anovaLayout,
  anovaResult,
  anovaTerms,
  contrastRuns,
  factorWidth,
  runAnova,
  termDf,
  type AnovaContrast,
  type AnovaFactor,
  type AnovaVariance,
  type ContrastSide,
  type SharedBaseline
} from './anova'
import type { AxisScale } from './axisModel'
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
import {
  aggregatePerGene,
  DEFAULT_THRESHOLD,
  studentTTwoSided,
  type ThresholdConfig
} from './stats'
import {
  condLabel,
  type CondSelector,
  type ConditionKey,
  type Pair,
  type StandardRow
} from './types'

/** A compared condition as an ANOVA factor: its [numerator, denominator] level pairs (the test
 *  levels against the control) — its levels in the model, and its overall rows. */
export interface AnovaFactorPick {
  condition: ConditionKey
  /** [numerator, denominator] level pairs for this factor */
  pairs: Pair[]
  /** a numeric condition as a slope, on this axis scale (absent: a factor at its levels) — its
   *  levels the pairs' all the same */
  slope?: AxisScale
}

/** All (numerator, denominator) level pairs for one factor from multi-select numerator/denominator
 *  levels — a two-way run loops these, so e.g. "drugA, drugB vs DMSO" becomes two 2×2 ANOVAs. A
 *  level paired with itself is dropped (degenerate). */
export function crossPairs(numLevels: string[], denLevels: string[]): Pair[] {
  const out: Pair[] = []
  for (const n of numLevels) for (const d of denLevels) if (n !== d) out.push([n, d])
  return out
}

export interface FactorAnovaInput {
  rows: StandardRow[]
  /** one or more factors (the compared conditions) */
  factors: AnovaFactorPick[]
  activeConditions: ConditionKey[]
  threshold?: ThresholdConfig
  /** the dialog's side selectors: a NON-factor condition pinned (to the same values) on both is
   *  an inclusion filter on the context — only those values take part */
  num?: CondSelector
  den?: CondSelector
  /** the residual variance the overall rows are tested on: the model's, moderated (default) or each
   *  gene's own pooled over the cells; or 'welch' — the former per-2×2 Welch test (omicViz parity;
   *  two factors only) */
  variance?: AnovaVariance | 'welch'
  /** test on log₂ values (default), or on the values as they are — Clean data's scale, as the
   *  t-test follows it (the fold change is a log₂ ratio either way). The former Welch test always
   *  logs, as omicViz did. */
  transform?: boolean
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
function applyInclusion(input: FactorAnovaInput): StandardRow[] {
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
function twoWayCells(input: FactorAnovaInput): {
  cells: TwoWayCell[]
  context: ConditionKey[]
  fixed: ConditionKey[]
} {
  const rows = applyInclusion(input)
  const { factors, activeConditions } = input
  const [f1, f2] = factors
  const cond1 = f1.condition
  const cond2 = f2.condition
  const ctxDims = activeConditions.filter((c) => c !== cond1 && c !== cond2 && condPresent(rows, c))
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
        for (const d of ctxDims)
          if (!varying(cellRows).includes(d) && dims[0].includes(d)) fixed.add(d)
      // Contexts are driven by the c11 cell (the "treated × level 1" corner), grouped on every
      // context dim it varies on; each other cell is sliced to that context on the dims IT varies on.
      const slice = (
        cellRows: StandardRow[],
        onDims: ConditionKey[],
        rep: StandardRow
      ): StandardRow[] =>
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
          context: ctxDims.map(
            (d) => [d, condValue(rep, d)] as [ConditionKey, string | number | null]
          )
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

/** A factor's levels in the model: every level its pairs name, numerators first. */
const levelsOf = (f: AnovaFactorPick): string[] => [
  ...new Set([...f.pairs.map((p) => p[0]), ...f.pairs.map((p) => p[1])])
]

/** The overall rows' contrasts: one factor, each pair (a test level against the control) — or a
 *  slope's own change per unit; two or more, the n-way interaction of every combination of the
 *  factors' pairs (a 2×2 at two factors, a 2×2×2 at three), a slope taking part through its
 *  per-unit change (so with a factor, the difference of its slopes). Labelled as the Compare window
 *  states them. */
function overallContrasts(factors: AnovaFactorPick[]): Array<{
  contrast: AnovaContrast
  label: string
  /** each categorical factor's numerator level (the row's value of it) */
  at: Array<[ConditionKey, string]>
  /** per factor, its part of the label ("A|DMSO", "dose slope") */
  parts: string[]
  /** a slope takes part */
  slope: boolean
}> {
  type Side = { side: ContrastSide; part: string; at?: [ConditionKey, string] }
  const sidesOf = (f: AnovaFactorPick, factor: number): Side[] =>
    f.slope
      ? [{ side: { factor, slope: true }, part: `${condLabel(f.condition)} slope` }]
      : f.pairs.map(([n, d]) => ({
          side: { factor, num: n, den: d },
          part: `${n}|${d}`,
          at: [f.condition, n] as [ConditionKey, string]
        }))
  const slope = factors.some((f) => f.slope)
  if (factors.length === 1)
    return sidesOf(factors[0], 0).map((x) => ({
      contrast: { kind: 'main', a: x.side },
      label: factors[0].slope ? x.part : x.part.replace('|', ' | '),
      at: x.at ? [x.at] : [],
      parts: [x.part],
      slope
    }))
  let combos: Side[][] = [[]]
  factors.forEach((f, i) => (combos = combos.flatMap((c) => sidesOf(f, i).map((x) => [...c, x]))))
  return combos.map((c) => ({
    contrast: {
      kind: 'interaction',
      a: c[0].side,
      b: c[1].side,
      rest: c.slice(2).map((x) => x.side)
    },
    label: c.map((x) => x.part).join(' × '),
    at: c.flatMap((x) => (x.at ? [x.at] : [])),
    parts: c.map((x) => x.part),
    slope
  }))
}

/** A slope's level positions: on a log axis log₁₀ of each level, a 0 (or below) one step below
 *  the lowest — the step the median of the levels' log₁₀ spacing (one decade with a single level
 *  above 0), as a Curve fit places its baseline; on a linear axis the levels in their own units. */
export function slopePositions(levels: readonly string[], scale: AxisScale): number[] {
  const v = levels.map(Number)
  if (scale === 'linear') return v
  const lx = [...new Set(v.filter((x) => x > 0))].sort((a, b) => a - b).map(Math.log10)
  const steps = lx
    .slice(1)
    .map((x, i) => x - lx[i])
    .sort((a, b) => a - b)
  const step = steps.length ? steps[steps.length >> 1] : 1
  return v.map((x) => (x > 0 ? Math.log10(x) : (lx[0] ?? 0) - step))
}

const modelFactors = (factors: AnovaFactorPick[]): AnovaFactor[] =>
  factors.map((f) => {
    const levels = levelsOf(f)
    return f.slope
      ? { condition: f.condition, levels, x: slopePositions(levels, f.slope) }
      : { condition: f.condition, levels }
  })

/**
 * The vehicle design, from the data: a categorical factor whose one control exists only at a
 * slope's lowest level, where no other of its levels is (DMSO only at dose 0, the compounds only
 * above it). Its slope then runs from a shared baseline — the control (SharedBaseline).
 */
export function sharedBaselineOf(input: FactorAnovaInput): SharedBaseline | undefined {
  const rows = applyInclusion(input)
  const af = modelFactors(input.factors)
  const inModel = rows.filter((r) =>
    af.every((f) => f.levels.some((l) => valEq(condValue(r, f.condition), l)))
  )
  for (const [fi, f] of input.factors.entries()) {
    if (f.slope) continue
    const ctrl = [...new Set(f.pairs.map((p) => p[1]))]
    if (ctrl.length !== 1) continue
    for (const [si, s] of af.entries()) {
      if (!s.x) continue
      const low = s.levels[s.x.indexOf(Math.min(...s.x))]
      const isCtrl = (r: StandardRow): boolean => valEq(condValue(r, f.condition), ctrl[0])
      const atLow = (r: StandardRow): boolean => valEq(condValue(r, s.condition), low)
      const c = inModel.filter(isCtrl)
      const t = inModel.filter((r) => !isCtrl(r))
      if (c.length && t.length && c.every(atLow) && !t.some(atLow))
        return { factor: fi, slope: si, control: ctrl[0] }
    }
  }
  return undefined
}

export function runFactorAnova(input: FactorAnovaInput): CompareTableResult {
  if (input.variance === 'welch' && input.factors.length === 2) return runTwoWayWelch(input)
  const variance: AnovaVariance = input.variance === 'plain' ? 'plain' : 'moderated'
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const { factors } = input
  const cmpCond = factors.map((f) => f.condition).join(':')
  const overall = overallContrasts(factors)
  // the full factorial: every interaction up to all the factors (no cap)
  const maxOrder = factors.length
  const sharedBaseline = sharedBaselineOf(input)
  const run = runAnova({
    rows: input.rows,
    factors: modelFactors(factors),
    activeConditions: input.activeConditions,
    maxOrder,
    sharedBaseline,
    variance,
    logScale: input.transform ?? true,
    contrasts: overall.map((o) => o.contrast),
    num: input.num,
    den: input.den
  })
  const raw: RawStatRow[] = []
  // Every row's F-test, by index (raw rows carry none; finaliseCompare keeps their order): an
  // overall row's one-df contrast as F = t² on (1, the residual df) — the same test as its t — and
  // a term's own.
  const testOf: Array<{ F: number; df1: number; df2: number }> = []
  const isTerm: boolean[] = []
  const isSlope: boolean[] = []
  const comparisons: string[] = []
  overall.forEach(({ label, at, slope }, k) => {
    for (const slice of run.slices) {
      const ct = slice.contrasts[k]
      if (!ct.genes.length) continue
      if (!comparisons.includes(label)) comparisons.push(label)
      const ctx: Array<[ConditionKey, string | number | null]> = [...at, ...ct.context]
      for (const g of ct.genes) {
        raw.push(
          rawFrom(
            { uniqID: g.uniqID, log2FC: g.log2FC, pVal: g.p, fcSE: g.fcSE > 0 ? g.fcSE : NaN },
            cmpCond,
            label,
            ctx
          )
        )
        testOf.push({ F: g.t * g.t, df1: 1, df2: g.df })
        isTerm.push(false)
        isSlope.push(slope)
      }
    }
  })
  // The model's terms, a row per gene each: comparison = the term, log2FC its unsigned effect size
  // (log₂), p its F-test — after the overall rows, so theirs keep their places. A term the design
  // can't estimate (no df left: a nested design) has none.
  run.terms.forEach((t, ti) => {
    for (const slice of run.slices) {
      const genes = slice.genes.filter((g) => g.df[ti] > 0)
      if (!genes.length) continue
      if (!comparisons.includes(t.label)) comparisons.push(t.label)
      for (const g of genes) {
        raw.push(
          rawFrom(
            { uniqID: g.uniqID, log2FC: g.rmsLog2[ti], pVal: g.p[ti], fcSE: NaN },
            cmpCond,
            t.label,
            slice.context
          )
        )
        testOf.push({ F: g.F[ti], df1: g.df[ti], df2: g.dfTest })
        isTerm.push(true)
        isSlope.push(false)
      }
    }
  })
  return {
    rows: finaliseCompare(raw, threshold).map((r, i) => ({
      ...r,
      ftest: testOf[i],
      ...(isTerm[i] ? { term: true as const } : null),
      ...(isSlope[i] ? { slope: true as const } : null)
    })),
    comparisons,
    threshold,
    anova: anovaResult(run, variance, maxOrder)
  }
}

/** The former two-way test: each 2×2 on its own, by a Welch t-test on its four cells (omicViz's). */
function runTwoWayWelch(input: FactorAnovaInput): CompareTableResult {
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

/** A dry-run of the ANOVA for the Compare window, on the run's own layout (anovaLayout): the
 *  overall rows each context yields (a contrast needs every cell it reads), the model's terms, and
 *  what the design costs them — a term no combination separates (nested) or one missing
 *  combinations leave fewer df. */
export interface FactorAnovaPreview {
  /** "cmpd × dose" */
  factors: string
  /** the model's terms, main effects first; and those the design lets it test (df left) */
  terms: string[]
  /** the vehicle design, when the data are one (sharedBaselineOf) */
  sharedBaseline?: SharedBaseline
  tested: string[]
  /** conditions faceting the run (matched like-for-like) */
  context: ConditionKey[]
  /** table headers: comparison, each factor's pair (two or more factors), the context dims */
  columns: string[]
  /** table body, one row per overall comparison × context it runs in (aligned to `columns`) */
  rows: string[][]
  groups: number
  /** context conditions some cell is invariant on (so not matched there — its single slice serves
   *  every level of the others), e.g. dose on a vehicle that only exists at 0 */
  fixed: ConditionKey[]
  /** blocking: nothing the model could test */
  warnings: string[]
  /** not blocking, but worth a warning: terms the design can't estimate (nested) */
  cautions: string[]
  /** information: combinations not measured, and what they cost */
  notes: string[]
}

/** The factor-level combinations with no samples, as "level₁ · level₂ · …" — the cells a not
 *  fully crossed design lacks (in the rows the run reads: the factors' picked levels, the context
 *  filters applied). */
export function missingCombinations(input: FactorAnovaInput): string[] {
  const rows = applyInclusion(input)
  // a slope needs no level combination of its own: only the categorical factors' count
  const factors = input.factors.filter((f) => !f.slope)
  const seen = rows.map((r) => factors.map((f) => condValue(r, f.condition)))
  let combos: string[][] = [[]]
  for (const f of factors) combos = combos.flatMap((c) => levelsOf(f).map((l) => [...c, l]))
  return combos
    .filter((c) => !seen.some((vs) => vs.every((v, i) => valEq(v, c[i]))))
    .map((c) => c.join(' · '))
}

export function previewFactorAnova(input: FactorAnovaInput): FactorAnovaPreview {
  const { factors } = input
  const af = modelFactors(factors)
  const shared = sharedBaselineOf(input)
  const terms = anovaTerms(af, factors.length, shared)
  const overall = overallContrasts(factors)
  const lay = anovaLayout({
    rows: input.rows,
    factors: af,
    activeConditions: input.activeConditions,
    num: input.num,
    den: input.den
  })
  const many = factors.length > 1
  const tableRows: string[][] = []
  for (const o of overall)
    for (const s of lay.slices)
      if (contrastRuns(af, terms, o.contrast, s.cells, shared))
        tableRows.push([
          o.label,
          ...(many ? o.parts : []),
          ...s.context.map(([, v]) => String(v ?? ''))
        ])
  // each term's df: the most any context gives it, against its df in a fully crossed design
  const dfs = lay.slices.map((s) => termDf(af, terms, s.cells, shared))
  const best = terms.map((_, ti) => Math.max(0, ...dfs.map((d) => d[ti])))
  const full = terms.map((t) =>
    t.factors.reduce((w, f) => w * factorWidth(af, f, shared), 1)
  )
  const warnings: string[] = []
  const cautions: string[] = []
  const notes: string[] = []
  if (!best.some((d) => d > 0))
    warnings.push('Nothing to test: no context has two levels of a factor.')
  const lost = terms.filter((_, ti) => best[ti] === 0 && full[ti] > 0).map((t) => t.label)
  if (lost.length && best.some((d) => d > 0))
    cautions.push(
      `Nested design: ${lost.join(', ')} can’t be told apart from the other factors (no combination separates ${lost.length === 1 ? 'it' : 'them'}), so ${lost.length === 1 ? 'it isn’t' : 'they aren’t'} tested. To compare each combination with the control, pick the t-test.`
    )
  if (shared) {
    const f = af[shared.factor].condition
    const sl = af[shared.slope].condition
    notes.push(
      `Vehicle design: ${shared.control} only at the lowest ${condLabel(sl)} — one shared baseline there, a ${condLabel(sl)} slope per ${condLabel(f)} through it. No ${condLabel(f)} effect apart from its slope: every ${condLabel(f)} is the vehicle at that ${condLabel(sl)}.`
    )
  }
  const missing = missingCombinations(input)
  if (missing.length)
    notes.push(
      `Full condition matrix not complete — no samples at ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ` +${missing.length - 4} more` : ''}`
    )
  const fewer = terms
    .map((t, ti) => ({ t, ti }))
    .filter(({ ti }) => best[ti] > 0 && best[ti] < full[ti])
    .map(({ t, ti }) => `${t.label} ${best[ti]} of ${full[ti]}`)
  if (fewer.length) notes.push(`The missing combinations leave fewer df: ${fewer.join(', ')}.`)
  if (!tableRows.length && best.some((d) => d > 0))
    notes.push(
      many
        ? `No context has every cell of a ${factors.map(() => '2').join('×')} — no overall rows; the factors still run.`
        : 'No context has a test level with its control — no overall rows; the factor still runs.'
    )
  return {
    factors: factors.map((f) => f.condition).join(' × '),
    terms: terms.map((t) => t.label),
    sharedBaseline: shared,
    tested: terms.filter((_, ti) => best[ti] > 0).map((t) => t.label),
    context: lay.context,
    columns: [
      'comparison',
      ...(many ? factors.map((f) => condLabel(f.condition)) : []),
      ...lay.context.map(condLabel)
    ],
    rows: tableRows,
    groups: tableRows.length,
    fixed: lay.fixed,
    warnings,
    cautions,
    notes
  }
}
