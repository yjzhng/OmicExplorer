/**
 * Direct comparison: symmetric Welch t-test between two levels of one condition,
 * matched like-to-like across the remaining active conditions.
 *
 * Reimplements omicViz scripts/stats/comparisons.py `_run_condition` + `_finalise`
 * (see [[omicviz-conceptual-reuse]]). Unlike veh_norm there is no asymmetric
 * dose-exclusion — both sides are grouped by every other active condition.
 */
import {
  condPresent,
  condValue,
  finaliseCompare,
  groupKey,
  groupRowsBy,
  log2Pos,
  numValue,
  setCond,
  valEq,
  type RawStatRow
} from './compare'
import { NO_PROGRESS, type ProgressTracker } from './progress'
import {
  axisMapFor,
  axisModelFor,
  baseLevelOf,
  toX,
  treatedLevel,
  type AxisModel
} from './axisModel'
import {
  applyCurveFdr,
  classifyCompareRow,
  curveModel,
  curveGroupKey,
  decoyFits,
  decoyInputs,
  DESCRIBE_Q,
  fitCurve,
  interpolationGrid,
  type CurveFit,
  type DecoyCurve,
  type TargetCurve
} from './curveFit'
import { samTest, type SamGene } from './sam'
import {
  benjaminiHochberg,
  DEFAULT_THRESHOLD,
  SAM_PERMUTATIONS,
  SAM_S0,
  welchTTest,
  type ThresholdConfig
} from './stats'
import {
  condLabel,
  condsIn,
  isNumericCond,
  numericConds,
  orderConds,
  type NumericConds
} from './types'
import type {
  CompareInput,
  CompareResultRow,
  CondSelector,
  ConditionKey,
  Pair,
  StandardRow
} from './types'

export interface DirectInput {
  rows: StandardRow[]
  /** condition being compared (cell | cmpd | dose | time) */
  condition: ConditionKey
  /** [numerator, denominator] level pairs, e.g. [["MutantA","WildType"]] */
  pairs: Pair[]
  activeConditions: ConditionKey[]
  /** 'ttest' only for now */
  method?: 'ttest'
  /** ttest only: log2-transform before testing (omicViz default true) */
  transform?: boolean
  threshold?: ThresholdConfig
  /** optional: restrict to rows whose named conditions match these values */
  filter?: Partial<Record<ConditionKey, Array<string | number>>>
}

/** A finalised comparison table (rows + the comparison labels present). */
export interface CompareTableResult {
  rows: CompareResultRow[]
  comparisons: string[]
  /** curve fit only: the simulated null (decoy) curves per comparison group (curveGroupKey) — kept
   *  so CurveCurator's q-values follow its threshold without a re-run */
  decoys?: Record<string, import('./curveFit').DecoyCurve[]>
  /** curve fit under CurveCurator's threshold: the estimated FDR of its calls (target–decoy) */
  curveFdr?: number
  /** curve fit called by a target FDR: the effective α each comparison group settled on (its
   *  score's shape and cutoff), by curveGroupKey — what the volcano draws the boundary from */
  ccAlpha?: Record<string, number>
  /** The threshold the rows' calls (signf/effect) were made with. Plots draw their guide lines
   *  from THIS, not from the node config, so the boundary always matches the colours even while
   *  the config has moved on (e.g. an FDR-method change awaiting a re-run). Optional only for
   *  results embedded in projects saved before it existed — those fall back to the node config. */
  threshold?: ThresholdConfig
  /** two-way ANOVA: the model behind the rows — its terms' tests and the per-gene attribution, per
   *  context slice (the rows are its 2×2 contrasts) */
  anova?: import('./anova').AnovaResult
}

export function runDirect(input: DirectInput): CompareTableResult {
  const { condition, pairs, activeConditions } = input
  const transform = input.transform ?? true
  const method = input.method ?? 'ttest'
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const transformed = transform && method === 'ttest'
  const statValue = (r: StandardRow): number => (transformed ? log2Pos(r.value) : (r.value ?? NaN))

  // Optional like-for-like filter on condition values.
  let data = input.rows
  if (input.filter) {
    for (const [col, vals] of Object.entries(input.filter) as Array<
      [ConditionKey, Array<string | number>]
    >) {
      data = data.filter((r) => vals.some((v) => valEq(condValue(r, col), v)))
    }
  }

  // Like-to-like grouping: every active condition except the compared one, if present.
  const otherDims = activeConditions.filter((c) => c !== condition && condPresent(data, c))

  const groups = groupRowsBy(data, otherDims)

  const raw: RawStatRow[] = []
  const comparisons: string[] = []

  for (const [numVal, denVal] of pairs as Pair[]) {
    const label = `${numVal} | ${denVal}`
    if (!comparisons.includes(label)) comparisons.push(label)

    for (const grp of groups.values()) {
      const rep = grp[0]
      const numRows = grp.filter((r) => valEq(condValue(r, condition), numVal))
      const denRows = grp.filter((r) => valEq(condValue(r, condition), denVal))
      if (numRows.length === 0 || denRows.length === 0) continue

      const numAgg = numRows.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const denAgg = denRows.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const res = welchTTest(numAgg, denAgg, transformed)

      for (const w of res) {
        const row: RawStatRow = {
          uniqID: w.uniqID,
          cmp_cond: condition,
          comparison: label,
          mean1: w.mean1,
          mean2: w.mean2,
          sd1: w.sd1,
          sd2: w.sd2,
          log2FC: w.log2FC,
          pVal: w.pVal,
          fcSE: w.fcSE
        }
        setCond(row, condition, numVal) // numerator condition value
        for (const d of otherDims) setCond(row, d, condValue(rep, d)) // context values
        raw.push(row)
      }
    }
  }

  return { rows: finaliseCompare(raw, threshold), comparisons, threshold }
}

