/** Shared facet-context selection for the results dashboard.
 *
 * All plots in one analysis group derive from the same comparison, so they share one
 * facet context (strain/dose/time). Instead of each plot carrying its own switch-tabs,
 * a single control in the results header drives this store, keyed by group id, and every
 * FacetedPlot in the group reads the resolved selection.
 */
import { create } from 'zustand'

import { facetCompareRows, type ConditionKey, type ContextRow } from '../engine'

export interface FacetBar {
  dim: ConditionKey
  value: string | number
  /** the levels valid alongside the dims already fixed to the left */
  options: (string | number)[]
}

/**
 * Resolve a facet selection against a comparison's rows: the valid options per dim
 * (narrowed left-to-right so impossible tuples — a vehicle at a treatment dose — never
 * appear) and the chosen tuple's rows. A now-invalid choice falls back to the first valid
 * level. Shared by the global control and each FacetedPlot so they always agree.
 */
export function resolveFacets<T extends ContextRow>(
  rows: T[],
  dims: ConditionKey[],
  sel: Record<string, string>
): { bars: FacetBar[]; rows: T[] } {
  const groups = facetCompareRows(rows, dims)
  const valueOf = (g: (typeof groups)[number], d: ConditionKey): string | number =>
    g.values.find((v) => v.dim === d)?.value as string | number
  const bars: FacetBar[] = []
  let candidates = groups
  for (const d of dims) {
    const options: (string | number)[] = []
    const seen = new Set<string>()
    for (const g of candidates) {
      const v = valueOf(g, d)
      if (!seen.has(String(v))) {
        seen.add(String(v))
        options.push(v)
      }
    }
    const value = options.find((v) => String(v) === sel[d]) ?? options[0]
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
