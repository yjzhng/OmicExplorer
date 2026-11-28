/** The canvas tile summary styles (graph/canvas/GraphNode.tsx and nodes/<kind>/Tile.tsx). */

import { type CSSProperties } from 'react'
import { UI } from '../../ui/app/theme'

export const muted: CSSProperties = {
  color: UI.textMuted,
  fontSize: 11,
  lineHeight: 1.45,
  // Break long unbroken filenames (underscores/paths) so they wrap inside the fixed-width tile
  // instead of overflowing it.
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  minWidth: 0
}

export const stat: CSSProperties = {
  color: UI.text,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  marginTop: 2
}