/** A dry-run summary of what an explicit comparison would produce, for the config dialog:
 *  the distinct num|den labels, the context/faceting split, and any warnings — no stats. */
export interface ComparePreview {
  /** distinct numerator|denominator axis labels */
  labels: string[]
  /** table headers: ['numerator','denominator', ...facet/context dims] */
  columns: string[]
  /** table body, one row per context group actually run (aligned to `columns`) */
  rows: string[][]
  /** conditions faceting the numerator (context) */
  facets: ConditionKey[]
  /** of the facets, which are matched like-for-like on the denominator */
  matched: ConditionKey[]
  /** facets the denominator is invariant on (its single slice serves every numerator level) */
  invariant: ConditionKey[]
  /** number of (context × axis-value) groups that yield a non-empty comparison */
  groups: number
  /** problems that make the configuration invalid (block applying it) */
  warnings: string[]
  /** informational — e.g. context groups skipped for lack of a denominator partner */
  notes: string[]
  /** curve fits: the control (denominator) is not a baseline for the curve's axis — its samples
   *  are treated (see controlIsBaseline), so it is valid only as a background treatment */
  controlTreated?: boolean
}

/**
 * Whether a curve fit's control rows are a baseline for its axis — the curve's starting point. A
 * curve against one reference (dose) starts at no treatment, so every control sample must be
 * untreated (dose 0 / absent: the vehicle). A curve against a matched control — its own first
 * point (time's t₀, a TPP series' lowest temperature) — starts at the control's level of the axis
 * or at the vehicle, so a control sample may be either. Any other control (another compound at a
 * dose) is a background treatment: valid only when the curve's compound is titrated on top of it.
 * `model`: the curve's axis model (absent = the axis's preset; see axisModel.ts).
 */
export function controlIsBaseline(
  controlRows: StandardRow[],
  axis: ConditionKey,
  model: AxisModel = axisModelFor(axis)
): boolean {
  const none = (v: number | null): boolean => !(v != null && v > 0)
  const matched = model.baseline === 'matched'
  const base = baseLevelOf(controlRows.map((r) => numValue(r, axis)))
  const atBase = (v: number | null): boolean => none(v) || v === base
  return controlRows.every(
    (r) => none(numValue(r, 'dose')) || (matched && atBase(numValue(r, axis)))
  )
}

/** controlIsBaseline for a curve fit's configuration: its control is the `den` selection. */
export function curveControlIsBaseline(
  input: Pick<CompareInput, 'rows' | 'den' | 'activeConditions' | 'axisModel' | 'axisBaseline'> & {
    curveAxis: ConditionKey
  }
): boolean {
  const ctl = input.rows.filter((r) => selectorMatch(input.den, r, input.activeConditions))
  return controlIsBaseline(
    ctl,
    input.curveAxis,
    axisModelFor(input.curveAxis, input.axisModel, undefined, undefined, input.axisBaseline)
  )
}

// ── explicit comparison: numerator vs denominator cond-value selections ───────
// One unified path that subsumes direct and veh_norm. Nothing is inferred from names or dose:
// the two sides are exactly what the selectors say, and the `match` set (not a hardcoded
// dose-exclusion) decides which conditions the denominator must line up on.

const pinned = (sel: CondSelector, c: ConditionKey): boolean =>
  Array.isArray(sel[c]) && (sel[c] as string[]).length > 0

/** Row passes a selector when, for every pinned condition, its value is one of the chosen. */
export function selectorMatch(sel: CondSelector, r: StandardRow, active: ConditionKey[]): boolean {
  for (const c of active) {
    if (!pinned(sel, c)) continue
    const v = condValue(r, c)
    if (!(sel[c] as string[]).some((want) => valEq(v, want))) return false
  }
  return true
}

const sameSet = (a?: string[], b?: string[]): boolean => {
  const A = new Set((a ?? []).map(String))
  const B = new Set((b ?? []).map(String))
  return A.size === B.size && [...A].every((x) => B.has(x))
}

/** The conditions the denominator is matched on, like-for-like: the caller's match list, plus
 *  any condition pinned to the same values on both sides (each value its own group, against its
 *  own slice — e.g. every compound against its own dose 0), minus the axis (it defines the
 *  comparison, not the context) and conditions the denominator is invariant on (nothing there to
 *  match). Except in a curve fit against its own axis's level (dose 0): there a group's control is
 *  its own level 0 or none, so the conditions pinned alike stay matched even where the
 *  denominator holds one value — a compound without a dose 0 is skipped, not given another's. */
