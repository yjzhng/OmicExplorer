/**
 * The annotation fields the Metadata stage offers (UniProt and the sources' own), their groups and
 * defaults, and the floating menu's placement.
 */
import { useEffect, useRef, useState } from 'react'

/** Fields offered by the annotation fetch (id → display label + resulting DB column(s)). Most come
 *  straight from UniProt; COG, MSigDB and Reactome are resolved in the main process from a UniProt
 *  cross-reference (see main/annotate.ts). A fetch always pulls ALL of these and caches them, so
 *  toggling which are shown never refetches. */
export const UNIPROT_FIELDS: { id: string; label: string; cols: string[] }[] = [
  { id: 'protein_name', label: 'Protein name', cols: ['proteinName'] },
  { id: 'gene_names', label: 'Gene name', cols: ['geneName'] },
  // The ordered locus name (systematic gene name): the label where a protein has no gene name.
  { id: 'locus', label: 'Gene locus', cols: ['locus'] },
  // GO as ONE pick: its three aspects are fetched together (UniProt serves them as three fields,
  // stored as three columns) and pooled by enrichment anyway — see sourceIds.
  { id: 'go', label: 'GO', cols: ['GO_BP', 'GO_MF', 'GO_CC'] },
  // Orthologous group via eggNOG → NCBI KOG (eukaryotes, human included) or COG2020 (prokaryotes),
  // as ONE pick: each protein gets whichever its own cross-reference gives — KOG where it has one
  // (main/annotate.ts) — the group name, functional category and area, in the KOG_* / COG_* columns.
  {
    id: 'cog',
    label: 'COG/KOG',
    cols: ['COG', 'COG_cat', 'COG_area', 'KOG', 'KOG_cat', 'KOG_area']
  },
  { id: 'msigdb', label: 'MSigDB', cols: ['MSigDB'] },
  // Each pathway with its pathway category and group (aligned columns).
  { id: 'kegg', label: 'KEGG', cols: ['KEGG', 'KEGG_cat', 'KEGG_grp'] },
  // Each level-3 pathway with its level-2 group and top-level category (aligned columns).
  {
    id: 'reactome',
    label: 'Reactome',
    cols: ['Reactome', 'Reactome_grp', 'Reactome_cat']
  },
  { id: 'string', label: 'STRING', cols: ['stringId'] },
  // A local join by UniProt accession — no network: DEG, a cross-organism union of screens
  // (essential-only).
  { id: 'essentiality', label: 'DEG', cols: ['DEG'] }
]
export const fieldLabel = (id: string): string =>
  UNIPROT_FIELDS.find((f) => f.id === id)?.label ?? id

export const colsForIds = (ids: string[]): string[] =>
  UNIPROT_FIELDS.filter((f) => ids.includes(f.id)).flatMap((f) => f.cols)
/** The fetch's own field ids for the picked ones: the single GO pick is the three aspects the
 *  fetch knows separately (main/annotate.ts — go_bp / go_mf / go_cc), and the COG/KOG pick both
 *  kinds of group (each protein then gets the one its cross-reference gives). */
export const sourceIds = (ids: string[]): string[] =>
  ids.flatMap((id) =>
    id === 'go' ? ['go_bp', 'go_mf', 'go_cc'] : id === 'cog' ? ['cog', 'kog'] : [id]
  )

/** The fetch options grouped by what they annotate. A member is either a fetchable field id from
 *  UNIPROT_FIELDS or a placeholder (`soon`) for a source not wired up yet — listed so the category
 *  structure is complete, but shown disabled. */
export interface AnnGroup {
  id: string
  label: string
  members: { id: string; label: string; soon?: boolean }[]
}
/** The fields ticked by default (and by Reset). */
export const ANN_DEFAULT = [
  'protein_name',
  'gene_names',
  'locus',
  'go',
  'cog',
  'kegg',
  'essentiality',
  'string'
]

export const ANN_GROUPS: AnnGroup[] = [
  {
    id: 'identifiers',
    label: 'Identifiers',
    members: [
      { id: 'protein_name', label: fieldLabel('protein_name') },
      { id: 'gene_names', label: fieldLabel('gene_names') },
      { id: 'locus', label: fieldLabel('locus') }
    ]
  },
  {
    id: 'function',
    label: 'Function',
    members: [
      { id: 'go', label: fieldLabel('go') },
      { id: 'cog', label: fieldLabel('cog') },
      { id: 'msigdb', label: fieldLabel('msigdb') }
    ]
  },
  {
    id: 'pathway',
    label: 'Pathway',
    members: [
      { id: 'kegg', label: fieldLabel('kegg') },
      { id: 'reactome', label: fieldLabel('reactome') }
    ]
  },
  {
    id: 'essentiality',
    label: 'Essentiality',
    members: [{ id: 'essentiality', label: fieldLabel('essentiality') }]
  },
  {
    id: 'interactions',
    label: 'Interactions',
    members: [{ id: 'string', label: fieldLabel('string') }]
  }
]

/** Open/close plumbing for a floating menu portalled next to a trigger button: positions it under
 *  the button (right-aligned so it never spills past the dialog), and dismisses on outside click,
 *  any scroll, resize or Escape. */
export function useFloatingMenu(
  isOpen: boolean,
  setOpen: (o: boolean) => void
): {
  btnRef: React.RefObject<HTMLElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
  rect: { right: number; top: number; width: number } | null
} {
  const [rect, setRect] = useState<{ right: number; top: number; width: number } | null>(null)
  const btnRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const b = btnRef.current?.getBoundingClientRect()
    if (b) setRect({ right: window.innerWidth - b.right, top: b.bottom + 4, width: b.width })
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    // Any scroll of what's under it dismisses (capture: an ancestor's too) — but not the menu's
    // own list scrolling.
    const onScroll = (e: Event): void => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, setOpen])
  return { btnRef, menuRef, rect }
}
