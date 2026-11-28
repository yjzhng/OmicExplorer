import type { CSSProperties } from 'react'
import { UI } from '../../../ui/app/theme'

export const styles: Record<string, CSSProperties> = {
  chart: { height: '100%', minHeight: 0, position: 'relative' },
  runBtn: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '5px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // A SwitchBar (or other in-plot control) stacked above the chart, which fills the rest.
  stack: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  stackBody: { flex: 1, minHeight: 0 },
  loadInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    color: UI.text,
    fontSize: 13
  },
  loadLabel: { color: UI.textMuted, width: 100, display: 'inline-block' },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 120,
    color: UI.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: 16
  }
}
