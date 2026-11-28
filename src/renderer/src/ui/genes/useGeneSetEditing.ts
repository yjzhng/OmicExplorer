/** Editing a gene group's genes from the gene menu's list (see GeneSelectMenu): the draft, its live
 *  mirror in the selection, and Confirm / Cancel. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useGraph } from '../../graph/store'
import type { GeneSet } from '../../graph/types'
import { useSelection } from '../plot/useSelection'
import { SELECTION_ID, SELECTION_NAME } from './geneMenuModel'

export interface GeneSetEditing {
  /** the group being edited (SELECTION_ID for the Current selection), or null */
  editId: string | null
  /** the edited group with its draft as its genes, or null when nothing is edited */
  editSet: GeneSet | null
  /** what the gene list's checkboxes read: the draft's genes while editing, else the selection */
  checkedIds: Set<string>
  startEdit: (id: string) => void
  editDraft: (genes: GeneSet['genes']) => void
  confirmEdit: () => void
  cancelEdit: () => void
  /** what the gene list's checkboxes write */
  toggleIds: (ids: string[]) => void
}

export function useGeneSetEditing({
  geneSets,
  labelById,
  pinnedIds,
  selectionGenes,
  setPins,
  togglePin,
  togglePins,
  updateGeneSetGenes
}: {
  geneSets: GeneSet[]
  labelById: Map<string, string>
  pinnedIds: Set<string>
  /** the current selection as geneset members (id + captured label) */
  selectionGenes: () => { id: string; label: string }[]
  setPins: (ids: string[]) => void
  togglePin: (id: string) => void
  togglePins: (ids: string[]) => void
  updateGeneSetGenes: (id: string, genes: GeneSet['genes']) => void
}): GeneSetEditing {
  // The geneset being edited from the gene list: while set, the list's checkboxes show and change
  // THAT set's members instead of the shared selection — how a set is built without selecting first.
  const [editId, setEditId] = useState<string | null>(null)
  // The edited set's members as edited so far — a draft: the group itself (and every plot, mask
  // and count that reads it) changes only on Confirm; Cancel drops it. Mirrored in a ref for the
  // selection subscription below, which runs before React re-renders.
  const [draft, setDraft] = useState<GeneSet['genes'] | null>(null)
  const draftRef = useRef<GeneSet['genes'] | null>(null)
  const writeDraft = useCallback((genes: GeneSet['genes'] | null): void => {
    draftRef.current = genes
    setDraft(genes)
  }, [])
  // What the gene list's checkboxes read and write: the edited set's members (the draft), else
  // the selection.
  // (Editing the Current selection: no stored group — its draft is the selection's genes.)
  const storedEdit = useMemo(
    (): GeneSet | null =>
      editId === SELECTION_ID
        ? { id: SELECTION_ID, name: SELECTION_NAME, genes: [] }
        : (geneSets.find((g) => g.id === editId) ?? null),
    [editId, geneSets]
  )
  const editSet = useMemo(
    () => (storedEdit ? { ...storedEdit, genes: draft ?? storedEdit.genes } : null),
    [storedEdit, draft]
  )
  // While a group is edited, the SELECTION is its draft: every view highlights it live through the
  // ordinary selection, and a pick made anywhere else meanwhile — a dot in a plot, a table row, a
  // legend entry — goes into the draft, so a group can be built straight from the plots. The group
  // itself takes the draft only on Confirm; Cancel puts the selection back as it was before.
  // Clearing the selection (a plot's double-click) is undone rather than emptying the draft.
  // The group the subscription below may write to. Cleared synchronously when editing ends from an
  // in-menu action, since the store notifies before React re-renders and unsubscribes.
  const syncTo = useRef<string | null>(null)
  // the selection before editing began, for Cancel
  const before = useRef<string[]>([])
  useEffect(() => {
    syncTo.current = editId
    if (!editId) return
    return useSelection.subscribe((st, prev) => {
      if (st.pinnedIds === prev.pinnedIds || syncTo.current !== editId) return
      const genes = draftRef.current
      if (!genes) return
      const pins = st.pinnedIds
      if (genes.length === pins.size && genes.every((g) => pins.has(g.id))) return
      if (pins.size === 0 && genes.length > 0)
        return useSelection.getState().setPins(genes.map((g) => g.id))
      const kept = genes.filter((g) => pins.has(g.id))
      const have = new Set(kept.map((g) => g.id))
      const added = [...pins]
        .filter((id) => !have.has(id))
        .map((id) => ({ id, label: labelById.get(id) ?? id }))
      writeDraft([...kept, ...added])
    })
  }, [editId, labelById, writeDraft])
  const checkedIds = useMemo(
    () => (editSet ? new Set(editSet.genes.map((g) => g.id)) : pinnedIds),
    [editSet, pinnedIds]
  )
  // Editing starts a draft of the group's members and selects it.
  function startEdit(id: string): void {
    // Read from the store, not this render: a set just created isn't in `geneSets` yet. The
    // Current selection starts from the selection.
    const genes =
      id === SELECTION_ID
        ? selectionGenes()
        : (useGraph.getState().geneSets.find((g) => g.id === id)?.genes ?? [])
    before.current = [...useSelection.getState().pinnedIds]
    writeDraft(genes)
    setEditId(id)
    setPins(genes.map((g) => g.id))
  }
  // A draft edit: the draft and, with it, the selection (the live highlight).
  const editDraft = (genes: GeneSet['genes']): void => {
    writeDraft(genes)
    setPins(genes.map((g) => g.id))
  }
  // Confirm: the draft becomes the group's members — only now does anything that reads the group
  // change. (The Current selection's draft already is the selection: nothing to store.)
  function confirmEdit(): void {
    syncTo.current = null
    if (editId && editId !== SELECTION_ID && draftRef.current)
      updateGeneSetGenes(editId, draftRef.current)
    writeDraft(null)
    setEditId(null)
  }
  // Cancel: drop the draft — the group was never touched — and put the selection back as it was.
  function cancelEdit(): void {
    syncTo.current = null
    writeDraft(null)
    setEditId(null)
    setPins(before.current)
  }
  // Same all-or-nothing rule as togglePins: every id already in → take them all out, else add the rest.
  const toggleIds = (ids: string[]): void => {
    if (!editSet) return ids.length === 1 ? togglePin(ids[0]) : togglePins(ids)
    const uniq = [...new Set(ids)]
    if (uniq.length === 0) return
    const have = new Set(editSet.genes.map((g) => g.id))
    const allIn = uniq.every((id) => have.has(id))
    const genes = allIn
      ? editSet.genes.filter((g) => !uniq.includes(g.id))
      : [
          ...editSet.genes,
          ...uniq
            .filter((id) => !have.has(id))
            .map((id) => ({ id, label: labelById.get(id) ?? id }))
        ]
    editDraft(genes)
  }
  return { editId, editSet, checkedIds, startEdit, editDraft, confirmEdit, cancelEdit, toggleIds }
}
