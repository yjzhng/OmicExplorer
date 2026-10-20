/** Shared facet-context selection for the results dashboard.
 *
 * All plots in one analysis group derive from the same comparison, so they share one
 * facet context (cell/dose/time). Instead of each plot carrying its own switch-tabs,
 * a single control in the results header drives this store, keyed by group id, and every
 * FacetedPlot in the group reads the resolved selection.
 */
import { create } from 'zustand'

import {
  facetCompareRows,
  facetKeyLabel,
  facetPaired,
  facetSides,
  type ContextRow,
  type FacetGroup,
  type FacetKey,
  type NumericConds
} from '../engine'

export interface FacetOption {
  value: string | number
  /** Set when nothing at this level (alongside the dims fixed to its left) has data on both
   *  sides: a contrast context measured on one side only, carried by the engine's outer join.
   *  Names the side(s) that do carry data; the tab is greyed out and can't be chosen. */
  onlyOn?: string
  /** Set when the level isn't found alongside the levels picked to its left (another compound's
   *  dose, a comparison's other compound): still offered — picking it moves those picks to the
   *  nearest tuple that has it (pickFacet) — so a dim is never gated by the ones before it. */
  moves?: boolean
}

/** Whether a facet dimension is one of the dataset's numeric conditions (its levels are ordered,
 *  so it stays pills, stepped through) — never `comparison`, `feature` or `show`. */
export const isNumericFacet = (dim: FacetKey, numeric: NumericConds): boolean =>
  dim !== 'comparison' && dim !== 'feature' && dim !== 'show' && numeric.has(dim)

export interface FacetBar {
  dim: FacetKey
  value: string | number
  /** the levels valid alongside the dims already fixed to the left */
  options: FacetOption[]
}

/**
 * Resolve a facet selection against a comparison's rows: the options per dim and the chosen
 * tuple's rows. The selection is resolved left to right (a now-invalid or one-sided choice falls
 * back to the first paired level alongside the dims to its left); every dim still offers ALL its
 * levels, the ones not found alongside its left dims marked `moves` — picking one goes through
 * pickFacet, which moves those. Shared by the global control and each FacetedPlot so they always
 * agree.
 */
export function resolveFacets<T extends ContextRow>(
  rows: T[],
  dims: FacetKey[],
  sel: Record<string, string>,
  /** the dataset's numeric conditions, for the levels' order */
  numeric: NumericConds
): { bars: FacetBar[]; rows: T[]; key: string } {
  const groups = facetCompareRows(rows, dims, numeric)
  const valueOf = (g: FacetGroup<T>, d: FacetKey): string | number =>
    g.values.find((v) => v.dim === d)?.value as string | number
  const bars: FacetBar[] = []
  let candidates = groups
  for (const d of dims) {
    const here = new Set(candidates.map((g) => String(valueOf(g, d))))
    // first appearance over every tuple: the engine's own order
    const rank = new Map<string, number>()
    for (const g of groups) {
      const v = String(valueOf(g, d))
      if (!rank.has(v)) rank.set(v, rank.size)
    }
    // Level → the candidate groups at that level (insertion order = the engine's sort order).
    const byLevel = new Map<string, { value: string | number; groups: FacetGroup<T>[] }>()
    for (const g of candidates) {
      const v = valueOf(g, d)
      let e = byLevel.get(String(v))
      if (!e) byLevel.set(String(v), (e = { value: v, groups: [] }))
      e.groups.push(g)
    }
    const paired = ({ value, groups: gs }: { value: string | number; groups: FacetGroup<T>[] }) => {
      if (gs.some((g) => facetPaired(g.rows))) return { value }
      const sides = facetSides(gs.flatMap((g) => g.rows))
      return { value, onlyOn: sides.length ? sides.join(' / ') : 'one side' }
    }
    const options: FacetOption[] = [...byLevel.values()].map(paired)
    const pick =
      options.find((o) => !o.onlyOn && String(o.value) === sel[d]) ??
      options.find((o) => !o.onlyOn) ??
      options[0]
    const value = pick.value
    // …and the dim's other levels, found only alongside other picks to its left: offered too —
    // within the `show` pick, which does narrow (a two-way ANOVA's contrasts or its terms: the
    // other kind's comparisons aren't these).
    const elsewhere = new Map<string, { value: string | number; groups: FacetGroup<T>[] }>()
    const shown = bars.find((b) => b.dim === 'show')
    for (const g of groups) {
      if (shown && String(valueOf(g, 'show')) !== String(shown.value)) continue
      const v = valueOf(g, d)
      if (here.has(String(v))) continue
      let e = elsewhere.get(String(v))
      if (!e) elsewhere.set(String(v), (e = { value: v, groups: [] }))
      e.groups.push(g)
    }
    const all = [
      ...options,
      ...[...elsewhere.values()].map((e) => ({ ...paired(e), moves: true }))
    ].sort((a, b) => levelOrder(d, a.value, b.value, numeric, rank))
    bars.push({ dim: d, value, options: all })
    candidates = candidates.filter((g) => String(valueOf(g, d)) === String(value))
  }
  // `key`: the facet's FacetGroup key — what a plot's run keys its per-facet results by.
  return { bars, rows: candidates[0]?.rows ?? [], key: candidates[0]?.key ?? '' }
}

/** A dim's levels in one order however the dims to its left are picked: numeric conditions
 *  ascending, other conditions naturally (A2 before A10); comparison, feature and show as the
 *  engine lists them (`rank`: first appearance over every tuple). */