function matchedConds(
  input: CompareInput,
  axisSet: Set<ConditionKey>,
  invariantSet: Set<ConditionKey>
): Set<ConditionKey> {
  const { num, den, curveAxis } = input
  // A pooled condition is merged on both sides — never matched, even when picked alike on both
  // (a value left out of a pooled condition pins the same kept list on each side).
  const pool = new Set(input.pool ?? [])
  const alike = input.activeConditions.filter(
    (c) => !pool.has(c) && pinned(num, c) && pinned(den, c) && sameSet(num[c], den[c])
  )
  const ownLevel = !!curveAxis && pinned(den, curveAxis)
  return new Set(
    [...input.match, ...alike].filter(
      (c) =>
        !pool.has(c) && !axisSet.has(c) && (!invariantSet.has(c) || (ownLevel && alike.includes(c)))
    )
  )
}

/** The distinct values condition `c` takes among the rows matching `sel` (which must not pin `c`). */
function valuesOf(
  rows: StandardRow[],
  sel: CondSelector,
  c: ConditionKey,
  active: ConditionKey[]
): Set<string> {
  const seen = new Set<string>()
  for (const r of rows) {
    const v = condValue(r, c)
    if (v == null || v === '') continue
    if (selectorMatch(sel, r, active)) seen.add(String(v))
  }
  return seen
}

/** How each condition takes part in an explicit comparison. */
export interface ConditionRoles {
  /** the compared condition(s): pinned on both sides with different values, and a genuine choice
   *  on both sides. A t-test is one-on-one, so more than one here is a configuration error. */
  axis: ConditionKey[]
  /** conditions with a single possible value on one side (e.g. dose on a vehicle that only exists
   *  at 0): not a condition there, so never matched — the other side still fans out over it and
   *  the invariant side's one slice serves every level. */
  invariant: ConditionKey[]
}

/**
 * Classify the active conditions for a num/den selection (see ConditionRoles). Everything not
 * listed is ordinary context, matched like-for-like.
 *
 * A condition is a *candidate* axis when both sides pin it with different values. A candidate is
 * the axis only if it's a real choice on BOTH sides — more than one value available there; a
 * candidate forced to one value on a side (dmso only ever at dose 0) is invariant, not compared.
 * "Available" is judged with the side's pins on conditions already decided (in the canonical
 * cell → cmpd → dose → time order, identity-like before covariate-like) and on non-candidates,
 * never on later candidates — otherwise a filter pin (dose = 20 on the drug side) would make the
 * compound look forced, and in data where vehicle ⇔ dose 0 the two are indistinguishable.
 */
export function classifyConditions(
  rows: StandardRow[],
  num: CondSelector,
  den: CondSelector,
  active: ConditionKey[],
  /** the conditions the user set to compared (the Compare dialog states them); absent = inferred
   *  from the pins (both sides pinned with different values), as configs saved before it were */
  compared?: ConditionKey[]
): ConditionRoles {
  // Hierarchy order (cell → cmpd → dose → time, then the custom conditions): which condition is
  // judged first decides which one reads as the comparison axis when several could.
  const ordered = orderConds(active)
  // Stated, a compared condition is a candidate whatever its pins: a shared context condition with
  // values left out (num 8h, 24h · den 0h) differs on both sides but is NOT compared. Either way a
  // candidate the data force to one value on a side (DMSO only at dose 0) is invariant, not the axis.
  const candidate = new Set(
    compared
      ? ordered.filter((c) => compared.includes(c))
      : ordered.filter((c) => pinned(num, c) && pinned(den, c) && !sameSet(num[c], den[c]))
  )
  const axis: ConditionKey[] = []
  const invariant: ConditionKey[] = []
  const decided = new Set<ConditionKey>()
  for (const c of ordered) {
    // Pins that count when judging `c`: never its own; for a candidate, only decided axes and
    // non-candidates; for context, every other pin (the side's actual slice).
    const keep = (k: ConditionKey): boolean =>
      k !== c && (!candidate.has(c) || !candidate.has(k) || decided.has(k))
    const restrict = (sel: CondSelector): CondSelector => {
      const out: CondSelector = {}
      for (const k of ordered) if (keep(k) && pinned(sel, k)) out[k] = sel[k]
      return out
    }
    const nA = valuesOf(rows, restrict(num), c, ordered)
    const dA = valuesOf(rows, restrict(den), c, ordered)
    if (nA.size === 0 && dA.size === 0) continue // absent from the data
    if (candidate.has(c)) {
      if (nA.size > 1 && dA.size > 1) {
        axis.push(c)
        decided.add(c)
      } else invariant.push(c)
      continue
    }
    const nInv = nA.size <= 1
    const dInv = dA.size <= 1
    // Single on one side (or both, with different values) → can't be matched. Both single and
    // equal is plain shared context (matching is trivially satisfied).
    if ((nInv || dInv) && !(nInv && dInv && [...nA][0] === [...dA][0])) invariant.push(c)
  }
  return { axis, invariant }
}

/** Every combination of the denominator's pinned axis values — each is its own reference level
 *  (no pooling: "A vs C, D" runs A|C and A|D). One entry with no axis. */
function denLevels(
  den: CondSelector,
  axisDims: ConditionKey[]
): Array<Array<[ConditionKey, string]>> {
  let combos: Array<Array<[ConditionKey, string]>> = [[]]
  for (const c of axisDims) {
    const vals = (den[c] ?? []) as string[]
    combos = combos.flatMap((prefix) =>
      vals.map((v) => [...prefix, [c, v] as [ConditionKey, string]])
    )
  }
  return combos
}

