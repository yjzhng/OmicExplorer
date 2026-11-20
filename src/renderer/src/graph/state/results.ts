import { type Getter, type GraphState, type StoreSet } from '../store'
import { reapplyGeneMask } from './shared'

/** The Results page's layout and tab order, and the gene sets. */
export function resultsSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'setGroupLayout'
  | 'resetGroupLayout'
  | 'reorderGroups'
  | 'createGeneSet'
  | 'renameGeneSet'
  | 'updateGeneSetGenes'
  | 'setGeneSetColor'
  | 'deleteGeneSet'
  | 'toggleGeneSetHidden'
> {
  return {
    setGroupLayout: (rootId, layout) => {
      set((s) => ({ groupLayouts: { ...s.groupLayouts, [rootId]: layout }, dirty: true }))
    },
    resetGroupLayout: (rootId) => {
      set((s) => {
        if (!(rootId in s.groupLayouts)) return {}
        const next = { ...s.groupLayouts }
        delete next[rootId]
        return { groupLayouts: next, dirty: true }
      })
    },
    reorderGroups: (orderedRootIds) => {
      set((s) => {
        const meta = { ...s.groupMeta }
        orderedRootIds.forEach((rootId, i) => {
          meta[rootId] = { ...(meta[rootId] ?? {}), order: i }
        })
        return { groupMeta: meta, dirty: true }
      })
    },

    createGeneSet: (name, genes) => {
      const id = `gs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
      set((s) => ({
        geneSets: [...s.geneSets, { id, name: name.trim() || 'Untitled', genes }],
        dirty: true
      }))
      return id
    },
    renameGeneSet: (id, name) => {
      set((s) => {
        if (!s.geneSets.some((g) => g.id === id)) return {}
        return {
          geneSets: s.geneSets.map((g) =>
            g.id === id ? { ...g, name: name.trim() || g.name } : g
          ),
          dirty: true
        }
      })
    },
    updateGeneSetGenes: (id, genes) => {
      set((s) => {
        if (!s.geneSets.some((g) => g.id === id)) return {}
        return {
          geneSets: s.geneSets.map((g) => (g.id === id ? { ...g, genes } : g)),
          dirty: true
        }
      })
      // A hidden set's genes are the mask: changing them changes what's masked.
      if (get().geneSets.find((g) => g.id === id)?.hidden) reapplyGeneMask(get, set)
    },
    setGeneSetColor: (id, color) => {
      set((s) => {
        if (!s.geneSets.some((g) => g.id === id)) return {}
        return {
          geneSets: s.geneSets.map((g) => {
            if (g.id !== id) return g
            const next = { ...g }
            if (color) next.color = color
            else delete next.color
            return next
          }),
          dirty: true
        }
      })
    },
    deleteGeneSet: (id) => {
      const gone = get().geneSets.find((g) => g.id === id)
      if (!gone) return
      set((s) => ({ geneSets: s.geneSets.filter((g) => g.id !== id), dirty: true }))
      // Only a HIDDEN set is part of the mask. Re-applying it rebuilds every Compare result (so every
      // plot redraws) and re-runs every Contrast — work a visible set's deletion doesn't need.
      if (gone.hidden) reapplyGeneMask(get, set)
    },
    toggleGeneSetHidden: (id) => {
      set((s) => {
        if (!s.geneSets.some((g) => g.id === id)) return {}
        return {
          geneSets: s.geneSets.map((g) => (g.id === id ? { ...g, hidden: !g.hidden } : g)),
          dirty: true
        }
      })
      reapplyGeneMask(get, set)
    }
  }
}
