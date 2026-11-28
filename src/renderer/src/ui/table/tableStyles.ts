/** The cells of the app's scrolling tables (ui/table/ScrollFade). */
import type { CSSProperties } from 'react'

import { UI } from '../app/theme'

/** The cells of a table in a ScrollFade. `grid`: border-collapse separate (not collapse), so the
 *  sticky header actually sticks in Chromium; max-content columns, at least the box's width. */
export const TABLE: Record<'grid' | 'th' | 'td' | 'clip', CSSProperties> = {
  grid: {
    borderCollapse: 'separate',
    borderSpacing: 0,
    width: 'max-content',
    minWidth: '100%',
    fontSize: 12
  },
  th: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: UI.panelAlt,
    color: UI.textMuted,
    fontWeight: 600,
    textAlign: 'left',
    verticalAlign: 'bottom',
    padding: '6px 8px',
    borderBottom: `1px solid ${UI.border}`
  },
  td: { padding: '3px 8px', borderBottom: `1px solid ${UI.border}`, color: UI.text },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis' }
}