/**
 * A curve's baseline in words, from its baseline samples (`ctl`) against its own (`grp`): each of
 * compound and the dataset's numeric conditions (`numeric`: dose, time, any declared numeric) the
 * baseline holds one value of that the curve doesn't share — what's matched to the curve isn't
 * said. "DMSO · dose 0", "dose 0 · time 60", "time 0"; '' if nothing.
 */
export function baselineText(
  ctl: readonly StandardRow[],
  grp: readonly StandardRow[],
  numeric: NumericConds
): string {
  const one = (rows: readonly StandardRow[], c: ConditionKey): string | null => {
    const vs = new Set(rows.map((r) => String(condValue(r, c) ?? '')))
    return vs.size === 1 ? [...vs][0] : null
  }
  const parts: string[] = []
  const conds: ConditionKey[] = ['cmpd', ...condsIn(ctl).filter((c) => isNumericCond(c, numeric))]
  for (const c of conds) {
    const b = one(ctl, c)
    if (b == null || b === '' || one(grp, c) === b) continue
    parts.push(c === 'cmpd' ? b : `${condLabel(c)} ${b}`)
  }
  return parts.join(' · ')
}

/** A numerator group's value on a compared condition, for its label — or, when that condition is
 *  the curve's own axis (dose > 0 vs 0), the curve itself: its levels are all in the group. */
const axisValueLabel = (
  c: ConditionKey,
  rep: StandardRow,
  curveAxis: ConditionKey | undefined
): string => (c === curveAxis ? `${condLabel(c)} curve` : String(condValue(rep, c) ?? ''))

/** How an explicit comparison lays out — shared by previewCompare and compareSlices so the dialog's
 *  preview and the run can't drift apart. */
function compareLayout(input: CompareInput, numRows: StandardRow[]) {
  const { num, activeConditions: active, curveAxis } = input
  const roles = classifyConditions(input.rows, num, input.den, active, input.compared)
  const axisDims = roles.axis
  const axisSet = new Set(axisDims)
  const invariantSet = new Set(roles.invariant)
  const pool = new Set(input.pool ?? [])
  // Facet the numerator by every present condition except the axis, a curve's x-axis, and a pooled
  // condition (merged into one group on both sides). A multi-value numerator pin ON the axis also
  // fans out (each level is its own comparison), so include those in grouping.
  const facetDims = active.filter(
    (c) => !axisSet.has(c) && c !== curveAxis && !pool.has(c) && condPresent(numRows, c)
  )
  // …except a curve's own axis compared against its 0 (dose > 0 vs 0): its levels are the curve's
  // points, pooled into one curve per group.
  const numMultiAxis = axisDims.filter((c) => c !== curveAxis && (num[c]?.length ?? 0) > 1)
  const groupDims = [...facetDims, ...numMultiAxis]
  // Values carried onto each result row (not a curve's axis: the row is the whole curve).
  const contextDims = [...facetDims, ...axisDims.filter((c) => c !== curveAxis)]
  const matchSet = matchedConds(input, axisSet, invariantSet)
  return {
    axisDims,
    axisSet,
    invariantSet,
    facetDims,
    numMultiAxis,
    groupDims,
    contextDims,
    matchSet
  }
}

/** One numerator group and the denominator slice it is compared against. */
export interface CompareSlice {
  /** the numerator group's rows */
  grp: StandardRow[]
  denSlice: StandardRow[]
  /** "num | den" */
  label: string
  /** the group's representative row (its context values) */
  rep: StandardRow
}

/**
 * The numerator groups of an explicit comparison and each one's denominator slice. The comparison
 * *axis* is the ONE condition pinned on both sides with differing values (e.g. cmpd: drug vs dmso)
 * — that becomes `cmp_cond`, excluded from downstream faceting. Every other present condition
 * faceting the numerator is carried as context and matched like-for-like on the denominator —
 * except conditions the denominator is invariant on (see classifyConditions), whose single slice
 * serves every level. A curve fit's `curveAxis` is neither: each group pools all its levels.
 */
export function compareSlices(input: CompareInput): {
  slices: CompareSlice[]
  comparisons: string[]
  cmpCond: string
  /** the conditions whose values each result row carries */
  contextDims: ConditionKey[]
} {
  const { num, den, activeConditions: active, curveAxis } = input
  const numRows = input.rows.filter((r) => selectorMatch(num, r, active))
  const denRows = input.rows.filter((r) => selectorMatch(den, r, active))
  const { axisDims, groupDims, contextDims, matchSet } = compareLayout(input, numRows)

  // Label by the differing axis values; with no axis (degenerate overlap) fall back to each side's
  // full pin list so the comparison string is never blank.
  const hasAxis = axisDims.length > 0
  const pinLabel = (sel: CondSelector): string =>
    active
      .filter((c) => pinned(sel, c))
      .map((c) => (sel[c] as string[]).join('/'))
      .join(' · ')
  const groups = groupRowsBy(numRows, groupDims)
  const slices: CompareSlice[] = []
  const comparisons: string[] = []
  const cmpCond = axisDims.length
    ? axisDims.join(':')
    : (active.find((c) => pinned(num, c)) ?? 'cmpd')
  const levels = hasAxis ? denLevels(den, axisDims) : [[]]

  for (const grp of groups.values())
    for (const level of levels) {
      const rep = grp[0]
      // Denominator slice: the den rows at THIS reference level, further matched on the matched
      // context dims to this numerator group (a dim the denominator is invariant on is left free).
      const denSlice = denRows.filter(
        (d) =>
          level.every(([c, v]) => valEq(condValue(d, c), v)) &&
          groupDims.every((c) => {
            if (!matchSet.has(c)) return true
            const want = condValue(rep, c)
            return want == null ? condValue(d, c) == null : valEq(condValue(d, c), want)
          })
      )
      if (grp.length === 0 || denSlice.length === 0) continue

      const numAxisLabel = hasAxis
        ? axisDims.map((c) => axisValueLabel(c, rep, curveAxis)).join(' · ')
        : pinLabel(num)
      const denAxisLabel = hasAxis ? level.map(([, v]) => v).join(' · ') : pinLabel(den)
      const label = `${numAxisLabel || '(num)'} | ${denAxisLabel || '(den)'}`
      if (!comparisons.includes(label)) comparisons.push(label)
      slices.push({ grp, denSlice, label, rep })
    }
  return { slices, comparisons, cmpCond, contextDims }
}

