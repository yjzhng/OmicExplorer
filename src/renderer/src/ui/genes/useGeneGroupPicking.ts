/** Picking gene groups from the gene menu's list, combined by union / intersection / switch, and the
 *  name the selection goes by (see GeneSelectMenu). */
import { useMemo } from 'react'

import type { GeneSet } from '../../graph/types'
import { commonGenes, selectedGeneSets, type GroupCombine } from '../plot/useSelection'
import type { GeneGroupTab } from './geneMenuModel'

export interface GeneGroupPicking {
  /** intersecting, and the selection is still the genes the picked groups share */
  pickedLive: boolean
  /** the groups shown as selected */
  activeSets: Set<string>
  /** what the selection IS when it's exactly one named group (see below), else null */
  selectionName: string | null
  switchCombine: (mode: GroupCombine) => void
  toggleGeneSet: (id: string) => void
}

export function useGeneGroupPicking({
  tabs,
  geneSets,
  pinnedIds,
  editing,
  combine,
  picked,
  setCombine,
  setPicked,
  setPins,
  clearPins
}: {
  tabs: GeneGroupTab[]
  geneSets: GeneSet[]
  pinnedIds: Set<string>
  /** a gene group is being edited (its picks add genes to it) */
  editing: boolean
  combine: GroupCombine
  picked: string[]
  setCombine: (mode: GroupCombine) => void
  setPicked: (ids: string[]) => void
  setPins: (ids: string[]) => void
  clearPins: () => void
}): GeneGroupPicking {
  // A geneset is selected while all its genes are; several can be at once. Intersecting, the
  // picked ones are — while the selection is still the genes they share (a pick made elsewhere
  // since, in a plot or the list, leaves them unpicked).
  const setsOf = (ids: string[]): GeneSet[] =>
    ids.map((id) => geneSets.find((g) => g.id === id)).filter((g): g is GeneSet => !!g)
  const pickedLive =
    combine === 'intersect' &&
    picked.length > 0 &&
    (() => {
      const common = commonGenes(setsOf(picked))
      return common.length === pinnedIds.size && common.every((id) => pinnedIds.has(id))
    })()
  const activeSets = pickedLive
    ? new Set(picked)
    : new Set(
        geneSets
          .filter((gs) => gs.genes.length > 0 && gs.genes.every((g) => pinnedIds.has(g.id)))
          .map((gs) => gs.id)
      )
  /** Switch how picked groups combine, keeping the groups picked: union → their shared genes,
   *  intersect → all their genes; switch keeps the selection as it is (the next pick replaces it). */
  const switchCombine = (mode: GroupCombine): void => {
    if (mode === combine) return
    const sets = [...activeSets]
    setCombine(mode)
    if (mode === 'intersect') {
      setPicked(sets)
      if (sets.length) setPins(commonGenes(setsOf(sets)))
    } else {
      setPicked([])
      if (pickedLive) setPins(setsOf(sets).flatMap((gs) => gs.genes.map((g) => g.id)))
    }
  }
  // Select a set → add its genes. Deselect → take them out, except genes another selected set
  // still holds (so overlapping sets stay whole). A set that contains this one doesn't count: it
  // would hold every gene, and the click would do nothing.
  const toggleGeneSet = (id: string): void => {
    const gs = geneSets.find((g) => g.id === id)
    if (!gs) return
    // Intersecting (not while editing a set, whose picks add genes to it): the selection is the
    // genes every picked group shares.
    if (combine === 'intersect' && !editing) {
      const base = [...activeSets]
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
      setPicked(next)
      setPins(commonGenes(setsOf(next)))
      return
    }
    // Switching (likewise not while editing): the group becomes the selection — or, when it already
    // is exactly the selection, the selection clears.
    if (combine === 'switch' && !editing) {
      const ids = [...new Set(gs.genes.map((g) => g.id))]
      const exact = ids.length === pinnedIds.size && ids.every((g) => pinnedIds.has(g))
      return exact ? clearPins() : setPins(ids)
    }
    // While editing, this adds (or removes) the group's genes in the one being edited — the
    // selection change flows into it like any other pick.
    const ids = new Set(gs.genes.map((g) => g.id))
    if (!activeSets.has(id)) return setPins([...pinnedIds, ...ids])
    const keep = new Set(
      geneSets
        .filter((o) => o.id !== id && activeSets.has(o.id))
        .filter((o) => ![...ids].every((g) => o.genes.some((og) => og.id === g)))
        .flatMap((o) => o.genes.map((g) => g.id))
    )
    setPins([...pinnedIds].filter((g) => !ids.has(g) || keep.has(g)))
  }
  // What the selection IS, when it's exactly one named group: a geneset first (the user's own
  // name wins; several genesets read as their count), else a pathway / category from the menu's groupings — any tab, any level (a KEGG
  // category counts as the union of its pathways). Null for an ad-hoc selection.
  const selectionName = useMemo((): string | null => {
    if (pinnedIds.size === 0) return null
    const same = (ids: Iterable<string>): boolean => {
      const set = new Set(ids)
      if (set.size !== pinnedIds.size) return false
      for (const id of set) if (!pinnedIds.has(id)) return false
      return true
    }
    for (const gs of geneSets) if (same(gs.genes.map((g) => g.id))) return gs.name
    // Several genesets selected together (and nothing else): how many.
    if (pickedLive && picked.length > 1) return `${picked.length} gene groups, shared`
    const sets = selectedGeneSets(pinnedIds, geneSets)
    if (sets.length > 1) return `${sets.length} gene groups`
    for (const t of tabs)
      for (const c of t.categories) {
        if (c.genes && same(c.genes.map((g) => g.id))) return c.name
        for (const pw of c.pathways ?? []) if (same(pw.genes.map((g) => g.id))) return pw.name
        // a middle-level group: the union of its pathways
        const byGroup = new Map<string, string[]>()
        for (const pw of c.pathways ?? [])
          if (pw.group)
            byGroup.set(pw.group, [...(byGroup.get(pw.group) ?? []), ...pw.genes.map((g) => g.id)])
        for (const [g, ids] of byGroup) if (same(ids)) return g
        if (c.pathways && same(c.pathways.flatMap((pw) => pw.genes.map((g) => g.id)))) return c.name
      }
    return null
  }, [pinnedIds, geneSets, tabs, pickedLive, picked.length])
  return { pickedLive, activeSets, selectionName, switchCombine, toggleGeneSet }
}
