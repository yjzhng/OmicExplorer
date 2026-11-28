/** The interactive import's styles. */
import type { CSSProperties } from 'react'
import { motion, UI } from '../../../ui/app/theme'
import { TABLE } from '../../../ui/table/tableStyles'
import { MONO } from './fields'

export const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60
  },
  scrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' },
  modal: {
    position: 'relative',
    width: 1040,
    maxWidth: '94vw',
    // One size for every step (the step's own content scrolls inside), so it doesn't jump.
    height: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 1,
    overflow: 'hidden'
  },
  head: {
    padding: '10px 12px 10px 16px',
    fontWeight: 700,
    fontSize: 14,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  // Roadmap stepper bar under the header: numbered stage pills + labels, joined by connectors.
  roadmap: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    padding: '12px 20px',
    background: UI.panelAlt,
    borderBottom: `1px solid ${UI.border}`
  },
  roadStep: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    flex: '0 0 auto'
  },
  roadDot: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: '2px solid',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1
  },
  roadLabel: { fontSize: 11, letterSpacing: 0.2, whiteSpace: 'nowrap' },
  // Connector between two stage pills — vertically centred on the 26px dot row.
  roadLine: { flex: 1, height: 2, marginTop: 13, borderRadius: 1, minWidth: 16 },
  closeBtn: {
    flex: '0 0 auto',
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    borderRadius: 5,
    fontSize: 14,
    cursor: 'pointer'
  },
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflow: 'auto',
    // A step swiping in never scrolls it sideways (each step's wide tables scroll in their own box).
    overflowX: 'hidden',
    flex: 1,
    minHeight: 0
  },
  // One step's content, filling the body (laid out as the body was before it was wrapped).
  stepPane: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 },
  foot: {
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTop: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 11, color: UI.textMuted, width: 54, flex: '0 0 54px' },
  select: {
    flex: 1,
    minWidth: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '5px 8px',
    fontSize: 12
  },
  hint: { color: UI.textMuted, fontSize: 12, lineHeight: 1.45 },
  chips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chipsLabel: { fontSize: 12, fontWeight: 600, color: UI.textMuted, marginRight: 2 },
  condList: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
  condToggle: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 },
  typeChip: {
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '14px',
    padding: '1px 6px',
    borderRadius: 9,
    border: `1px solid ${UI.border}`,
    color: UI.textMuted,
    whiteSpace: 'nowrap'
  },
  typeChipBtn: { background: 'transparent', cursor: 'pointer', color: UI.text },
  // The left panel's Set units section: one row per numeric condition that's on, its name then
  // its unit chip.
  unitBlock: { display: 'flex', flexDirection: 'column', gap: 6 },
  // The left column's two sections: the switches over its top 55%, Set unit the bottom 45% —
  // each scrolling on its own if it runs over.
  switchSec: {
    flex: '11 1 0',
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  unitSec: { flex: '9 1 0', minHeight: 0, overflow: 'auto' },
  // A scroll box's last 28px fading out, while there's more below.
  listFadeBottom: {
    maskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)',
    WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 28px), transparent)'
  },
  unitRow: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 },
  unitName: { minWidth: 40 },
  // "(i) Select unit:" and its chip, close together.
  unitPick: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  // A condition that takes no unit: shown for completeness, faded.
  unitRowNA: { opacity: 0.4, color: UI.textMuted },
  unitNA: { fontSize: 12, fontStyle: 'italic' },
  // "Separator [_]" at the right of the Sample names heading.
  sepLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted
  },
  sepSelect: { display: 'inline-flex' },
  // The custom separator's box: quote, the text, quote — styled as one text box, the quotes inside.
  // The quote marks around the separator: fainter than it, so they read as framing, not text.
  sepQuote: { opacity: 0.45 },
  sepQuoted: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 6px',
    fontFamily: MONO,
    fontSize: 12,
    color: UI.textMuted,
    background: UI.panelRaised,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    cursor: 'text'
  },
  // The text inside sepQuoted: bare, as wide as what's typed, so the quotes sit right against it.
  sepInput: {
    padding: 0,
    margin: 0,
    fontSize: 12,
    fontFamily: MONO,
    color: UI.text,
    background: 'transparent',
    border: 'none',
    outline: 'none'
  },
  // The Conditions step's deck of panels (see ConditionsStage), each scrolling on its own.
  // Clipped (with room for the cards' edge), so a card's animation never spills past the deck.
  condPanels: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    containerType: 'inline-size',
    overflow: 'clip',
    overflowClipMargin: 4
  },
  condPanel: {
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '10px 12px 12px',
    border: `1px solid ${UI.border}`,
    borderRadius: 8
  },
  // The conditions card: the switches in a column of their own (scrolling in it), the map beside
  // them (its names table fills it and scrolls inside, so the column doesn't).
  condSplit: { flex: 1, minHeight: 0, display: 'flex', gap: 14 },
  condSplitLeft: {
    flex: '0 0 230px',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingRight: 14,
    borderRight: `1px solid ${UI.border}`
  },
  mapHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sheetBtn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 10px',
    fontSize: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  sheetBar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  sheetTh: { cursor: 'pointer', userSelect: 'none' },
  // A painted samplesheet column's bar, along its header's foot.
  sheetBar3: { position: 'absolute', left: 4, right: 4, bottom: 0, height: 3, borderRadius: 2 },
  sheetMissing: { color: UI.textMuted, fontStyle: 'italic' },
  sheetUnpin: {
    marginLeft: 6,
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    padding: 0,
    fontSize: 12
  },
  condSplitRight: {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  // A card of the deck: 90% of the width, full height, at its own fixed offset and pose (inline).
  deckCard: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '90%',
    display: 'flex',
    borderRadius: 8,
    background: UI.panel,
    // A faint edge and a soft lift, just enough to tell the overlapping cards apart.
    boxShadow: `0 0 0 1px color-mix(in srgb, ${UI.border} 60%, transparent), 0 2px 8px rgba(0, 0, 0, 0.08)`,
    transition: `${motion('transform', 'page', 'enter')}, ${motion('background', 'page')}`
  },
  // No outline: the veil over the others is what marks the card in use.
  deckFace: {
    flex: 1,
    overflow: 'hidden',
    border: 'none',
    transition: motion('opacity, filter', 'page')
  },
  // A chevron floating over the parked card's strip (faint; see .oe-deck-next), turning to it:
  // on the first card it's the step's Next, on the second it goes back. The strip around it still picks the card as well.
  deckNextWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '10cqw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    pointerEvents: 'none'
  },
  deckNext: {
    pointerEvents: 'auto',
    display: 'flex',
    padding: 8,
    color: UI.text,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer'
  },
  // A card not in use is greyed all over: its colours drained and faded onto a grey card.
  deckFaceAway: { opacity: 0.4, filter: 'grayscale(1)' },
  deckCardAway: { background: UI.panelAlt },
  // Over a card not in use: picks it (its content beneath is inert and greyed, see deckFaceAway).
  deckPick: {
    position: 'absolute',
    inset: 0,
    padding: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    font: 'inherit',
    cursor: 'pointer'
  },
  condNum: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    marginRight: 6,
    borderRadius: 8,
    fontSize: 10,
    background: UI.border,
    color: UI.text,
    transition: motion('background, color', 'hover')
  },
  condNumOn: { background: UI.accent, color: UI.accentText },
  // A card's title: a little more room under it than a section heading gets.
  cardHead: { marginBottom: 6 },
  panelHead: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  // The samplesheet's rename bar (RenameBar).
  // A control strip like the dashboard's switch bars: one tinted, bordered row of labelled controls.
  renameBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '6px 10px',
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  // Labels as the switch bars label theirs (small caps, muted).
  renameLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  renameArrow: { fontSize: 12, color: UI.textMuted },
  // A fixed-width slot for the app's Select (which fills its container).
  // A condition option: its colour dot, then its name.
  renameFieldOpt: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  // Width set per select, to fit its longest option (selectWidthFor).
  renameSelect: { display: 'inline-flex', flex: '0 0 auto' },
  renameInput: {
    width: 140,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 8px',
    fontSize: 12
  },
  renameBtn: { padding: '4px 12px' },
  renameEnd: { display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  renameCount: { fontSize: 11, color: UI.textMuted, fontVariantNumeric: 'tabular-nums' },

  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  chipDot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  // The "custom" row while naming (NewConditionRow): the input where its label was, error beside it.
  addCondBox: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  addCondInput: {
    width: 96,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px dashed ${UI.accent}`,
    borderRadius: 12,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    outline: 'none'
  },
  addCondErr: { fontSize: 11, color: UI.err },
  // ── Filtering stage ──
  // the Filtering step: its filter cards and row count, scrolling once they'd squeeze the preview
  filterList: {
    flex: '0 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  // …and the preview table below, filling the rest of the pane (never under 180 px)
  filterPreview: { flex: 1, minHeight: 180, display: 'flex', flexDirection: 'column' },
  filterStats: {
    fontSize: 13,
    color: UI.text,
    fontVariantNumeric: 'tabular-nums',
    paddingTop: 4
  },
  removingNum: { color: '#e15759' },
  // Red-tinted background marking a dropped row in the data table.
  removedRow: { background: 'rgba(225,87,89,0.18)' },
  filterCard: {
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: UI.panelAlt
  },
  // Inactive filter tile: greyed out until its checkbox is ticked (the default).
  filterCardOff: { opacity: 0.55 },
  offText: { color: UI.textMuted },
  // Controls in an inactive tile: dimmed and inert (the checkbox stays clickable).
  controlsOff: { opacity: 0.5, pointerEvents: 'none' },
  filterHead: { display: 'flex', alignItems: 'center', gap: 8 },
  filterName: { fontSize: 13, fontWeight: 700, color: UI.text, fontFamily: MONO },
  filterMeta: { fontSize: 11, color: UI.textMuted },
  // Filter control cluster, pushed to the right end of the tile (wraps right-aligned if long).
  filterControls: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8
  },
  // Apply / Reset row beneath the filter cards.
  filterActions: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 },
  filterDirty: { fontSize: 11, color: UI.warn, fontStyle: 'italic' },
  // Reason the Next button is disabled, shown just to its left.
  nextBlock: {
    fontSize: 11,
    color: UI.warn,
    alignSelf: 'center',
    textAlign: 'right',
    maxWidth: 320
  },
  stageTitle: { fontSize: 15, fontWeight: 700, color: UI.text, marginBottom: 2 },
  filterTools: { display: 'flex', gap: 10 },
  filterLink: {
    background: 'transparent',
    color: UI.accent,
    border: 'none',
    padding: 0,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // "all ☐" select-all control in the sample-name table's header cell.
  allCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    color: UI.textMuted,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  // Compact "invert" button in the sample-name table's header cell, on top of the select-all box.
  // The Map conditions chips + names table, with the connector overlay drawn over both.
  mapArea: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  connectors: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 6
  },
  // The names table's select-all checkbox with the (square) invert button to its right.
  selectTools: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  invertLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    width: 18,
    height: 18,
    padding: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    boxSizing: 'border-box',
    cursor: 'pointer'
  },
  valueChip: {
    border: '1px solid',
    borderRadius: 12,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontVariantNumeric: 'tabular-nums'
  },
  // Categorical filter: a select-style button that opens an in-card multiselect list.
  dropdownBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 120,
    justifyContent: 'space-between',
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  dropdownCaret: { fontSize: 8, color: UI.textMuted },
  // Floating menu portalled to <body>, positioned just below the button (fixed, so the modal's
  // scroll area can't clip it).
  dropdownMenu: {
    position: 'fixed',
    zIndex: 9999,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
  },
  dropdownTools: { display: 'flex', gap: 12 },
  dropdownList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 200,
    overflow: 'auto'
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer',
    padding: '2px 4px',
    fontVariantNumeric: 'tabular-nums'
  },
  dropdownItemOff: { color: UI.textMuted, textDecoration: 'line-through' },
  // Bounded scroll box for the data table (removed rows on top). Scrolls both axes so the full
  // set of columns is reachable without stretching the modal.
  // The unit chip: small and quiet beside a condition's name; muted italic while unset (a.u.).
  unitChip: {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: 4,
    padding: '0 6px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 8,
    background: 'transparent',
    color: UI.text,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '15px',
    letterSpacing: 0,
    textTransform: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  unitChipUnset: { color: UI.textMuted, fontStyle: 'italic', fontWeight: 500 },
  unitMenu: { padding: 4, gap: 0, minWidth: 96 },
  unitInput: {
    fontSize: 12,
    padding: '3px 6px',
    margin: '0 0 4px',
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    background: 'transparent',
    color: UI.text,
    width: 96
  },
  unitItem: {
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: UI.text,
    fontSize: 12,
    textAlign: 'left',
    padding: '3px 8px',
    cursor: 'pointer'
  },
  unitItemOn: { background: UI.border, fontWeight: 700 },
  numRow: { display: 'flex', gap: 14 },
  numLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted
  },
  numInput: {
    width: 100,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 22px 4px 8px',
    fontSize: 12
  },
  // A bound's ▲ ▼, inside the box's right edge.
  stepWrap: { position: 'relative', display: 'inline-flex' },
  stepBtns: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    right: 2,
    display: 'flex',
    flexDirection: 'column'
  },
  stepBtn: {
    flex: 1,
    width: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    borderRadius: 3,
    background: 'transparent',
    color: UI.textMuted,
    cursor: 'pointer'
  },

  // Chip-style select for swapping the source data file inside the wizard.
  // The Columns step's data-file dropdown (the app's Select fills this slot).
  // The data-file list's "Generated files" heading (an unselectable option).
  fileGroupHead: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted
  },
  // A data file's folder, before its name in the data-file list.
  // Fainter than muted text, so the file name leads (opacity, so it also fades on a highlighted row).
  fileDir: { color: UI.textMuted, opacity: 0.6 },
  fileSelect: { display: 'inline-flex', flex: '0 1 360px', minWidth: 160 },
  chipCount: {
    marginLeft: 2,
    fontSize: 10,
    fontWeight: 700,
    opacity: 0.75,
    fontVariantNumeric: 'tabular-nums'
  },
  // Clickable column header for the step-1 classifier: centred, with the role label stacked above
  // the column name (like the ruler labels over the condition step).
  colHead: {
    textAlign: 'center',
    // Name centres vertically in the cell; the field label is lifted out of flow (below) and
    // pinned to the top, with the top padding reserving its row. NB: no `position` here — that
    // would override the sticky header's `position: sticky` and break stickiness.
    verticalAlign: 'middle',
    padding: '17px 10px 6px',
    userSelect: 'none',
    // Wide enough to fit the widest role label (METADATA), since the label is out of flow and so
    // doesn't push the fit-to-content width of a short-named column.
    minWidth: 82,
    maxWidth: 200
  },
  // Absolutely pinned to the top of the header cell (the sticky `th` is its containing block), so
  // labels line up along one row regardless of how tall each header wraps. Inert to the pointer so
  // it never blocks the header click/drag.
  colRole: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.3,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    pointerEvents: 'none'
  },
  // Wrap long headers (e.g. run file paths), breaking unbroken strings so a long path folds
  // in-column; centred horizontally (vertical centring comes from the cell's middle alignment).
  colName: {
    color: UI.text,
    fontSize: 12,
    fontFamily: MONO,
    textAlign: 'center',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word'
  },
  nameTable: {
    borderCollapse: 'collapse',
    width: 'max-content',
    minWidth: '100%',
    fontFamily: MONO,
    fontSize: 12
  },
  // Label strip above the table; same left padding + monospace as the rows so the hidden text
  // reserves matching widths and the centred labels line up with the first row's substrings.
  rulerCell: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    // Little headroom: the Map conditions connectors curve down through the gap above the table and
    // this row's (hidden) text, ending just over the first row.
    padding: '4px 10px 2px',
    whiteSpace: 'nowrap',
    background: UI.panel,
    borderBottom: `1px solid ${UI.border}`
  },
  nameCell: { padding: '3px 10px', whiteSpace: 'nowrap', borderBottom: `1px solid ${UI.border}` },
  // Narrow leading column holding each row's active-checkbox (content-sized).
  // Left-aligned (not centred), so each row's checkbox sits under the header's select-all — which
  // shares its cell with the invert button.
  // Every row / select-all checkbox in the Conditions step's tables: the same look (accent tick)
  // and no browser margin, so they line up.
  rowCheck: { accentColor: UI.accent, cursor: 'pointer', margin: 0, verticalAlign: 'middle' },
  checkCell: {
    width: 1,
    padding: '3px 6px 3px 4px',
    textAlign: 'left',
    verticalAlign: 'middle',
    borderBottom: `1px solid ${UI.border}`
  },
  // Header cell for the select-all checkbox: sticky like the ruler, checkbox at the bottom so it
  // sits by the sample-name baseline rather than up in the angled-label headroom.
  rulerCheckCell: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: UI.panel,
    verticalAlign: 'bottom',
    paddingBottom: 3
  },
  // Active sample row: light/raised; tokens are clicked to tag (not text-selected).
  teachCell: { userSelect: 'none', background: UI.panelRaised },
  // Whole row is a click target (toggles active) — pointer everywhere but the paintable tokens.
  sampleRow: { cursor: 'pointer' },
  // Hovered-row tint: a translucent wash layered over whichever base background the cell has, so
  // it reads in both themes without a per-theme colour.
  hoverCell: { backgroundImage: 'linear-gradient(rgba(128,128,128,0.14), rgba(128,128,128,0.14))' },
  // Inactive row: greyed background + muted text, non-editable — shows its faint existing tags only.
  dimCell: { userSelect: 'none', background: UI.panelAlt, color: UI.textMuted },
  confirm: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  tableTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  annPanel: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    padding: '8px 10px',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panelAlt
  },
  annTitle: { fontSize: 12, fontWeight: 700, color: UI.text, flex: '0 0 auto' },
  annFields: { display: 'inline-flex', flexWrap: 'wrap', gap: 10 },
  // Fetch / Re-fetch on a row of their own, below the options.
  annActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    flex: '1 1 100%'
  },
  // One annotation category chip: [☐ Label n/m ▾] — the box picks the whole category, the label
  // opens its member list.
  annCatBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px 3px 6px',
    fontSize: 12,
    fontWeight: 600,
    userSelect: 'none'
  },
  annCatLabel: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  annCatCount: { fontSize: 10, fontWeight: 500, color: UI.textMuted },
  annSoon: { marginLeft: 'auto', fontSize: 10, color: UI.textMuted, fontStyle: 'italic' },
  // beside the buttons, taking the rest of the row and wrapping within it
  annNote: { flex: '1 1 0', minWidth: 0, marginTop: 0 },
  dbSearchToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  // the shared table cells (ui/table/ScrollFade)
  grid: TABLE.grid,
  th: TABLE.th,
  td: TABLE.td,
  // Fit to content by default; when a column is narrowed the sample name clips with an ellipsis.
  sampleCell: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  clip: TABLE.clip,
  // Drag handle on a header's right edge to resize its column: a wide invisible hit area with a
  // visible 2px grip line centred on the column boundary.
  resizer: {
    position: 'absolute',
    top: 0,
    right: -5,
    width: 10,
    height: '100%',
    cursor: 'col-resize',
    userSelect: 'none',
    zIndex: 1,
    background: `linear-gradient(to right, transparent 4.5px, ${UI.border} 4.5px, ${UI.border} 5.5px, transparent 5.5px)`
  },
  cellWithUnit: { display: 'flex', alignItems: 'center', gap: 4 },
  condName: { display: 'inline-flex', alignItems: 'center' },
  // A condition's header: its cat / num chip above its name.
  headStack: { display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 },
  // The empty column for adding a condition: dashed, faint, its name box in the header.
  addColHead: { verticalAlign: 'bottom', borderLeft: `1px dashed ${UI.border}` },
  addColCell: { borderLeft: `1px dashed ${UI.border}`, background: 'transparent' },
  addColInput: {
    width: '100%',
    boxSizing: 'border-box',
    fontSize: 12,
    padding: '3px 6px',
    border: `1px dashed ${UI.border}`,
    borderRadius: 4,
    background: 'transparent',
    color: UI.text
  },
  addColErr: { display: 'block', fontSize: 11, fontWeight: 400, color: UI.err, marginTop: 2 },
  // The Columns step's "Set column type" label, left of the type chips.
  paintLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted,
    marginRight: 2
  },
  // A bare text button (the "+ condition" column header).
  colToggle: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'inherit'
  },
  cellUnit: { flex: '0 0 auto', fontSize: 11, color: UI.textMuted, whiteSpace: 'nowrap' },
  // MatchInput: its wrapper, the mirror over the input, and a found range's highlight.
  matchWrap: { position: 'relative', display: 'inline-flex' },
  matchMirror: {
    position: 'absolute',
    inset: 0,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    borderStyle: 'solid',
    borderColor: 'transparent',
    whiteSpace: 'pre',
    overflow: 'hidden',
    color: 'transparent',
    pointerEvents: 'none'
  },
  matchMark: {
    background: `color-mix(in srgb, ${UI.warn} 45%, transparent)`,
    color: 'transparent',
    borderRadius: 2
  },
  cellMatched: { background: `color-mix(in srgb, ${UI.warn} 35%, ${UI.panel})` },
  cellInput: {
    boxSizing: 'border-box',
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 3,
    padding: '3px 5px',
    fontSize: 12
  },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
