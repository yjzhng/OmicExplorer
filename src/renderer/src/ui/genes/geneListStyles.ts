/** The gene selector's list look, shared by the nav's gene menu and a tile's one-gene picker
 *  (GeneSwitch) so both read the same: the window, the search field with its magnifier, and a gene
 *  row — name, then its description muted. */
import type { CSSProperties } from 'react'

export const GENE_LIST_STYLES: Record<
  'menu' | 'searchWrap' | 'searchIcon' | 'search' | 'geneRow' | 'geneName' | 'geneDesc' | 'more',
  CSSProperties
> = {
  menu: {
    position: 'fixed',
    zIndex: 4000,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    // last resort on a very short window, once the lists have shrunk as far as they can
    overflowY: 'auto'
  },
  // The search field with its magnifier drawn inside, at the left.
  searchWrap: { position: 'relative', display: 'flex', flex: '0 0 auto' },
  searchIcon: {
    position: 'absolute',
    left: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    pointerEvents: 'none'
  },
  search: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 5,
    padding: '5px 8px',
    fontSize: 12
  },
  geneRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '3px 6px 3px 40px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer'
  },
  // Gene name is capped so a long name can't hide the description; the description fills the rest.
  geneName: {
    flex: '0 1 auto',
    maxWidth: '55%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  geneDesc: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11
  },
  more: { padding: '3px 6px 3px 40px', fontSize: 11 }
}
