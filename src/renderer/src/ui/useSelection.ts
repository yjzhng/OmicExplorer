/** Cross-plot linked selection, keyed by feature id (`uniqID`).
 *
 *  Kept separate from the graph store so hover churn (which fires rapidly) never
 *  re-renders the pipeline canvas. Highlighting is applied imperatively in
 *  PlotlyChart via restyle, so this slice only holds the selected ids.
 */
import { create } from 'zustand'

interface SelectionState {
  /** transient hover (one feature) */
  hoverId: string | null
  /** sticky selection (click to pin/unpin) */
  pinnedIds: Set<string>
  setHover: (id: string | null) => void
  clearHover: () => void
  togglePin: (id: string) => void
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
  clearPins: () => set((s) => (s.pinnedIds.size === 0 ? s : { pinnedIds: new Set() }))
}))
