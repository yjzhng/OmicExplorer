/** The gene menu's styles (see GeneSelectMenu), and the one hover rule inline styles can't express. */
import type { CSSProperties } from 'react'

import { UI } from '../app/theme'
import { GENE_LIST_STYLES } from './geneListStyles'

// A geneset row's edit/delete actions are hover-revealed, which needs a :hover rule (inline styles
// can't). Injected once. Using display (not opacity) so hidden actions consume NO width — the
// geneset name then gets the full row width when the row isn't hovered (no premature truncation).
export function ensureMenuCss(): void {
  if (typeof document === 'undefined') return
  // (rewritten when present, so a reload of this module brings its rules up to date)
  let el = document.getElementById('oe-gs-css')
  if (!el) {
    el = document.createElement('style')
    el.id = 'oe-gs-css'
    document.head.appendChild(el)
  }
  el.textContent =
    '.oe-gs-row .oe-gs-actions{display:none}' +
    '.oe-gs-row:hover .oe-gs-actions{display:inline-flex;align-items:center;gap:1px}'
  // The action-name tooltip is portal-rendered (see ActionTip) so the scroll container can't crop it.
}

const headBtn: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left'
}

export const styles: Record<string, CSSProperties> = {
  // The trigger's named-selection label: the name ellipsizes, the count always shows.
  triggerName: { display: 'inline-flex', alignItems: 'baseline', gap: 4, minWidth: 0 },
  triggerNameText: {
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  triggerCount: { color: UI.textMuted, fontWeight: 500, flex: '0 0 auto' },
  triggerClear: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 18,
    padding: '0 7px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    color: UI.textMuted,
    background: UI.panelAlt,
    cursor: 'pointer'
  },
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    // Pill: fully rounded ends, with a little more side padding so the text clears the curve.
    padding: '0 14px',
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    background: 'transparent',
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    // (the nudge ring is laid over it)
    position: 'relative'
  },
  // the nudge: the pill's own shape, laid over it (inside its border)
  // (at rest unseen; the nudge fades it in — app.css oe-cue)
  triggerNudge: {
    position: 'absolute',
    inset: 0,
    borderRadius: 999,
    pointerEvents: 'none',
    opacity: 0
  },
  menu: GENE_LIST_STYLES.menu,
  searchWrap: GENE_LIST_STYLES.searchWrap,
  searchIcon: GENE_LIST_STYLES.searchIcon,
  search: GENE_LIST_STYLES.search,
  gsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    paddingBottom: 4,
    borderBottom: '1px solid transparent'
  },
  gsHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 26,
    padding: '2px 4px'
  },
  // The heading's right end: Clear selection, then the union / intersection switch.
  gsHeadEnd: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  combineBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    background: 'transparent',
    border: '1px solid',
    borderRadius: 5,
    padding: '1px 6px 1px 4px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // A heading sitting right on the switch below it: no row height, and the menu's 6px gap pulled in.
  browseHead: { display: 'flex', alignItems: 'center', padding: '4px 4px 0', marginBottom: -4 },
  gsTitle: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 },
  // The "+ New geneset" placeholder: a dashed row the size of a geneset row, ending the list.
  gsPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 2,
    padding: '3px 6px',
    borderRadius: 4,
    background: 'transparent',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // One box for the list's last row in every state — "+ New gene group" or the new group's name
  // row — so switching between them doesn't nudge anything: a group row's height (20px content +
  // 1px padding each side), 2px below the row above. Never squeezed by the scrolling list.
  gsFoot: { height: 22, marginTop: 2, boxSizing: 'border-box', flexShrink: 0 },
  gsRow: { display: 'flex', alignItems: 'center', gap: 4, padding: '1px 4px', borderRadius: 4 },
  gsEye: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 20,
    height: 20,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0
  },
  gsLoad: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: '3px 2px',
    textAlign: 'left',
    fontSize: 12
  },
  gsCount: { flex: '0 0 auto', fontSize: 10, fontWeight: 600 },
  // display is controlled by the injected hover CSS (oe-gs-actions) — do NOT set it inline, or the
  // inline value would override the CSS `display:none` and the actions would always take up width.
  gsActions: { gap: 1, flex: '0 0 auto' },
  // Scrollable geneset list: ~8 rows tall, then scrolls (rows are ~24px each).
  // the pinned Current selection's expanded genes: a few rows, then they scroll
  gsSelMembers: { maxHeight: 120, overflowY: 'auto', flexShrink: 0 },
  gsList: {
    maxHeight: 192,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
  /** the geneset colour swatch (a small circle the colour input hides behind) */
  // The legend's colour chip (NodeConfigPanel's swatch), at a geneset row's scale.
  gsSwatch: {
    flex: '0 0 auto',
    width: 16,
    height: 13,
    padding: 0,
    borderRadius: 3,
    boxSizing: 'border-box',
    cursor: 'pointer'
  },

  gsCaret: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 16,
    height: 20,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0
  },
  gsMembers: { display: 'flex', flexDirection: 'column', paddingBottom: 2 },
  /** a windowed list's rows (ui/table/VirtualRows), stacked */
  rows: { display: 'flex', flexDirection: 'column' },
  gsMemberRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '2px 6px 2px 34px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer'
  },
  // Square icon button for the per-row actions (rename / add / rewrite / delete).
  gsAct: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 18,
    height: 20,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1
  },
  // The name field while renaming in the row: the name button's footprint, so the row keeps its height.
  gsRenameInput: {
    flex: 1,
    minWidth: 0,
    boxSizing: 'border-box',
    // the row's own height (its icons are 20px, the name button ~21px): any taller pushes it
    height: 20,
    borderRadius: 4,
    padding: '0 6px',
    margin: 0,
    fontSize: 12
  },
  gsRenameActs: { display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' },
  gsEmpty: { fontSize: 11, padding: '2px 6px 4px' },
  // The active tab's own choice (Pathway: which term set), one line under the tab bar.
  variantRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '0 2px' },
  variantSelect: { flex: 1, minWidth: 0, display: 'flex' },
  // "View by" / "Group by": one width, so the switch and the dropdown line up.
  rowLabel: { flex: '0 0 48px', whiteSpace: 'nowrap' },

  // The editing set's row badge — always visible, unlike the hover-only actions.
  // Rename / Delete while a group is being edited.
  gsActOff: { opacity: 0.35, cursor: 'not-allowed' },
  editBadge: {
    flex: '0 0 auto',
    border: 'none',
    borderRadius: 999,
    padding: '1px 7px',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    cursor: 'pointer'
  },

  // Shrinks first (flexShrink above the genesets list's) when the menu meets the window's bottom.
  list: {
    maxHeight: 380,
    flexShrink: 4,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
  catHead: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px 2px' },
  pathHead: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 2px 18px' },
  headBtn: { ...headBtn, fontSize: 11 },
  box: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 15,
    height: 15,
    borderRadius: 4,
    fontSize: 10,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0
  },
  chip: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 22,
    height: 14,
    padding: '0 4px',
    borderRadius: 7,
    fontSize: 9,
    fontWeight: 700,
    lineHeight: 1
  },
  geneRow: GENE_LIST_STYLES.geneRow,
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  geneName: GENE_LIST_STYLES.geneName,
  geneDesc: GENE_LIST_STYLES.geneDesc,
  more: GENE_LIST_STYLES.more,
  // Search results, between the search box and the tabs: their own scroll, shrinking with the
  // menu like the lists.
  results: {
    maxHeight: 280,
    flexShrink: 4,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    borderBottom: '1px solid',
    paddingBottom: 4
  },

  // A search result section's heading (Genes / Pathways & categories).
  resultHead: {
    padding: '6px 6px 2px',
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  // The editing mode's confirm, across the foot of the window.
  confirm: {
    border: 'none',
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  clear: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 11,
    padding: '0 2px',
    textDecoration: 'underline'
  }
}
