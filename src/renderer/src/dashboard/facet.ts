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
  facetPaired,
  facetSides,
  type ContextRow,
  type FacetGroup,
  type FacetKey
} from '../engine'

export interface FacetOption {
  value: string | number
  /** Set when nothing at this level (alongside the dims fixed to its left) has data on both
   *  sides: a contrast context measured on one side only, carried by the engine's outer join.
   *  Names the side(s) that do carry data; the tab is greyed out and can't be chosen. */
  onlyOn?: string
}

export interface FacetBar {
  dim: FacetKey
  value: string | number
  /** the levels valid alongside the dims already fixed to the left */
  options: FacetOption[]
}

/**
 * Resolve a facet selection against a comparison's rows: the valid options per dim
 * (narrowed left-to-right so impossible tuples — a vehicle at a treatment dose — never
 * appear) and the chosen tuple's rows. A now-invalid (or one-sided) choice falls back to the
 * first paired level. Shared by the global control and each FacetedPlot so they always agree.
 */
export function resolveFacets<T extends ContextRow>(
  rows: T[],
  dims: FacetKey[],
  sel: Record<string, string>
): { bars: FacetBar[]; rows: T[] } {
  const groups = facetCompareRows(rows, dims)
  const valueOf = (g: FacetGroup<T>, d: FacetKey): string | number =>
    g.values.find((v) => v.dim === d)?.value as string | number
  const bars: FacetBar[] = []
  let candidates = groups
  for (const d of dims) {
    // Level → the candidate groups at that level (insertion order = the engine's sort order).
    const byLevel = new Map<string, { value: string | number; groups: FacetGroup<T>[] }>()
    for (const g of candidates) {
      const v = valueOf(g, d)
      let e = byLevel.get(String(v))
      if (!e) byLevel.set(String(v), (e = { value: v, groups: [] }))
      e.groups.push(g)
    }
    const options: FacetOption[] = [...byLevel.values()].map(({ value, groups: gs }) => {
      if (gs.some((g) => facetPaired(g.rows))) return { value }
      const sides = facetSides(gs.flatMap((g) => g.rows))
      return { value, onlyOn: sides.length ? sides.join(' / ') : 'one side' }
    })
    const pick =
      options.find((o) => !o.onlyOn && String(o.value) === sel[d]) ??
      options.find((o) => !o.onlyOn) ??
      options[0]
    const value = pick.value
    bars.push({ dim: d, value, options })
    candidates = candidates.filter((g) => String(valueOf(g, d)) === String(value))
  }
  return { bars, rows: candidates[0]?.rows ?? [] }
}

interface FacetState {
  /** groupId → (dim → chosen level). Missing dims fall back to the first valid option. */
  sel: Record<string, Record<string, string>>
  setLevel: (groupId: string, dim: string, value: string) => void
}

/** Stable empty selection so a group with no explicit choice doesn't re-render its tiles. */
export const EMPTY_SEL: Record<string, string> = {}

export const useFacet = create<FacetState>((set) => ({
  sel: {},
  setLevel: (groupId, dim, value) =>
    set((s) => ({
      sel: { ...s.sel, [groupId]: { ...(s.sel[groupId] ?? {}), [dim]: value } }
    }))
}))
