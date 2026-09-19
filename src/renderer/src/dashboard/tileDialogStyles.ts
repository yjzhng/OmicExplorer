/** Styles for the tile popovers (TileDialog shell, settings and download windows). */
import type { CSSProperties } from 'react'

import { UI } from '../ui/theme'

export const styles: Record<string, CSSProperties> = {
  // Invisible click-away layer under the popover (no dimming — the tile stays in view).
  clickAway: { position: 'fixed', inset: 0, zIndex: 60 },
  // Anchored card; left/width/top-or-bottom/maxHeight are set per anchor by TileDialog.
  popover: {
    position: 'fixed',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    zIndex: 61,
    overflow: 'hidden'
  },
  head: {
    padding: '12px 16px',
    fontWeight: 700,
    fontSize: 14,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: '0 0 auto'
  },
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    overflow: 'auto',
    minHeight: 0
  },
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionTitle: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: 700,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    paddingBottom: 6
  },
  // The canvas panel's sections carry their own padding + dividers; let them span the window's
  // full width (cancelling the body padding) so they read as they do on the canvas.
  plotConfig: { display: 'flex', flexDirection: 'column', margin: '-2px -16px -16px' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted
  },
  segmented: {
    display: 'inline-flex',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    overflow: 'hidden',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexWrap: 'wrap'
  },
  segment: {
    border: 'none',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    cursor: 'pointer'
  },
  hint: { fontSize: 11, color: UI.textMuted },
  foot: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
  btnGhost: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 13,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
