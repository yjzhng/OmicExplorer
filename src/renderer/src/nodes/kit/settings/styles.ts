import type { CSSProperties } from 'react'
import { FORM } from '../../../ui/formStyles'
import { motion, UI } from '../../../ui/theme'
import { PANEL_WIDTH, PREVIEW_H } from './layout'

export const styles: Record<string, CSSProperties> = {
  // Header-slot variant of configBtn: content-sized, sits right of the section title.
  configBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 5,
    padding: '4px 11px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  // Whole shorthands, so nothing is left behind when the button re-enables.
  configBtnOff: {
    background: UI.panelAlt,
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    cursor: 'not-allowed'
  },
  panel: {
    width: PANEL_WIDTH,
    maxHeight: '58vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
    minHeight: 0,
    overflow: 'hidden',
    textAlign: 'left'
  },
  panelEmbedded: {
    width: '100%',
    maxHeight: 'none',
    boxShadow: 'none'
  },
  head: {
    padding: '10px 14px',
    borderTop: '3px solid',
    borderBottom: `1px solid ${UI.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8
  },
  // Fills the header (up to the action buttons), so the rename field has a set width to take and
  // doesn't resize the header as it swaps in for the name.
  headText: { flex: 1, minWidth: 0 },
  headActions: { display: 'flex', gap: 6, flex: '0 0 auto' },
  iconBtnSm: {
    width: 24,
    height: 24,
    borderRadius: 5,
    border: `1px solid ${UI.border}`,
    background: 'transparent',
    color: UI.text,
    fontSize: 12,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0
  },
  headCat: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    display: 'block'
  },
  // A line of its own holding the name or its rename field (see tileNameStyles).
  headName: { display: 'flex', lineHeight: '20px', minWidth: 0 },
  // A group's header line: the tile's name, then the plot switcher after it.
  headNameRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  headId: { color: UI.textMuted, fontSize: 11 },
  scroll: { flex: 1, overflow: 'auto', scrollbarGutter: 'stable', minHeight: 0 },
  // Embedded: no inner scroller, so the page scrolls as one document.
  scrollEmbedded: { overflow: 'visible' },
  section: FORM.section,
  sectionHead: FORM.sectionHead,
  // Centre (not baseline): an inline StatusNote carries an icon, which baseline alignment lifts.
  sectionTitleRow: FORM.sectionTitleRow,
  sectionTitle: FORM.sectionTitle,
  sectionSubtitle: FORM.sectionSubtitle,
  /** the title row as a button: no chrome, so it still reads as a heading */
  sectionToggle: FORM.sectionToggle,
  hint: { color: UI.textMuted, fontSize: 11, marginBottom: 8, lineHeight: 1.4 },
  /** a success note: last in its section, bottom right */
  doneNote: { justifyContent: 'flex-end', textAlign: 'right' },
  /** a small icon button trailing a note's text (e.g. jump to the folder it names) */
  jumpBtn: {
    background: 'transparent',
    border: 'none',
    padding: '0 0 0 5px',
    color: 'inherit',
    cursor: 'pointer',
    verticalAlign: 'middle',
    lineHeight: 0
  },
  subActions: { display: 'flex', alignItems: 'center', gap: 6 },
  /** one decoration's controls: switch · style dropdown · width, wrapping in a narrow dialog */
  lineRow: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 },
  lineWidth: { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  /** a px size / thickness box: two digits */
  sizeBox: { width: '100%', minWidth: 32, flex: '1 1 auto' },
  /** a 0–1 fraction box: "0.85" — the same width; only its step and range differ */
  fracBox: { width: '100%', minWidth: 32, flex: '1 1 auto' },
  /** an outline cell: its colour swatch and width box side by side */
  ringCell: { display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0 },
  /** a box sharing its cell with a swatch / switch: it takes the remainder, down to two digits */
  tightBox: { flex: '1 1 auto', width: '100%', minWidth: 26, maxWidth: 40 },
  /** the axis switch: a pill with one half per axis, sitting in the section heading */
  axisPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    background: UI.panelAlt
  },
  axisPillBtn: {
    border: 'none',
    borderRadius: 999,
    padding: '2px 16px',
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 1.5,
    cursor: 'pointer'
  },
  /** the line-style dropdown: content-sized, so the width control keeps the rest of the row */
  lineChoice: { display: 'flex', width: 66, flex: '0 0 66px' },
  /** the quick-access switch (QuickToggle) right of a plot setting: small caption + Switch */
  quickRow: { display: 'inline-flex', alignItems: 'center', gap: 5, flex: '0 0 auto' },
  quickLabel: { color: UI.textMuted, fontSize: 10, whiteSpace: 'nowrap' },
  field: FORM.field,
  fieldLabel: FORM.fieldLabel,
  fieldInfo: FORM.fieldInfo,
  // A link-styled note opening a window (the manual import's "How to prepare input files?").
  linkNote: {
    alignSelf: 'flex-start',
    display: 'block',
    margin: '6px 0',
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: UI.info,
    fontSize: 11,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  // An (i) that opens a window rather than showing a tip: InfoTip's look, as a bare button.
  formatBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: 0,
    background: 'transparent',
    border: 'none',
    color: UI.info,
    cursor: 'pointer'
  },
  // Vertical field: header line, then its controls on the line below (full-width).
  fieldCol: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, minWidth: 0 },
  fieldColLabel: { color: UI.textMuted, fontSize: 11 },
  /** small label sitting left of an inline control (e.g. "log₂FC ≤" before its box) */
  inlineTag: { color: UI.textMuted, fontSize: 11, whiteSpace: 'nowrap' },
  /** one cutoff line: tag, number box (fixed width), optional class-name box */
  cutoffRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  // a top-N's per-side count label (up / down), before its box
  sideLabel: { fontSize: 11, color: UI.textMuted },
  /** a side's name above its cutoff line (uppercase, like the selector's side labels) */
  sideTag: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted,
    marginTop: 2
  },
  /** the preview: the sub-blocks' indent without their rule, so every column lines up */
  previewIndent: { paddingLeft: 10, borderLeft: '1px solid transparent' },
  /** the fields under a sub-heading: indented, with a hairline rule tying them to their caption */
  subGroup: {
    paddingLeft: 10,
    marginTop: 4,
    borderLeft: `1px solid ${UI.border}`
  },
  cutoffBox: { width: 64, flex: '0 0 64px' },
  /** the group table, transposed: one column per group, one row per setting. It scrolls
   *  sideways rather than squeezing when a plot has many groups. */
  groupScroll: { overflowX: 'auto', paddingBottom: 2 },
  groupGrid: {
    display: 'grid',
    alignItems: 'center',
    // Fields stretch to the column (one width for every box); fixed-size controls — a switch, a
    // marker preview — centre themselves instead (justifySelf on the element).
    justifyItems: 'stretch',
    columnGap: 6,
    rowGap: 6,
    minWidth: 0
  },
  /** a bare switch in the table: centred in its column */
  switchCell: { display: 'flex', justifyContent: 'center' },
  /** a row's name, down the left */
  rowLabel: { color: UI.textMuted, fontSize: 11, justifySelf: 'start', whiteSpace: 'nowrap' },
  /** the old row-per-group table (its cell styles are still used by the transposed one) */
  // Fluid columns so the table fits the narrower tile dialog (340px) as well as the canvas
  // panel: the name column takes whatever the fixed swatch/box/switch columns leave.
  /** the legend table: swatch · group name · entry switch */
  // The name column is content-sized so each switch sits right after its name (not at the far edge).
  /** the group-name box: labelInput trimmed to fit its fluid grid column */
  styleName: { minWidth: 0, width: '100%', padding: '3px 6px' },
  markerDot: { display: 'block', borderRadius: '50%', flex: '0 0 auto' },
  /** the highlight preview cell: markerCell, with room for the name above the marker */
  hlCell: {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    height: PREVIEW_H,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: '3px 2px',
    boxSizing: 'border-box',
    overflow: 'hidden'
  },
  /** the preview ground: ONE grid item spanning the three state rows and every group column
   *  (rows 1-2 are the name and colour, column 1 the row labels), painted under the markers */
  previewBox: {
    gridColumn: '2 / -1',
    gridRow: '3 / span 3',
    justifySelf: 'stretch',
    alignSelf: 'stretch',
    // Bleed over the grid's ROW gaps only, so it reads as one area rather than a tile per marker;
    // horizontally it stops at the columns' own edges instead of spilling into the label column.
    marginTop: -3,
    marginBottom: -3,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  /** a native colour picker trimmed to a small swatch */
  swatch: {
    position: 'relative',
    width: 28,
    height: 24,
    flex: '0 0 28px',
    padding: 0,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    background: UI.panelAlt,
    boxSizing: 'border-box',
    overflow: 'hidden',
    cursor: 'pointer'
  },
  /** the preview dots stacked vertically, one group per line (the ring gap is added inline);
   *  each entry is its name over its dot */
  dotRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  hlField: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  hlFieldLabel: {
    color: UI.textMuted,
    fontSize: 11,
    width: 50,
    flex: '0 0 50px',
    whiteSpace: 'nowrap'
  },
  /** the preview's gene name, as the overlay draws it (bold, at the configured size) */
  hlName: { fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.2, flex: '0 0 auto' },
  /** small text button in a section header (drop a section's overrides) */
  resetBtn: {
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    padding: '2px 4px',
    fontSize: 11,
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  /** a small percentage box (two digits + a decimal) */
  pctBox: { width: 48, flex: '0 0 48px' },
  labelInput: {
    flex: 1,
    // shrinks with a narrow panel rather than pushing the row past it
    minWidth: 40,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 7px',
    fontSize: 12,
    boxSizing: 'border-box'
  },
  condRow: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' },
  condNone: { fontSize: 12, color: UI.textMuted },
  typeChip: {
    flex: 'none',
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
  input: FORM.input,
  // The "Select plots (n)" trigger: styled like an input but behaves as a dropdown button.
  menuTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    textAlign: 'left',
    cursor: 'pointer'
  },

  // A heading row inside a dropdown (the enrichment terms' Function / Pathway): small, muted caps.
  optionHeading: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.7
  },
  // Data scale (Clean data): the input-value histogram, its range, and the detection note.
  // Caption + detected scale on the left, the distribution on the right.
  histWrap: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  histChart: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  // The plot area is boxed; its bottom edge is the x axis.
  histSvg: {
    width: '100%',
    height: 36,
    display: 'block',
    boxSizing: 'border-box',
    border: `1px solid ${UI.border}`
  },
  histHead: {
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4
  },
  histCaption: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  histAxis: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 10,
    color: UI.textMuted,
    fontVariantNumeric: 'tabular-nums'
  },
  checkRow: FORM.checkRow,
  geneWrap: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 },
  stackLabel: { color: UI.textMuted, fontSize: 11, marginTop: 4, marginBottom: 2 },
  tokens: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  token: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '1px 4px 1px 8px',
    fontSize: 11,
    color: UI.text,
    maxWidth: '100%'
  },
  tokenX: {
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1,
    padding: '0 2px'
  },
  geneList: {
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    background: UI.panelAlt,
    maxHeight: 168,
    overflow: 'auto'
  },
  geneOpt: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderBottom: `1px solid ${UI.border}`,
    color: UI.text,
    fontSize: 12,
    padding: '5px 8px',
    cursor: 'pointer'
  },
  geneId: { color: UI.textMuted, fontSize: 10, fontVariantNumeric: 'tabular-nums' },
  geneEmpty: { color: UI.textMuted, fontSize: 11, padding: '6px 8px' },
  fileRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 8,
    fontSize: 11,
    marginBottom: 4
  },
  muted: { color: UI.textMuted },
  btnRow: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '6px 10px',
    fontSize: 11,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    borderColor: UI.accent,
    fontWeight: 600,
    width: '100%'
  },
  chip: {
    background: UI.panelAlt,
    color: UI.textMuted,
    border: '1px solid transparent',
    borderRadius: 999,
    padding: '3px 10px',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: 0.3,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    minWidth: 96,
    textAlign: 'center',
    transition: motion('color, border-color, background', 'hover')
  },
  chipDone: {
    color: UI.accent,
    border: `1px solid ${UI.accent}`
  },
  footer: { display: 'flex', gap: 8, padding: 12, borderTop: `1px solid ${UI.border}` }
}
