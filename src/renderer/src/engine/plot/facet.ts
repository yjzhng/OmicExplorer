/**
 * Context faceting: a result's condition contexts as plot facets and their labels.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import {
  type ConditionKey,
  condLabel,
  condsIn,
  customSlug,
  isCustomCond,
  isNumericCond,
  type NumericConds
} from '../types'

// ── context faceting ─────────────────────────────────────────────────────────────
// Mirrors omicViz `plot_group_cols` + the per-context groupby in `make_volcanos`:
// a comparison table is split into one plot per context = the active conditions that
// carry values, MINUS the dimension(s) the comparison itself consumes. Those consumed
// dims are read from `cmp_cond` (not hardcoded): 'cmpd' for veh_norm, the compared
// condition for a direct comparison ('cell', 'dose', …), or a colon-joined factor
// pair for a two-way ANOVA ('cmpd:dose'). Excluding them is what stops a clpP-vs-WT
// cell comparison from offering a meaningless single-level "cell" facet, and a
// veh_norm over cell × dose from collapsing into one merged cloud.

/** Minimal shape the faceting helpers need — satisfied by both compare and contrast
 *  result rows (they carry `cmp_cond` plus the condition columns). */
export interface ContextRow {
  /** Contrast rows only: the feature contrasted (its switcher label), when it offers several */
  feature?: string
  /** Contrast rows only: the feature's id (what rowsOfFeature selects on) */
  featureId?: string
  /** A context index's row only (contextIndex.ts): the axis its rows' curve or response surface
   *  runs along — `curve.axis` / `rs.axis`, which the index doesn't carry */
  along?: string
  /** a two-way ANOVA term row (see CompareResultRow.term) — the `show` facet's terms */
  term?: unknown
  cmp_cond?: string
  comparison?: string
  cell?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
  /** custom condition slug → value */
  extra?: Record<string, string>
  /** Contrast rows only: the two sides' values and labels. The paired contrast is a FULL OUTER
   *  join, so a context tuple measured on one side only has FC1 or FC2 null on every row. */
  FC1?: number | null
  FC2?: number | null
  cmp1?: string
  cmp2?: string
}

/** Whether a facet's rows hold data on BOTH sides. Compare rows (no FC1/FC2) always do; contrast
 *  rows only where at least one gene pairs — a one-sided outer-join tuple (a dose measured on one
 *  dataset only) never does, and the switch-tabs grey it out rather than show an empty plot. */
export function facetPaired(rows: ContextRow[]): boolean {
  return rows.some((r) => !('FC1' in r) || (r.FC1 != null && r.FC2 != null))
}

/** For an unpaired facet, the label(s) of the side(s) that do carry data (cmp1 ↔ FC1, cmp2 ↔ FC2),
 *  in first-seen order — what the greyed tab's tooltip names. */
export function facetSides(rows: ContextRow[]): string[] {
  const sides = new Set<string>()
  for (const r of rows) {
    if (r.FC1 != null) sides.add(r.cmp1 ?? 'A')
    if (r.FC2 != null) sides.add(r.cmp2 ?? 'B')
  }
  return [...sides]
}

/** A tab-bar facet dimension: a condition, the `comparison` label itself (used to split a
 *  multi-pair Compare tile into one plot per comparison instead of merging them), or a Contrast's
 *  `feature` (what its two sides compare — log₂FC, significance, pEC50, …). */
export type FacetKey = ConditionKey | 'comparison' | 'feature' | 'show'

/** What to call a facet dimension on screen: a condition's display label (so a custom condition
 *  reads `genotype`, not the `@genotype` key), or the literal `comparison`. */
export const facetKeyLabel = (d: FacetKey): string =>
  d === 'comparison' || d === 'feature' || d === 'show' ? d : condLabel(d)

/** A two-way ANOVA's two kinds of row, as the `show` facet names them: 'overall' — its signed 2×2
 *  interaction fold changes — or 'factors' — one test per factor and their interaction (cmpd, cell,
 *  cmpd × cell; unsigned effect sizes). */
export type ShowKind = 'overall' | 'factors'
export const SHOW_KINDS: readonly ShowKind[] = ['overall', 'factors']
export const showKindOf = (r: { term?: unknown }): ShowKind =>
  r.term != null ? 'factors' : 'overall'
