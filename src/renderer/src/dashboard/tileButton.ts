/** A results tile's header button (copy, download, export data, settings): its look, shared by
 *  PanelTile and the User guide, which draws the same buttons. */
import type { CSSProperties } from 'react'

import { UI } from '../ui/app/theme'

export const TILE_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 26,
  background: 'transparent',
  color: UI.textMuted,
  border: `1px solid ${UI.border}`,
  borderRadius: 5,
  cursor: 'pointer'
}
