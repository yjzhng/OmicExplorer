/** Cross-plot linked selection, keyed by feature id (`uniqID`).
 *
 *  Kept separate from the graph store so hover churn (which fires rapidly) never
 *  re-renders the pipeline canvas. Highlighting is applied imperatively in
 *  PlotlyChart via restyle, so this slice only holds the selected ids.
 */
import { create } from 'zustand'

import type { GeneSet } from '../graph/types'

interface SelectionState {
  /** transient hover (one feature) */
  hoverId: string | null
  /** sticky selection (click to pin/unpin) */
  pinnedIds: Set<string>
  setHover: (id: string | null) => void
  clearHover: () => void
  togglePin: (id: string) => void
  /** Toggle a whole group at once (e.g. a legend group): if every id is already pinned, unpin
   *  them all; otherwise add them all. */
  togglePins: (ids: string[]) => void
  /** Single-select: pin exactly this id (replacing any others); clicking the sole pin clears it. */
  selectOnly: (id: string) => void
  /** Replace the whole pinned set with `ids` (e.g. loading a saved geneset). */
  setPins: (ids: string[]) => void
  clearPins: () => void
}

export const useSelection = create<SelectionState>((set) => ({
  hoverId: null,
  pinnedIds: new Set(),
  setHover: (id) => set((s) => (s.hoverId === id ? s : { hoverId: id })),
  clearHover: () => set((s) => (s.hoverId === null ? s : { hoverId: null })),
  togglePin: (id) =>
    set((s) => {
      const next = new Set(s.pinnedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { pinnedIds: next }
    }),
  togglePins: (ids) =>
    set((s) => {
      const uniq = [...new Set(ids)]
      if (uniq.length === 0) return s
      const next = new Set(s.pinnedIds)
      const allPinned = uniq.every((id) => next.has(id))
      for (const id of uniq) {
        if (allPinned) next.delete(id)
        else next.add(id)
      }
      return { pinnedIds: next }
    }),
  selectOnly: (id) =>
    set((s) => {
      if (s.pinnedIds.size === 1 && s.pinnedIds.has(id)) return { pinnedIds: new Set() }
      return { pinnedIds: new Set([id]) }
    }),
  setPins: (ids) => set({ pinnedIds: new Set(ids) }),
  clearPins: () => set((s) => (s.pinnedIds.size === 0 ? s : { pinnedIds: new Set() }))
}))

/** The saved geneset the pinned selection IS, if any: its gene ids equal the pinned set exactly
 *  (first match wins). Views name a selection-derived legend entry after it — an ad-hoc pick has
 *  no name worth a legend row, so they hide the entry when this is null. */
export function matchingGeneSet(pinnedIds: Set<string>, geneSets: GeneSet[]): GeneSet | null {
  if (pinnedIds.size === 0) return null
  for (const gs of geneSets) {
    const ids = new Set(gs.genes.map((g) => g.id))
    if (ids.size !== pinnedIds.size) continue
    let same = true
    for (const id of pinnedIds) {
      if (!ids.has(id)) {
        same = false
        break
      }
    }
    if (same) return gs
  }
  return null
}