/** The rows of one kind — what a non-faceted reader (the table, the fold-change heatmap) shows for
 *  the group's `show` pick; all of them when the rows have only one kind. Unset = overall, the
 *  pick's own default. */
export function rowsOfKind<T extends { term?: unknown }>(rows: T[], show?: string): T[] {
  if (!rows.some((r) => r.term != null)) return rows
  const want: ShowKind = show === 'factors' ? 'factors' : 'overall'
  return rows.filter((r) => showKindOf(r) === want)
}

/** A context row's value for one condition — the `extra` bag for a custom condition, the column
 *  itself for a preset. `facetCompareRows` and the facet-dim scans all read through this, so a
 *  custom key is never used to index the row object directly. */
export function ctxValue(r: ContextRow, c: FacetKey): string | number | null {
  if (c === 'show') return showKindOf(r)
  if (c !== 'comparison' && c !== 'feature' && isCustomCond(c))
    return r.extra?.[customSlug(c)] ?? ''
  return (r as unknown as Record<string, string | number | null>)[c] ?? null
}

/** A context row's numeric condition value as a number — null where it has none (null, '' or not
 *  a finite number), so an absent custom value never reads as 0. */
export function ctxNum(r: ContextRow, c: ConditionKey): number | null {
  const v = ctxValue(r, c)
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function condPresentInRows(rows: ContextRow[], c: ConditionKey): boolean {
  // null and '' (a custom condition's "absent") are no value, numeric or not.
  return rows.some((r) => {
    const v = ctxValue(r, c)
    return v != null && v !== ''
  })
}

/** Dimensions the comparison itself consumes (never faceted), parsed from `cmp_cond`. */
function comparisonDims(rows: ContextRow[]): Set<string> {
  const dims = new Set<string>()
  for (const r of rows) for (const part of String(r.cmp_cond).split(':')) if (part) dims.add(part)
  return dims
}

/** Context dimensions present in these rows, excluding the comparison's consumed dims.
 *  Pass `exclude` to remove further dims a plot consumes (e.g. a DR/bubble axis).
 *
 *  Custom conditions come FIRST here, unlike the canonical `condsIn`/`orderConds` order used
 *  elsewhere. A custom condition is one the user declared for this experiment — usually its own
 *  axis (genotype, strain, medium) — whereas the presets that survive faceting are typically
 *  covariates. Facet dims are resolved left to right, so the leading dim is both the first switcher
 *  and the one that narrows what the rest offer; the experiment's own axis belongs there. Canonical
 *  order is deliberately left alone for the cluster legend's channel hierarchy, which reads the
 *  first condition as its hue family. */
export function facetContextDims(rows: ContextRow[], exclude?: ConditionKey[]): ConditionKey[] {
  const ex = comparisonDims(rows)
  if (exclude) for (const d of exclude) ex.add(d)
  const present = condsIn(rows).filter((c) => !ex.has(c) && condPresentInRows(rows, c))
  return [...present.filter(isCustomCond), ...present.filter((c) => !isCustomCond(c))]
}

/** Colour-by choices for the pooled responsome embedding (buildResponseCluster). Like
 *  facetContextDims it keeps the present context dims, but it ALSO keeps a comparison-consumed
 *  dim (e.g. cmpd in a two-way ANOVA) when the pooled rows span several comparisons and it
 *  genuinely varies — the cluster merges every comparison, so such a dim is not degenerate the
 *  way it is inside a single comparison's facet. */
export function responseColorDims(rows: ContextRow[]): ConditionKey[] {
  const consumed = comparisonDims(rows)
  return condsIn(rows).filter((c) => {
    if (!condPresentInRows(rows, c)) return false
    if (!consumed.has(c)) return true
    // Consumed dim: only useful to colour by if it takes more than one value across the pool.
    const seen = new Set<string>()
    for (const r of rows) {
      const v = ctxValue(r, c)
      if (v != null && v !== '') seen.add(String(v))
      if (seen.size > 1) return true
    }
    return false
  })
}

/** Whether a Compare's several comparison labels are only the levels of a plot's own axis: every
 *  row compared on excluded conditions alone (a Compare on dose — "5 | 0", "10 | 0" — drawn along
 *  dose), all against one denominator. Those labels ARE the axis, so they aren't a facet: split
 *  on, each tab would hold a single dose and a dose-response curve needs two. Comparisons with
 *  different denominators still split. */
function labelsAreAxis(rows: ContextRow[], labels: Set<string>, exclude?: ConditionKey[]): boolean {
  if (!exclude?.length) return false
  const ex = new Set<string>(exclude)
  const onAxis = rows.every((r) => {
    const parts = (r.cmp_cond ?? '').split(':').filter(Boolean)
    return parts.length > 0 && parts.every((p) => ex.has(p))
  })
  if (!onAxis) return false
  const dens = new Set([...labels].map((l) => l.split(' | ')[1]?.trim() ?? l))
  return dens.size === 1
}

/** Tab-bar facet dimensions: a Contrast's `feature` first (only when it offers several — it
 *  decides what every other level holds), the `comparison` label (only when several coexist, so a
 *  multi-pair Compare splits per comparison), then the context conditions. */
export function facetDims(rows: ContextRow[], exclude?: ConditionKey[]): FacetKey[] {
  const ctx = facetContextDims(rows, exclude)
  const labels = new Set(rows.map((r) => r.comparison).filter((c) => c != null))
  const multiCmp = labels.size > 1 && !labelsAreAxis(rows, labels, exclude)
  const multiFeature = new Set(rows.map((r) => r.feature).filter((f) => f != null)).size > 1
  // A two-way ANOVA's contrasts and terms: picked first, so the comparisons on offer are that kind's.
  const bothKinds = rows.some((r) => r.term != null) && rows.some((r) => r.term == null)
  return [
    ...(bothKinds ? (['show'] as const) : []),
    ...(multiFeature ? (['feature'] as const) : []),
    ...(multiCmp ? (['comparison'] as const) : []),
    ...ctx
  ]
}

export interface FacetGroup<T = ContextRow> {
  /** stable key, e.g. "cell=WT · dose=10" */
  key: string
  /** the faceting value(s) for this group, in dim order */
  values: Array<{ dim: FacetKey; value: string | number }>
  rows: T[]
}

/** Split rows into one group per distinct tuple of `dims` values (omicViz groupby), ordered by
 *  those values — numerically on the dataset's numeric conditions (`numeric`). */
export function facetCompareRows<T extends ContextRow>(
  rows: T[],
  dims: FacetKey[],
  numeric: NumericConds
): FacetGroup<T>[] {
  if (dims.length === 0) return [{ key: '', values: [], rows }]
  // Features keep the order the Contrast gives them (the sides' own value first), not A–Z.
  const featureAt = new Map<string, number>()
  if (dims.includes('feature'))
    for (const r of rows)
      if (r.feature != null && !featureAt.has(r.feature)) featureAt.set(r.feature, featureAt.size)
  // A two-way ANOVA's factors keep the model's order — the main effects in factor order, then their
  // interaction — not A–Z (the engine emits them so).
  const termAt = new Map<string, number>()
  if (dims.includes('comparison'))
    for (const r of rows)
      if (r.term != null && r.comparison != null && !termAt.has(r.comparison))
        termAt.set(r.comparison, termAt.size)
  const groups = new Map<string, FacetGroup<T>>()
  for (const r of rows) {
    const values = dims.map((d) => ({ dim: d, value: ctxValue(r, d) as string | number }))
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
      const d = dims[i]
      const av = a.values[i]?.value
      const bv = b.values[i]?.value
      const an = Number(av)
      const bn = Number(bv)
      // Numeric order only for a dim that IS numeric (dose 2.5 < 5 < 10). A categorical dim —
      // cell, cmpd, the `comparison` label, any custom condition — keeps code-point order even
      // when its levels look like numbers, matching pandas groupby ('WT' < 'clpP').
      const sa = String(av)
      const sb = String(bv)
      const cmp =
        d === 'feature'
          ? (featureAt.get(sa) ?? 0) - (featureAt.get(sb) ?? 0)
          : d === 'show'
            ? // overall first: the pick's default
              SHOW_KINDS.indexOf(sa as ShowKind) - SHOW_KINDS.indexOf(sb as ShowKind)
            : d === 'comparison' && termAt.has(sa) && termAt.has(sb)
              ? termAt.get(sa)! - termAt.get(sb)!
              : d !== 'comparison' &&
                  isNumericCond(d, numeric) &&
                  Number.isFinite(an) &&
                  Number.isFinite(bn)
                ? an - bn
                : sa < sb
                  ? -1
                  : sa > sb
                    ? 1
                    : 0
      if (cmp !== 0) return cmp
    }
    return 0
  })
}
