/**
 * The looks of the app's form primitives (ui/controls/Section, ui/controls/Field, ui/controls/NumberInput, ui/controls/Checkbox) —
 * one place, so a settings panel, a dialog and a window draw the same control the same way. The
 * node settings' style sheet (nodes/kit/settings/styles) takes its section / field / input
 * entries from here.
 */
import type { CSSProperties } from 'react'

import { UI } from '../app/theme'

export const FORM: Record<string, CSSProperties> = {
  // ── Section ──────────────────────────────────────────────────────────────────
  /** a settings panel's section: a rule under it */
  section: { padding: '12px 14px', borderBottom: `1px solid ${UI.border}` },
  /** a dialog's section (the selector windows): a rule over it, rows indented under the title */
  sectionDialog: { padding: '12px 16px 14px', borderTop: `1px solid ${UI.border}` },
  /** a window's section (Settings → annotations): a bordered card */
  sectionCard: { border: `1px solid ${UI.border}`, borderRadius: 8, marginBottom: 14 },
  /** a section nested in another (a card's tables) */
  sectionSub: { marginTop: 14 },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10
  },
  sectionHeadDialog: { marginBottom: 0 },
  sectionHeadCard: { marginBottom: 0, padding: '6px 10px 6px 6px' },
  sectionHeadSub: { marginBottom: 6 },
  sectionBodyCard: { padding: '0 12px 12px' },
  // Centre (not baseline): an inline StatusNote carries an icon, which baseline alignment lifts.
  sectionTitleRow: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  /** a card's title reads as a heading of its own (the text colour, sentence case) */
  sectionTitleCard: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'none',
    letterSpacing: 0,
    color: UI.text
  },
  sectionSubtitle: { fontSize: 11, color: UI.textMuted, opacity: 0.8, whiteSpace: 'nowrap' },
  /** the title row as a button: no chrome, so it still reads as a heading */
  sectionToggle: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    margin: 0,
    color: UI.textMuted,
    cursor: 'pointer',
    textAlign: 'left',
    flex: 1
  },

  // ── Field ────────────────────────────────────────────────────────────────────
  /** label left (a fixed column), control right */
  field: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  fieldLabel: { color: UI.textMuted, fontSize: 11, width: 90, flex: '0 0 90px' },
  fieldInfo: { marginLeft: 4, verticalAlign: 'middle' },
  /** label above, control under it (full width) */
  fieldStack: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, minWidth: 0 },
  fieldStackLabel: { color: UI.textMuted, fontSize: 11 },
  /** two cells of a caller's grid (name column | body column) */
  fieldGridLabel: {
    gridColumn: 1,
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    alignSelf: 'center',
    padding: '3px 0'
  },
  // a multi-line control's label: at its top, level with its first line (a boxed block's title)
  fieldGridLabelTop: { alignSelf: 'start', paddingTop: 10 },
  fieldGridBody: {
    gridColumn: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    padding: '3px 0'
  },

  // ── inputs ───────────────────────────────────────────────────────────────────
  input: {
    width: '100%',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 7px',
    fontSize: 12,
    boxSizing: 'border-box'
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: UI.text,
    marginBottom: 6,
    cursor: 'pointer'
  }
}
