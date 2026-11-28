/** Naming gene groups in the gene menu (see GeneSelectMenu): a new group's name row, and renaming
 *  a group in its own row. */
import { useState } from 'react'

export interface GeneSetNaming {
  /** which new-name row shows, if any (see below) */
  creating: 'selection' | 'empty' | null
  setCreating: (c: 'selection' | 'empty' | null) => void
  nameDraft: string
  setNameDraft: (name: string) => void
  /** the group being renamed, if any */
  renameId: string | null
  setRenameId: (id: string | null) => void
  /** Open a new group's name row: under the Current selection ('selection'), or at the list's foot. */
  startCreate: (kind: 'selection' | 'empty') => void
  /** Rename a group in its row, its name as the starting text. */
  startRename: (id: string, name: string) => void
  commitCreate: () => void
  commitRename: (id: string) => void
}

export function useGeneSetNaming({
  geneSetCount,
  selectedCount,
  selectionGenes,
  createGeneSet,
  renameGeneSet,
  startEdit
}: {
  /** how many groups are stored (a blank name becomes "Gene group <count + 1>") */
  geneSetCount: number
  /** how many genes are selected */
  selectedCount: number
  selectionGenes: () => { id: string; label: string }[]
  createGeneSet: (name: string, genes: { id: string; label: string }[]) => string
  renameGeneSet: (id: string, name: string) => void
  startEdit: (id: string) => void
}): GeneSetNaming {
  // Geneset editing state: `creating` shows the new-name input — under the Current selection row
  // for its Save as ('selection'), at the list's foot for a new empty group ('empty');
  // `renameId` marks the row being renamed.
  const [creating, setCreating] = useState<'selection' | 'empty' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  // The Current selection row's Save as takes the selection; "+ New gene group" starts empty and
  // opens for editing, so its genes are then checked straight off the list below.
  const commitCreate = (): void => {
    const name = nameDraft.trim() || `Gene group ${geneSetCount + 1}`
    const empty = creating !== 'selection' || selectedCount === 0
    const id = createGeneSet(name, empty ? [] : selectionGenes())
    if (empty) startEdit(id)
    setCreating(null)
    setNameDraft('')
  }
  const commitRename = (id: string): void => {
    renameGeneSet(id, nameDraft)
    setRenameId(null)
    setNameDraft('')
  }
  const startCreate = (kind: 'selection' | 'empty'): void => {
    setNameDraft('')
    setRenameId(null)
    setCreating(kind)
  }
  const startRename = (id: string, name: string): void => {
    setNameDraft(name)
    setCreating(null)
    setRenameId(id)
  }
  return {
    creating,
    setCreating,
    nameDraft,
    setNameDraft,
    renameId,
    setRenameId,
    startCreate,
    startRename,
    commitCreate,
    commitRename
  }
}