/** Run an explicit numerator-vs-denominator comparison: a Welch t-test per numerator group
 *  against its denominator slice (see compareSlices). */
export function runCompare(input: CompareInput): CompareTableResult {
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  // SAM's moderated difference only means anything on log values, so it always tests in log₂.
  const sam = threshold.type === 'sam_fdr'
  const transform = sam || (input.transform ?? true)
  const method = input.method ?? 'ttest'
  const transformed = transform && method === 'ttest'
  const statValue = (r: StandardRow): number => (transformed ? log2Pos(r.value) : (r.value ?? NaN))
  // A sample within one comparison: its every condition value and replicate.
  const sampleOf = (r: StandardRow): string =>
    groupKey([...input.activeConditions.map((c) => condValue(r, c)), r.rep])

  const { slices, comparisons, cmpCond, contextDims } = compareSlices(input)
  const raw: RawStatRow[] = []
  const samStats: Array<SamGene | undefined> = []
  slices.forEach(({ grp, denSlice, label, rep }, si) => {
    const numAgg = grp.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
    const denAgg = denSlice.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
    const res = welchTTest(numAgg, denAgg, transformed)
    const samRes = sam
      ? samTest(
          grp.map((r) => ({ uniqID: r.uniqID, sample: sampleOf(r), value: statValue(r) })),
          denSlice.map((r) => ({ uniqID: r.uniqID, sample: sampleOf(r), value: statValue(r) })),
          {
            s0: threshold.samS0 ?? SAM_S0,
            permutations: threshold.permutations ?? SAM_PERMUTATIONS,
            seed: si + 1
          }
        )
      : undefined
    for (const w of res) {
      const s = samRes?.get(w.uniqID)
      samStats.push(s)
      const row: RawStatRow = {
        uniqID: w.uniqID,
        cmp_cond: cmpCond,
        comparison: label,
        mean1: w.mean1,
        mean2: w.mean2,
        sd1: w.sd1,
        sd2: w.sd2,
        log2FC: w.log2FC,
        // SAM reports the pooled t-test its d moderates, so the volcano and its boundary agree.
        pVal: samRes ? (s?.pVal ?? NaN) : w.pVal,
        fcSE: w.fcSE
      }
      for (const c of contextDims) setCond(row, c, condValue(rep, c))
      raw.push(row)
    }
  })

  const rows = finaliseCompare(raw, threshold)
  if (!sam) return { rows, comparisons, threshold }
  // SAM: q is the permutation q-value (not BH), and the calls follow from it.
  return {
    rows: rows.map((r, i) => {
      const s = samStats[i]
      const q = s && Number.isFinite(s.q) ? -Math.log10(Math.max(s.q, 1e-300)) : null
      const row: CompareResultRow = {
        ...r,
        pQ: q,
        ...(s ? { sam: { d: s.d, df: s.df } } : null)
      }
      return { ...row, ...classifyCompareRow(row, threshold) }
    }),
    comparisons,
    threshold
  }
}

/**
 * Dose–response curve fit (CurveCurator; see curveFit.ts): per numerator group, one curve per
 * gene over `curveAxis`. The response is each value's RATIO to the gene's mean in the denominator
 * slice (the control), on the linear values — CurveCurator's definition, whatever scale Clean data
 * presents. Levels of the axis at or below 0 aren't doses on a log axis and are left out (the
 * control is the curve's x = −∞). The row's log2FC is the curve fold change, its p the
 * recalibrated F-test; both then go through the usual FDR and threshold calls.
 */
/** A batch of curves to fit (each its treated points' log₁₀ doses and ratios) — what curveFitSteps
 *  hands out, and gets back fitted in the same order. */
export type FitBatch = Array<{ x: number[]; y: number[]; grid?: number[]; x0?: number }>

/** Run a step generator to the end, answering each batch it yields. */
export function driveSync<Q, A, R>(gen: Generator<Q, R, A>, answer: (q: Q) => A): R {
  let r = gen.next()
  while (!r.done) r = gen.next(answer(r.value))
  return r.value
}
/** driveSync with an asynchronous answer (the worker pool). */
export async function driveAsync<Q, A, R>(
  gen: Generator<Q, R, A>,
  answer: (q: Q) => Promise<A>
): Promise<R> {
  let r = gen.next()
  while (!r.done) r = gen.next(await answer(r.value))
  return r.value
}

