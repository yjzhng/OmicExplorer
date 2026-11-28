import type { CSSProperties } from 'react'
import { UI } from '../ui/theme'
import { ROW_MENU_W } from './shared'

export const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: UI.bg,
    color: UI.text,
    fontFamily: 'system-ui, sans-serif'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto',
    position: 'sticky',
    top: 0,
    background: UI.bg,
    zIndex: 20
  },
  title: { fontSize: 16, fontWeight: 700 },
  chipIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 13,
    opacity: 0.85,
    flex: '0 0 auto'
  },
  navSpacer: { flex: 1 },

  // Vertical divider between the workflow-action buttons and the general buttons.
  navSep: { width: 1, height: 20, background: UI.border, alignSelf: 'center', flex: '0 0 auto' },
  chipGroup: {
    display: 'inline-flex',
    alignItems: 'stretch',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel
  },
  ctrlChip: {
    display: 'inline-flex',
    alignItems: 'stretch',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel
  },
  ctrlBtn: {
    background: 'transparent',
    color: UI.text,
    border: 'none',
    padding: '4px 9px',
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center'
  },
  // Faint, thin separator inset from the chip's top/bottom borders (margin keeps it
  // from touching them).
  // The layout switch's icon: one text line tall, with the side padding for a word cut back.
  // Option = 2×12 padding − 2×4 margin + 14 icon = 30 wide, by 6 padding + 15.6 line ≈ 22 tall.
  layoutIconBox: { display: 'flex', alignItems: 'center', height: '1.2em', margin: '0 -4px' },
  chipDivider: {
    width: 1,
    alignSelf: 'stretch',
    margin: '5px 0',
    background: 'rgba(128,128,128,0.22)'
  },
  chipSegWarn: { color: UI.warn },

  chipSeg: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    // Match the project chip's vertical rhythm (5px pad, 13px text) so heights line up.
    padding: '5px 11px',
    fontSize: 13,
    cursor: 'pointer',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.2
  },
  folderMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    minWidth: 260,
    maxWidth: 360,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
    padding: 4
  },
  folderRow: { display: 'flex', alignItems: 'stretch', borderRadius: 6 },
  folderPick: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '7px 10px',
    cursor: 'pointer',
    overflow: 'hidden'
  },
  folderName: { fontSize: 13, fontWeight: 600 },
  folderPath: {
    fontSize: 11,
    color: UI.textMuted,
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  rowIconBtn: {
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    padding: '0 7px',
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto'
  },
  pathWarn: { color: UI.warn },
  renameInput: {
    flex: 1,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.accent}`,
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 13,
    margin: '2px 4px'
  },
  folderAdd: {
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderTop: `1px solid ${UI.border}`,
    color: UI.text,
    padding: '9px 10px',
    marginTop: 4,
    fontSize: 13,
    cursor: 'pointer'
  },
  home: {
    flex: 1,
    minHeight: 0,
    // Fallback only: the recent-projects card takes the overflow unless the window is shorter than the
    // header plus its minimum height.
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    background: UI.bg
  },
  // Two columns: the app on the left, projects on the right. A narrow window wraps the right one
  // below (the page then scrolls as a whole — see `home`).
  homeInner: {
    width: 'min(1040px, 94vw)',
    padding: '64px 0 40px',
    boxSizing: 'border-box',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    columnGap: 56,
    rowGap: 32
  },
  homeLeft: { flex: '0 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column' },
  homeRight: {
    // wide enough for the four project buttons on one line before the columns stack
    flex: '1 1 520px',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column'
  },
  citeCard: { padding: '12px 14px' },
  citeRef: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: UI.text,
    userSelect: 'text',
    overflowWrap: 'anywhere'
  },
  citeNone: { margin: 0, fontSize: 12.5, color: UI.textMuted },
  citeFoot: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  citeCopy: { marginLeft: 'auto', flex: '0 0 auto', background: 'transparent', cursor: 'pointer' },
  citeDoi: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: UI.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  // As the app's other links (About → releases): accent, underlined.
  citeDoiLink: { color: UI.accent, textDecoration: 'underline', cursor: 'pointer' },
  // The logo spans the three text rows (title, version, links): their pinned heights sum to 100px
  // (36 + 6 + 22 + 10 + 26), so keep the logo size in step if any of them change.
  homeBrand: { display: 'flex', alignItems: 'center', gap: 20 },
  homeLogo: { width: 100, height: 100, flex: 'none', userSelect: 'none' },
  homeTitle: { fontSize: 30, lineHeight: '36px', fontWeight: 800, margin: 0 },
  homeVersion: {
    color: UI.textMuted,
    fontSize: 16,
    fontWeight: 500,
    marginTop: 6,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  homeLinks: { display: 'flex', gap: 8, marginTop: 10 },
  homeLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    lineHeight: '16px',
    fontWeight: 500,
    textDecoration: 'none'
  },
  /** the tag as a button (it starts the in-app update) */
  homeUpdateButton: { border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  homeUpdateTag: {
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    background: '#3b82f6',
    borderRadius: 999,
    padding: '2px 8px',
    textDecoration: 'none'
  },
  homeSub: { color: UI.textMuted, fontSize: 14, margin: '6px 0 20px' },
  homeActions: { display: 'flex', gap: 8, marginBottom: 12 },
  /** the four project buttons share one line: they shrink together rather than wrap, and a label
   *  that still can't fit (a very narrow window) is cut short rather than broken over two lines */
  homeAction: {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '10px 12px',
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  homePrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 8,
    padding: '11px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // Getting started: Tutorial / Documentation / Publication side by side, each its own width
  // (wrapping onto a second line in a narrow column).
  homeGuides: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  homeGuideBtn: {
    flex: '0 0 auto',
    padding: '7px 14px',
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    borderRadius: 7,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5
  },
  homeGuideOff: { opacity: 0.45, cursor: 'not-allowed' },
  homeSecondary: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: '11px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer'
  },
  recentHead: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700,
    marginTop: 24,
    marginBottom: 10
  },
  recentEmpty: { color: UI.textMuted, fontSize: 13, padding: '12px 14px' },
  saveError: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    width: 320,
    zIndex: 60,
    cursor: 'pointer',
    background: UI.panel,
    borderRadius: 6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.25)'
  },
  openError: {
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 6,
    border: `1px solid ${UI.err}`,
    background: 'rgba(225,87,89,0.12)',
    color: UI.text,
    fontSize: 12
  },
  homeCard: {
    flex: 'none',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    // The two axes apart, not the `overflow` shorthand: recentScroll swaps in overflowY, and React
    // can't add / remove a longhand over a shorthand cleanly.
    overflowX: 'hidden',
    overflowY: 'hidden'
  },
  // Sized to its rows, shrinking (and scrolling) only when the window is too short to show them all.
  // Short lists (≤ 2 rows) are already under the 120px floor, so they just keep their natural height.
  recentScroll: { flex: '0 1 auto', minHeight: 120, overflowY: 'auto' },
  recentRow: { display: 'flex', alignItems: 'stretch', gap: 4 },
  recentDivider: { borderTop: `1px solid ${UI.border}` },
  recentItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    padding: '10px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    overflow: 'hidden'
  },
  recentForget: {
    flex: '0 0 auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    padding: '0 12px',
    fontSize: 13
  },
  // A project row's hamburger (ProjectRowMenu), and its menu — the project menu's look, floated
  // over the page (the recent list scrolls, so it would clip a menu inside it).
  recentMenuBtn: {
    alignSelf: 'center',
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    marginRight: 8,
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: UI.textMuted,
    cursor: 'pointer'
  },
  recentMenuBtnOpen: { background: UI.panelAlt, color: UI.text },
  rowMenu: {
    position: 'fixed',
    width: ROW_MENU_W,
    boxSizing: 'border-box',
    // background and border colour set per theme at render (see ProjectRowMenu)
    border: '1px solid',
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflowY: 'auto',
    padding: 4
  },
  recentName: { fontSize: 14, fontWeight: 600, color: UI.text },
  recentNameLine: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  // A recent project's version tag (ProjectVersionTag): colours set per standing.
  versionTag: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: '0 6px',
    lineHeight: '16px',
    borderRadius: 8,
    border: '1px solid',
    fontVariantNumeric: 'tabular-nums'
  },
  fixWrap: { display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 1 auto', minWidth: 0 },
  fixNote: {
    fontSize: 11,
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  recentPath: {
    fontSize: 12,
    color: UI.textMuted,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  projectChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    maxWidth: 240
  },
  projectChipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
  savingIcon: { display: 'inline-flex', flex: '0 0 auto', color: UI.textMuted },
  saveAsMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    minWidth: 180,
    whiteSpace: 'nowrap',
    maxHeight: '80vh',
    overflowY: 'auto',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    padding: 4
  },
  projectMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    minWidth: 280,
    maxWidth: 380,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
    padding: 4
  },
  menuHead: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700,
    padding: '8px 10px 4px'
  },
  menuEmpty: { color: UI.textMuted, fontSize: 12, padding: '2px 10px 8px' },
  menuRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'stretch',
    borderRadius: 6
  },
  menuRowOpen: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '7px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    overflow: 'hidden'
  },
  menuName: { fontSize: 13, fontWeight: 600 },
  menuPath: {
    fontSize: 11,
    color: UI.textMuted,
    maxWidth: 340,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  menuDivider: { height: 1, background: UI.border, margin: '4px 0' },
  menuAction: {
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '9px 10px',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 6
  },
  projectName: {
    fontSize: 13,
    fontWeight: 600,
    color: UI.text,
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  saveAsWrap: { position: 'relative', display: 'inline-flex', lineHeight: 0 },
  // Pencil badge at the floppy's bottom-right corner. No box — the pencil SVG knocks out
  // only its own silhouette (see IconPencil), so the disk shows right up to the pencil.
  pencilBadge: {
    position: 'absolute',
    right: -3,
    bottom: -2,
    display: 'inline-flex',
    lineHeight: 0
  },
  newStepBtn: {
    background: UI.panel,
    color: UI.text,
    border: 'none',
    borderRadius: 18,
    padding: '9px 19px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)'
  },
  // Floating, like "+ New step", but a rounded square with a lighter shadow — it navigates away
  // rather than acting on the canvas, so it sits back a little.
  resultsLink: {
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)'
  },
  // "Cancel" state while placing — red to read as a stop/abort action.
  newStepBtnActive: {
    background: '#e15759',
    color: '#fff',
    borderColor: '#e15759'
  },
  paneMenu: {
    position: 'fixed',
    zIndex: 60,
    minWidth: 180,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    padding: 4
  },
  menuKey: { marginLeft: 16, color: UI.textMuted, fontSize: 12 },
  actBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '6px 8px',
    boxShadow: '0 6px 22px rgba(0,0,0,0.45)'
  },
  actCount: {
    fontSize: 11,
    fontWeight: 700,
    color: UI.textMuted,
    padding: '0 6px',
    // "5 selected" on one line, never squeezed by the buttons beside it
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  actBtn: {
    whiteSpace: 'nowrap',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 700
  },
  // Just done: the accent, with its tick.
  actBtnDone: {
    color: UI.accent,
    borderColor: `color-mix(in srgb, ${UI.accent} 60%, transparent)`,
    background: `color-mix(in srgb, ${UI.accent} 14%, ${UI.panelAlt})`
  },
  // The theme's error red, so Delete reads in light mode too (a fixed pale pink vanished there).
  actBtnDanger: { color: UI.err, borderColor: `color-mix(in srgb, ${UI.err} 55%, transparent)` },
  ghost: {
    position: 'fixed',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: 30,
    minWidth: 130,
    textAlign: 'center',
    background: UI.panelRaised,
    color: UI.textMuted,
    border: `1px dashed ${UI.accent}`,
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 600,
    opacity: 0.9
  },
  navBtn: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    width: 30,
    height: 30,
    fontSize: 14,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scrim: { position: 'fixed', inset: 0, zIndex: 40 },
  // Settings dialog (centred modal) + its dark scrim.
  dialogScrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 },
  settingsModal: {
    // Centred by its margins, not translate(-50%, -50%): a transform can leave the window on half a
    // pixel (88vh is rarely whole), and on a 1× screen everything drawn in its own layer there — a
    // pane scrolling a sticky table header — goes blurry. Layout positions snap to whole pixels.
    position: 'fixed',
    inset: 0,
    margin: 'auto',
    // Roomy enough for the widest pane — Plots holds a whole tile config panel (group table,
    // highlight blocks, axes), which was cramped in the old 540×380 card.
    width: 760,
    maxWidth: '94vw',
    height: 620,
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 61,
    overflow: 'hidden'
  },
  settingsModalHead: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    flex: '0 0 auto'
  },
  settingsModalTitle: { fontWeight: 700, fontSize: 14, color: UI.text },
  settingsClose: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1
  },
  settingsBody: { display: 'flex', flex: 1, minHeight: 0 },
  settingsNav: {
    flex: '0 0 160px',
    borderRight: `1px solid ${UI.border}`,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'auto',
    background: UI.panelAlt
  },
  settingsNavItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    textAlign: 'left',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  settingsNavDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#3b82f6',
    flex: '0 0 auto'
  },
  settingsContent: { flex: 1, minWidth: 0, overflow: 'auto', padding: '16px 20px' },
  settingsContentTitle: { margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: UI.text },
  settingsSection: { padding: 12 },
  settingsLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted,
    marginBottom: 8,
    fontWeight: 700
  },
  settingsHint: { marginTop: 8, fontSize: 11, color: UI.textMuted },
  // two fields side by side (Export: format, then resolution), wrapping when narrow
  settingsInline: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 24 },
  settingsSubTitle: { fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 10 },
  // Settings › Customisation › Palettes: a role's name (and its (i)) left of its selector.
  // Top-aligned (a builder runs several lines), the label nudged down to a selector's text line.
  paletteRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  paletteRowLabel: {
    fontSize: 12,
    color: UI.textMuted,
    width: 160,
    flex: '0 0 160px',
    paddingTop: 5
  },
  // Settings › Appearance › Accent colour: a swatch per choice, the chosen one ringed in its colour.
  accentRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  accentSwatch: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px 4px 6px',
    borderRadius: 999,
    border: `1px solid ${UI.border}`,
    background: 'transparent',
    color: UI.text,
    cursor: 'pointer',
    outlineOffset: 1
  },
  accentDot: { width: 14, height: 14, borderRadius: '50%', flex: 'none' },
  accentLabel: { fontSize: 12 },
  // Settings › Appearance › Layout: two large side-by-side choices, glyph over name over description.
  layoutTiles: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  layoutTile: {
    flex: '1 1 180px',
    maxWidth: 240,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '18px 14px 14px',
    borderRadius: 10,
    color: UI.text,
    cursor: 'pointer',
    textAlign: 'center'
  },
  layoutTileTitle: { fontSize: 13, fontWeight: 700 },
  layoutTileText: { fontSize: 11, color: UI.textMuted, lineHeight: 1.4 },
  /** the plot-defaults block: its type picker, and the tile config panel under it */
  // Plot defaults: a section (a rule above it), and its options as rows — the name in a fixed
  // column on the left, the control on the right.
  defaultsSection: { borderTop: `1px solid ${UI.border}`, marginTop: 18, paddingTop: 16 },
  settingRowControl: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 6
  },
  defaultsPick: { width: '100%', maxWidth: 320, display: 'flex' },
  defaultsSelect: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 8px',
    fontSize: 12
  },
  defaultsReset: {
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    padding: 0,
    fontSize: 11,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  // The plot order: a column of draggable rows.
  defaultOrder: { width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 4 },
  defaultOrderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 8px',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panelAlt,
    fontSize: 12,
    cursor: 'grab',
    userSelect: 'none'
  },
  defaultOrderGrip: { color: UI.textMuted, fontSize: 12 },
  defaultOrderNum: { color: UI.textMuted, fontSize: 11, minWidth: 12, textAlign: 'right' },
  defaultsPanel: {
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 8
  },
  settingsFieldLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    marginBottom: 6
  },
  // Settings › About › Updates: the Check now button and what it found, in a line
  updateActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  updateButton: {
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  aboutMuted: { fontSize: 12, color: UI.textMuted },
  /** Update now / Restart to update */
  updatePrimary: {
    background: UI.accent,
    border: 'none',
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    cursor: 'pointer',
    marginLeft: 6
  },
  /** the download's progress */
  updateBar: {
    display: 'inline-block',
    width: 120,
    height: 6,
    borderRadius: 3,
    background: UI.border,
    overflow: 'hidden'
  },
  updateBarFill: { display: 'block', height: '100%', background: UI.accent },
  aboutUpdate: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: UI.text
  },
  aboutDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#3b82f6',
    flex: '0 0 auto'
  },
  // inline with the update row's text (no offset of its own, so it sits on the same line)
  aboutLink: {
    display: 'inline-block',
    fontSize: 12,
    color: UI.accent,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  silenceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTop: `1px solid ${UI.border}`,
    fontSize: 12,
    color: UI.textMuted,
    cursor: 'pointer'
  },
  // Blue notification dot on the settings gear when an update is available.
  navDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3b82f6',
    border: `2px solid ${UI.panel}`
  },
  canvasArea: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    borderTop: `1px solid ${UI.border}`
  },
  // The flow layout's page area: the two pages overlap here, each sliding in or out (FlowViews).
  viewStage: { position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' },
  viewPage: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' },
  // Results dashboard fill.
  resultsArea: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    borderTop: `1px solid ${UI.border}`
  },
  canvas: { flex: 1, minWidth: 0, minHeight: 0 },
  // Centred empty-canvas prompt. The wrapper ignores pointer events (so the pane stays clickable);
  // only the button re-enables them.
  // Empty-workflow hint: anchored bottom-centre, just above the "+ New step" button, so its ↓ arrow
  // points down to it.
  stepHint: {
    position: 'absolute',
    bottom: 58,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    textAlign: 'center',
    maxWidth: 300,
    pointerEvents: 'none',
    zIndex: 5
  },
  stepHintArrow: { fontSize: 20, lineHeight: 1, color: UI.accent, fontWeight: 700 },
  // Data-folder hint: in-canvas (like the empty-workflow guide) but anchored top-left so its ↑
  // arrow points up toward the folder selector in the top bar, rather than sitting centred.
  // Box centred on the chip's centre x (left = that x, translateX(-50%)), content centred like the
  // new-step guide, so the ↑ arrow and text sit under the middle of the folder selector.
  folderHint: {
    position: 'absolute',
    top: 14,
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
    width: 240,
    pointerEvents: 'none',
    zIndex: 5
  },
  folderHintArrow: { fontSize: 20, lineHeight: 1, color: UI.accent, fontWeight: 700 },
  emptyTitle: { fontSize: 15, fontWeight: 700, color: UI.text },
  emptyText: { fontSize: 12, color: UI.textMuted, maxWidth: 260, lineHeight: 1.5 },
  emptyBtn: {
    marginTop: 4,
    pointerEvents: 'auto',
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
