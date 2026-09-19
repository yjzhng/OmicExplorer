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
  groupRowsBy,
  log2Pos,
  setCond,
  valEq,
  type RawStatRow
} from './compare'
import { DEFAULT_THRESHOLD, welchTTest, type ThresholdConfig } from './stats'
import { VALID_CONDITIONS } from './types'
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
  /** The threshold the rows' calls (signf/effect) were made with. Plots draw their guide lines
   *  from THIS, not from the node config, so the boundary always matches the colours even while
   *  the config has moved on (e.g. an FDR-method change awaiting a re-run). Optional only for
   *  results embedded in projects saved before it existed — those fall back to the node config. */
  threshold?: ThresholdConfig
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
}

// ── explicit comparison: numerator vs denominator cond-value selections ───────
// One unified path that subsumes direct and veh_norm. Nothing is inferred from names or dose:
// the two sides are exactly what the selectors say, and the `match` set (not a hardcoded
// dose-exclusion) decides which conditions the denominator must line up on.

const pinned = (sel: CondSelector, c: ConditionKey): boolean =>
  Array.isArray(sel[c]) && (sel[c] as string[]).length > 0

/** Row passes a selector when, for every pinned condition, its value is one of the chosen. */
function selectorMatch(sel: CondSelector, r: StandardRow, active: ConditionKey[]): boolean {
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
  active: ConditionKey[]
): ConditionRoles {
  const ordered = VALID_CONDITIONS.filter((c) => active.includes(c))
  const candidate = new Set(
    ordered.filter((c) => pinned(num, c) && pinned(den, c) && !sameSet(num[c], den[c]))
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
 * Run an explicit numerator-vs-denominator comparison. The comparison *axis* is the ONE condition
 * pinned on both sides with differing values (e.g. cmpd: drug vs dmso) — that becomes `cmp_cond`,
 * excluded from downstream faceting. Every other present condition faceting the numerator is
 * carried as context and matched like-for-like on the denominator — except conditions the
 * denominator is invariant on (see classifyConditions), whose single slice serves every level.
 */
export function runCompare(input: CompareInput): CompareTableResult {
  const { num, den, activeConditions: active } = input
  const transform = input.transform ?? true
  const method = input.method ?? 'ttest'
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const transformed = transform && method === 'ttest'
  const statValue = (r: StandardRow): number => (transformed ? log2Pos(r.value) : (r.value ?? NaN))

  const numRows = input.rows.filter((r) => selectorMatch(num, r, active))
  const denRows = input.rows.filter((r) => selectorMatch(den, r, active))

  const roles = classifyConditions(input.rows, num, den, active)
  const axisDims = roles.axis
  const axisSet = new Set(axisDims)
  const invariantSet = new Set(roles.invariant)
  // Facet the numerator by every present condition except the axis. A multi-value numerator pin
  // ON the axis also fans out (each level is its own comparison), so include those in grouping.
  const facetDims = active.filter((c) => !axisSet.has(c) && condPresent(numRows, c))
  const numMultiAxis = axisDims.filter((c) => (num[c]?.length ?? 0) > 1)
  const groupDims = [...facetDims, ...numMultiAxis]
  const contextDims = [...facetDims, ...axisDims] // values carried onto each result row
  // Matched context: the caller's match list, minus the axis (defines the comparison, not the
  // context) and minus conditions the denominator is invariant on (nothing there to match).
  const matchSet = new Set(input.match.filter((c) => !axisSet.has(c) && !invariantSet.has(c)))

  // Label by the differing axis values; with no axis (degenerate overlap) fall back to each side's
  // full pin list so the comparison string is never blank.
  const hasAxis = axisDims.length > 0
  const pinLabel = (sel: CondSelector): string =>
    active
      .filter((c) => pinned(sel, c))
      .map((c) => (sel[c] as string[]).join('/'))
      .join(' · ')
  const groups = groupRowsBy(numRows, groupDims)
  const raw: RawStatRow[] = []
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
        ? axisDims.map((c) => String(condValue(rep, c) ?? '')).join(' · ')
        : pinLabel(num)
      const denAxisLabel = hasAxis ? level.map(([, v]) => v).join(' · ') : pinLabel(den)
      const label = `${numAxisLabel || '(num)'} | ${denAxisLabel || '(den)'}`
      if (!comparisons.includes(label)) comparisons.push(label)

      const numAgg = grp.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const denAgg = denSlice.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const res = welchTTest(numAgg, denAgg, transformed)
      for (const w of res) {
        const row: RawStatRow = {
          uniqID: w.uniqID,
          cmp_cond: cmpCond,
          comparison: label,
          mean1: w.mean1,
          mean2: w.mean2,
          sd1: w.sd1,
          sd2: w.sd2,
          log2FC: w.log2FC,
          pVal: w.pVal,
          fcSE: w.fcSE
        }
        for (const c of contextDims) setCond(row, c, condValue(rep, c))
        raw.push(row)
      }
    }

  return { rows: finaliseCompare(raw, threshold), comparisons, threshold }
}

/** Dry-run the grouping of an explicit comparison (no t-tests) for live config feedback. */
export function previewCompare(input: CompareInput): ComparePreview {
  const { num, den, activeConditions: active } = input
  const numRows = input.rows.filter((r) => selectorMatch(num, r, active))
  const denRows = input.rows.filter((r) => selectorMatch(den, r, active))
  const anyPin = (sel: CondSelector): boolean => active.some((c) => pinned(sel, c))
  const warnings: string[] = []
  const notes: string[] = []
  if (!anyPin(num)) warnings.push('Numerator is empty — pin at least one condition.')
  if (!anyPin(den)) warnings.push('Denominator is empty — pin at least one condition.')
  if (anyPin(num) && numRows.length === 0) warnings.push('No rows match the numerator selection.')
  if (anyPin(den) && denRows.length === 0) warnings.push('No rows match the denominator selection.')

  const roles = classifyConditions(input.rows, num, den, active)
  const axisDims = roles.axis
  const axisSet = new Set(axisDims)
  const invariantSet = new Set(roles.invariant)
  // One reference: the denominator holds a single level of the compared condition.
  for (const c of axisDims)
    if ((den[c]?.length ?? 0) > 1)
      warnings.push(`${c}: the denominator must be one value (it has ${den[c]!.join(', ')}).`)
  // A t-test is one-on-one: exactly one compared condition.
  if (axisDims.length > 1)
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
  const facetDims = active.filter((c) => !axisSet.has(c) && condPresent(numRows, c))
  const numMultiAxis = axisDims.filter((c) => (num[c]?.length ?? 0) > 1)
  const groupDims = [...facetDims, ...numMultiAxis]
  const matchSet = new Set(input.match.filter((c) => !axisSet.has(c) && !invariantSet.has(c)))
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
    axisDims.length === 1 &&
    overlapDims.length === 0 &&
    (den[axisDims[0]]?.length ?? 0) === 1
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
        ? axisDims.map((c) => String(condValue(rep, c) ?? '')).join(' · ')
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
    notes
  }
}