/** Fit a batch here, one curve after another. */
export const fitBatch = (batch: FitBatch): Array<CurveFit | null> =>
  batch.map((c) => fitCurve(c.x, c.y, c.grid, c.x0))

export function runCurveFit(
  input: CompareInput & { curveAxis: ConditionKey },
  progress: ProgressTracker = NO_PROGRESS
): CompareTableResult {
  // the fits one by one, each counted (progress)
  return driveSync(curveFitSteps(input, progress), (b) =>
    b.map((c) => {
      const f = fitCurve(c.x, c.y, c.grid, c.x0)
      progress.add(1)
      return f
    })
  )
}

/** runCurveFit as steps: the comparison's set-up and bookkeeping here, the curve fits — every
 *  slice's real curves, then its decoys — handed out as batches (FitBatch) to be fitted wherever
 *  the driver likes (one by one, or shared out over the worker pool). The fits are pure, so either
 *  way the result is the same. */
export function* curveFitSteps(
  input: CompareInput & { curveAxis: ConditionKey },
  progress: ProgressTracker = NO_PROGRESS
): Generator<FitBatch, CompareTableResult, Array<CurveFit | null>> {
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const axis = input.curveAxis
  const { slices, comparisons, cmpCond, contextDims } = compareSlices(input)
  // progress: every slice's curves and as many decoys (the drivers count them as they're fitted)
  progress.stage('Fitting curves and their decoys')
  progress.plan(2 * slices.reduce((a, sl) => a + new Set(sl.grp.map((r) => r.uniqID)).size, 0))
  // The axis's model (confirmed, else detected, else the preset's): x is log₁₀ of the level, or the
  // level in steps on a linear axis. The control at −∞ against one reference (CurveCurator's); a
  // matched baseline — the curve's own first point (t₀, the lowest temperature) — a real point at
  // its level (the lowest the control sits at), the curves' midpoints at or after it.
  const levels = new Set<number>()
  for (const sl of slices)
    for (const r of sl.grp) {
      const v = numValue(r, axis)
      if (v != null) levels.add(v)
    }
  const model = axisModelFor(
    axis,
    input.axisModel,
    input.axisScale,
    [...levels],
    input.axisBaseline
  )
  const { scale } = model
  const treatedLevels = [...levels].filter((v) => treatedLevel(scale, v))
  const matched = model.baseline === 'matched'
  const b = baseLevelOf(slices.flatMap((sl) => sl.denSlice.map((r) => numValue(r, axis))))
  const base0 = matched && treatedLevels.every((v) => b < v) ? b : 0
  const map = axisMapFor(model, treatedLevels, base0)
  const x0 = matched ? toX(map, base0) : -Infinity
  const linear = scale === 'linear' ? { scale: 'linear' as const, step: map.step } : null
  const offset = map.offset ? { timeOffset: map.offset } : null
  const raw: RawStatRow[] = []
  const fits: Array<CompareResultRow['curve']> = []
  // Per slice: its decoys, and the index of its first result row (whose group key they file under).
  const sliceDecoys: Array<{ first: number; decoys: DecoyCurve[] }> = []
  for (let si = 0; si < slices.length; si++) {
    const { grp, denSlice, label, rep } = slices[si]
    // The control's mean per gene (the ratio's denominator), and its samples (for the QC).
    const ctrl = new Map<
      string,
      { sum: number; n: number; v: number[]; rep: Array<number | null> }
    >()
    for (const r of denSlice) {
      if (r.value == null || !Number.isFinite(r.value)) continue
      const c = ctrl.get(r.uniqID) ?? { sum: 0, n: 0, v: [], rep: [] }
      c.sum += r.value
      c.n++
      c.v.push(r.value)
      c.rep.push(r.rep ?? null)
      ctrl.set(r.uniqID, c)
    }
    // Each gene's treated points: x (log₁₀ dose) and ratio to the control.
    const pts = new Map<string, { x: number[]; y: number[]; rep: Array<number | null> }>()
    for (const r of grp) {
      const dose = numValue(r, axis)
      const c = ctrl.get(r.uniqID)
      if (!treatedLevel(scale, dose) || !c || r.value == null) continue
      const base = c.sum / c.n
      if (!(base > 0)) continue
      let p = pts.get(r.uniqID)
      if (!p) pts.set(r.uniqID, (p = { x: [], y: [], rep: [] }))
      p.rep.push(r.rep ?? null)
      p.x.push(toX(map, dose))
      p.y.push(r.value / base)
    }
    const first = raw.length
    const targets: TargetCurve[] = []
    const genes = [...pts]
    // CurveCurator's interpolation, if asked for: one grid from every dose the slice tested.
    const grid = input.interpolation ? interpolationGrid(genes.flatMap(([, p]) => p.x)) : undefined
    const sliceFits: Array<CurveFit | null> = yield genes.map(([, p]) => ({
      x: p.x,
      y: p.y,
      grid,
      ...(matched ? { x0 } : null)
    }))
    for (let gi = 0; gi < genes.length; gi++) {
      const [uniqID, p] = genes[gi]
      const fit = sliceFits[gi]
      if (!fit) continue
      targets.push({ doseX: p.x, ratios: p.y, fit })
      const { log2FC, pVal, ...curve } = fit
      const row: RawStatRow = {
        uniqID,
        cmp_cond: cmpCond,
        comparison: label,
        mean1: NaN,
        mean2: NaN,
        sd1: NaN,
        sd2: NaN,
        log2FC,
        pVal,
        fcSE: NaN
      }
      for (const c of contextDims) setCond(row, c, condValue(rep, c))
      raw.push(row)
      // The measured points too (log₁₀ dose, ratio to the control, replicate), for drawing a
      // gene's curve and the per-sample QC; and the control samples' own ratios.
      const c = ctrl.get(uniqID)!
      const base = c.sum / c.n
      fits.push({
        ...curve,
        axis,
        ...linear,
        ...offset,
        baseline: baselineText(denSlice, grp, numericConds(input.numericConditions)),
        x: p.x,
        y: p.y,
        rep: p.rep,
        cy: c.v.map((v) => v / base),
        crep: c.rep
      })
    }
    // CurveCurator's null: one decoy per curve, on this slice's dose layout (the fullest curve's
    // points) and its usual number of control samples.
    if (targets.length) {
      let layout: number[] = []
      for (const p of pts.values()) if (p.x.length > layout.length) layout = p.x
      const nCtrl = new Map<number, number>()
      for (const c of ctrl.values()) nCtrl.set(c.n, (nCtrl.get(c.n) ?? 0) + 1)
      let nControls = 1
      let most = 0
      for (const [k, v] of nCtrl) if (v > most) [nControls, most] = [k, v]
      // fitted as the real curves — interpolated too, when they are (as CurveCurator does)
      const decoyFitted: Array<CurveFit | null> = yield decoyInputs(
        targets,
        layout,
        nControls,
        si + 1
      ).map((c) => ({ ...c, grid, ...(matched ? { x0 } : null) }))
      sliceDecoys.push({ first, decoys: decoyFits(decoyFitted) })
    }
  }
  // Responders only: a curve beyond DESCRIBE_Q (BH over the run's raw p — fixed at run time, so a
  // later threshold edit still finds its calls described) keeps its test but not its description.
  const q = input.describeAll === false ? benjaminiHochberg(raw.map((r) => r.pVal)) : null
  const finals = finaliseCompare(raw, threshold).map((r, i) => ({
    ...r,
    curve: q && !(q[i] <= DESCRIBE_Q) ? { ...fits[i]!, described: false as const } : fits[i]
  }))
  const decoys: Record<string, DecoyCurve[]> = {}
  for (const { first, decoys: d } of sliceDecoys) decoys[curveGroupKey(finals[first])] = d
  // CurveCurator's calls need each row's curve, and by FDR its decoy q — so they come last.
  const withQ = applyCurveFdr(finals, decoys, threshold)
  // Under any other threshold the calls stand as finaliseCompare made them (before the curves were
  // attached) — but every curve still gets its final model (4PL, or M0 where flat isn't rejected).
  const rows =
    threshold.type === 'curvecurator'
      ? withQ.rows.map((r) => ({ ...r, ...classifyCompareRow(r, threshold) }))
      : withQ.rows.map((r) => (r.curve ? { ...r, model: curveModel(r, threshold) } : r))
  const fdr = withQ.fdr
  return {
    rows,
    comparisons,
    threshold,
    decoys,
    ...(fdr != null ? { curveFdr: fdr } : null),
    ...(withQ.alphas ? { ccAlpha: withQ.alphas } : null)
  }
}

