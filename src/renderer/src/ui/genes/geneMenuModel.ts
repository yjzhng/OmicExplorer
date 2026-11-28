/** The gene menu's data shapes, constants and pure helpers (see GeneSelectMenu). */
import type { GroupCombine } from '../plot/useSelection'

/** A row of the gene tree as shown (see treeRows). */
export type TreeRow =
  | { t: 'cat'; key: string; c: GeneCategory }
  | { t: 'group'; key: string; c: GeneCategory; name: string }
  | { t: 'path'; key: string; c: GeneCategory; pw: GenePathway; indent: number }
  | { t: 'gene'; key: string; g: Gene; indent: number }

export interface Gene {
  id: string
  label: string
  /** Protein description (UniProt `proteinName`), shown right of the gene name and searchable. */
  desc?: string
}
/** A pathway group of genes. */
export interface GenePathway {
  name: string
  /** the middle level it sits under within its category (KEGG pathway group, Reactome level 2) —
   *  pathways sharing one are shown together under its own header; none = directly in the category */
  group?: string
  genes: Gene[]
}
/** A category's pathways as consecutive runs sharing a middle-level group (or none). */
export function runsByGroup(
  pathways: GenePathway[]
): { group?: string; pathways: GenePathway[] }[] {
  const runs: { group?: string; pathways: GenePathway[] }[] = []
  for (const pw of pathways) {
    const last = runs[runs.length - 1]
    if (last && last.group === pw.group) last.pathways.push(pw)
    else runs.push({ group: pw.group, pathways: [pw] })
  }
  return runs
}

/** A gene category. Either nested (`pathways`, e.g. a KEGG BRITE top level holding pathways) or
 *  flat (`genes` directly, e.g. an essentiality class with no pathway sublevel). */
export interface GeneCategory {
  name: string
  pathways?: GenePathway[]
  genes?: Gene[]
}
/** A named grouping the menu can switch between via the tab bar (e.g. Pathway / Essentiality). */
export interface GeneGroupTab {
  key: string
  label: string
  categories: GeneCategory[]
  /** a choice WITHIN the tab (Pathway: which term set groups the genes), shown as a dropdown under
   *  the tab bar while the tab is active; the caller rebuilds `categories` for the choice */
  variant?: {
    value: string
    options: { value: string; label: string }[]
    onChange: (value: string) => void
  }
}

/** Shortest search text acted on — one character matches nearly everything. */
export const MIN_SEARCH = 2
/** Destructive-action colour (matches the app's red used elsewhere). */
export const DANGER = '#e15759'
/** The Current selection row: always first in the gene-group list, never stored, renamed or
 *  deleted. Its id can't clash with a stored group's. */
export const SELECTION_ID = '\u0000selection'
export const SELECTION_NAME = 'Current selection'
/** The menu's width (px). */
export const MENU_W = 340

/** Which per-row action a portal tooltip names (see ActionTip). */
export type TipKind = 'rename' | 'edit' | 'delete' | 'saveas'

// The mode button cycles union → intersect → switch.
export const NEXT_COMBINE: Record<GroupCombine, GroupCombine> = {
  union: 'intersect',
  intersect: 'switch',
  switch: 'union'
}
export const COMBINE_TIP: Record<GroupCombine, string> = {
  union: 'Union: the groups picked select all their genes',
  intersect: 'Intersection: the groups picked select only the genes they share',
  switch: 'Switch: one group at a time — picking a group replaces the selection with it'
}

/** A copy of `set` with `key` flipped in or out, handed to `setter`. */
export function toggleIn(set: Set<string>, setter: (s: Set<string>) => void, key: string): void {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  setter(next)
}