function levelOrder(
  d: FacetKey,
  a: string | number,
  b: string | number,
  numeric: NumericConds,
  rank: Map<string, number>
): number {
  if (d === 'comparison' || d === 'feature' || d === 'show')
    return (rank.get(String(a)) ?? 0) - (rank.get(String(b)) ?? 0)
  if (isNumericFacet(d, numeric)) return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * The selection after picking `value` on `dim`: the dims to its right re-resolve as ever, and the
 * dims to its left — when the level isn't found alongside them (FacetOption.moves) — move to the
 * tuple that has it and keeps the most of what was on show, the leftmost dims first (a paired
 * tuple over a one-sided one). So picking a compound brings its comparison along.
 */
export function pickFacet<T extends ContextRow>(
  rows: T[],
  dims: FacetKey[],
  sel: Record<string, string>,
  dim: FacetKey,
  value: string,
  numeric: NumericConds
): Record<string, string> {
  const now = resolveFacets(rows, dims, sel, numeric).bars
  const shown = new Map(now.map((b) => [b.dim, String(b.value)]))
  const groups = facetCompareRows(rows, dims, numeric).filter(
    (g) => String(g.values.find((v) => v.dim === dim)?.value) === value
  )
  if (!groups.length) return { ...sel, [dim]: value }
  // found alongside the picks to its left: nothing to move
  const at = dims.indexOf(dim)
  const alongside = (g: FacetGroup<T>): boolean =>
    dims
      .slice(0, at)
      .every((d) => String(g.values.find((v) => v.dim === d)?.value) === shown.get(d))
  if (groups.some(alongside)) return { ...sel, [dim]: value }
  const score = (g: FacetGroup<T>): number[] => [
    ...dims.map((d) => (String(g.values.find((v) => v.dim === d)?.value) === shown.get(d) ? 1 : 0)),
    facetPaired(g.rows) ? 1 : 0
  ]
  const better = (a: number[], b: number[]): boolean => {
    // paired first, then the leftmost dims kept
    if (a[a.length - 1] !== b[b.length - 1]) return a[a.length - 1] > b[b.length - 1]
    for (let i = 0; i < a.length - 1; i++) if (a[i] !== b[i]) return a[i] > b[i]
    return false
  }
  let best = groups[0]
  let bestScore = score(best)
  for (const g of groups.slice(1)) {
    const sc = score(g)
    if (better(sc, bestScore)) {
      best = g
      bestScore = sc
    }
  }
  // the dims left of `dim` take the tuple's levels; `dim` and those right of it keep their picks
  // (re-resolved against it)
  const next = { ...sel, [dim]: value }
  for (const { dim: d, value: v } of best.values) if (dims.indexOf(d) < at) next[d] = String(v)
  return next
}

/** A comparison's two sides ("10 | 0" → ["10", "0"]); null when it isn't one `A | B`. */
function sidesOf(c: string): [string, string] | null {
  const parts = c.split(' | ')
  return parts.length === 2 ? [parts[0], parts[1]] : null
}

/** The denominator every level of a comparison bar shares — each dose against 0, each compound
 *  against DMSO — or null (another dim; the levels compared against different things). */
export function sharedDenominator(bar: FacetBar): string | null {
  if (bar.dim !== 'comparison') return null
  const dens = new Set(bar.options.map((o) => sidesOf(String(o.value))?.[1] ?? null))
  const [den] = dens
  return dens.size === 1 && den != null ? den : null
}

/** A bar's label: its dim's — a comparison bar whose levels share a denominator says it once
 *  ("comparison vs 0"), its levels then showing just their numerators (facetChoice). */
export function facetBarLabel(bar: FacetBar): string {
  const den = sharedDenominator(bar)
  return den != null ? `${facetKeyLabel(bar.dim)} vs ${den}` : facetKeyLabel(bar.dim)
}

/** A level as a switch's option: a one-sided contrast level greyed (the tooltip says which side
 *  has the data); one that moves the picks to its left says which. */
export function facetChoice(
  dim: FacetKey,
  o: FacetOption,
  bars: FacetBar[]
): { value: string; label: string; disabled?: boolean; title?: string } {
  const v = String(o.value)
  // comparisons sharing a denominator: just the numerator (the bar's label names the rest)
  const bar = bars.find((b) => b.dim === dim)
  const label = bar && sharedDenominator(bar) != null ? (sidesOf(v)?.[0] ?? v) : v
  if (o.onlyOn)
    return {
      value: v,
      label,
      disabled: true,
      title: `${facetKeyLabel(dim)} = ${v} is only on ${o.onlyOn} — no partner to contrast`
    }
  if (o.moves) {
    const left = bars
      .slice(
        0,
        bars.findIndex((b) => b.dim === dim)
      )
      .map((b) => facetKeyLabel(b.dim))
    return {
      value: v,
      label,
      title: `Not at the ${left.join(' / ')} on show — picking it switches ${left.length > 1 ? 'them' : 'it'}`
    }
  }
  return { value: v, label }
}

interface FacetState {
  /** groupId → (dim → chosen level). Missing dims fall back to the first valid option. */
  sel: Record<string, Record<string, string>>
  setLevel: (groupId: string, dim: string, value: string) => void
  /** replace a group's whole selection (a pick that moved the dims to its left — pickFacet) */
  setSel: (groupId: string, sel: Record<string, string>) => void
}

/** Stable empty selection so a group with no explicit choice doesn't re-render its tiles. */
export const EMPTY_SEL: Record<string, string> = {}

export const useFacet = create<FacetState>((set) => ({
  sel: {},
  setLevel: (groupId, dim, value) =>
    set((s) => ({
      sel: { ...s.sel, [groupId]: { ...(s.sel[groupId] ?? {}), [dim]: value } }
    })),
  setSel: (groupId, sel) => set((s) => ({ sel: { ...s.sel, [groupId]: sel } }))
}))