/** Dry-run the grouping of an explicit comparison (no t-tests) for live config feedback. */
export function previewCompare(input: CompareInput): ComparePreview {
  const { num, den, activeConditions: active, curveAxis } = input
  const numRows = input.rows.filter((r) => selectorMatch(num, r, active))
  const denRows = input.rows.filter((r) => selectorMatch(den, r, active))
  const anyPin = (sel: CondSelector): boolean => active.some((c) => pinned(sel, c))
  const warnings: string[] = []
  const notes: string[] = []
  if (!anyPin(num)) warnings.push('Numerator is empty — pin at least one condition.')
  if (!anyPin(den)) warnings.push('Denominator is empty — pin at least one condition.')
  if (anyPin(num) && numRows.length === 0) warnings.push('No rows match the numerator selection.')
  if (anyPin(den) && denRows.length === 0) warnings.push('No rows match the denominator selection.')

  const { axisDims, invariantSet, facetDims, groupDims, matchSet } = compareLayout(input, numRows)
  // Several compared conditions are allowed when stated (the dialog flags any confound); inferred
  // from the pins (configs saved before), a t-test stays one-on-one.
  const stated = !!input.compared
  // One reference: the denominator holds a single level of the compared condition.
  for (const c of axisDims)
    if ((den[c]?.length ?? 0) > 1)
      warnings.push(`${c}: the denominator must be one value (it has ${den[c]!.join(', ')}).`)
  // A t-test is one-on-one: exactly one compared condition.
  if (!stated && axisDims.length > 1)
    warnings.push(
      `A comparison is on one condition, but ${axisDims.length} differ between the sides (${axisDims.join(', ')}) — give all but one the same values on both sides.`
    )
  // An axis condition must be DISJOINT between the sides: "A, B vs B" puts B in its own
  // denominator, which isn't a comparison of anything.
  const overlapDims = axisDims.filter((c) => {
    const d = new Set((den[c] ?? []).map(String))
    return (num[c] ?? []).some((v) => d.has(String(v)))
  })
  for (const c of overlapDims) {
    const d = new Set((den[c] ?? []).map(String))
    const shared = (num[c] ?? []).filter((v) => d.has(String(v))).join(', ')
    warnings.push(
      `${c}: ${shared} is on both sides — pick different values for numerator and denominator.`
    )
  }
  // A curve needs doses to fit: more than 4 points with the control, so 4 treated doses (above 0
  // on a log axis; any but 0 on a linear one).
  if (curveAxis) {
    const all: number[] = []
    for (const r of numRows) {
      const d = numValue(r, curveAxis)
      if (d != null) all.push(d)
    }
    const { scale } = axisModelFor(curveAxis, input.axisModel, input.axisScale, all)
    const doses = new Set(all.filter((d) => treatedLevel(scale, d)))
    const atZero = all.some((d) => !treatedLevel(scale, d))
    if (anyPin(num) && doses.size < 4)
      warnings.push(
        `A curve fit needs at least 4 ${condLabel(curveAxis)} levels ${scale === 'log' ? 'above' : 'besides'} 0 in the numerator (it has ${doses.size}).`
      )
    if (atZero)
      notes.push(
        `Numerator samples at ${condLabel(curveAxis)} 0 are left out — the control is the curve's baseline.`
      )
  }
  const controlTreated =
    !!curveAxis &&
    denRows.length > 0 &&
    !controlIsBaseline(
      denRows,
      curveAxis,
      axisModelFor(curveAxis, input.axisModel, undefined, undefined, input.axisBaseline)
    )
  // With a real axis, label by the differing values; with none (degenerate overlap), fall back to
  // each side's full pin list so the string is never blank.
  const hasAxis = axisDims.length > 0
  const pinLabel = (sel: CondSelector): string =>
    active
      .filter((c) => pinned(sel, c))
      .map((c) => (sel[c] as string[]).join('/'))
      .join(' · ')
  // Until BOTH sides are pinned AND differ on some condition there is no comparison to list — an
  // unpinned side matches every row (a table of meaningless "— | —" rows), and identical sides
  // (e.g. drugA vs drugA) are a degenerate overlap, not a comparison — so those count 0 groups,
  // which also lets the dialog grey out a chip that would make the sides identical.
  const defined =
    anyPin(num) &&
    anyPin(den) &&
    (stated ? axisDims.length >= 1 : axisDims.length === 1) &&
    overlapDims.length === 0 &&
    axisDims.every((c) => (den[c]?.length ?? 0) === 1)
  const groups = defined ? groupRowsBy(numRows, groupDims) : new Map<string, StandardRow[]>()
  const labels = new Set<string>()
  const columns = ['comparison', 'numerator', 'denominator', ...facetDims]
  const tableRows: string[][] = []
  let ok = 0
  let emptyDen = 0
  const levels = hasAxis ? denLevels(den, axisDims) : [[]]
  for (const grp of groups.values())
    for (const level of levels) {
      const rep = grp[0]
      const denSlice = denRows.filter(
        (d) =>
          level.every(([c, v]) => valEq(condValue(d, c), v)) &&
          groupDims.every((c) => {
            if (!matchSet.has(c)) return true
            const want = condValue(rep, c)
            return want == null ? condValue(d, c) == null : valEq(condValue(d, c), want)
          })
      )
      const numAxisLabel = hasAxis
        ? axisDims.map((c) => axisValueLabel(c, rep, curveAxis)).join(' · ')
        : pinLabel(num)
      const denAxisLabel = hasAxis ? level.map(([, v]) => v).join(' · ') : pinLabel(den)
      labels.add(`${numAxisLabel || '(num)'} | ${denAxisLabel || '(den)'}`)
      if (denSlice.length === 0) {
        emptyDen++
        continue
      }
      ok++
      // One comparison per context combination: the num|den label, the axis num/den split,
      // then each facet dim's value.
      const num1 = numAxisLabel || '—'
      const den1 = denAxisLabel || '—'
      tableRows.push([
        `${num1} | ${den1}`,
        num1,
        den1,
        ...facetDims.map((c) => String(condValue(rep, c) ?? ''))
      ])
    }
  // Skipped groups are a fact of the data (e.g. one compound measured at fewer doses), not a
  // configuration error — reported, but never blocking. Unless NOTHING runs.
  if (emptyDen > 0 && ok > 0)
    notes.push(
      `${emptyDen} of ${emptyDen + ok} context group(s) skipped — no denominator sample at that combination of matched values.`
    )
  if (emptyDen > 0 && ok === 0)
    warnings.push(
      'No context group has a denominator partner — the two sides share no combination of matched values.'
    )
  // No axis at all (both sides pinned but no condition takes different values) = a degenerate
  // overlap, e.g. "drugA (any dose)" vs "drugA · dose=5". Not a real comparison.
  if (!hasAxis && anyPin(num) && anyPin(den))
    warnings.push(
      'Numerator and denominator don’t differ on any condition — set a different value on some condition to define what’s being compared.'
    )

  const facets = facetDims
  return {
    labels: [...labels],
    columns,
    rows: tableRows,
    facets,
    matched: facets.filter((c) => matchSet.has(c)),
    invariant: facets.filter((c) => invariantSet.has(c)),
    groups: ok,
    warnings,
    notes,
    ...(controlTreated ? { controlTreated } : null)
  }
}
