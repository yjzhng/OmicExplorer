/** A tile's name, as the canvas tile shows it and the detail panel's title repeats it: the same
 *  text, the same dashed outline under the pointer (in the tile's accent, set where it's used), and
 *  the same rename field in its place — so renaming looks identical in both. */
import type { CSSProperties } from 'react'

import { UI } from '../ui/theme'

export const tileNameText: CSSProperties = { fontWeight: 600, fontSize: 14 }

// Dashed pill around the tile name, hinting it's editable (click to rename). Its border colour is
// set where it's used — the accent under the pointer, transparent otherwise — as the whole
// shorthand, never a borderColor longhand over this one, which React can leave stuck.
export const nameChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'flex-start',
  // The pill's padding + border sit out to the left, so the name's text lines up with the
  // category tag above it (no indent); the outline shows just outside on hover.
  maxWidth: 'calc(100% + 7px)',
  marginLeft: -7,
  padding: '0 6px',
  border: `1px dashed ${UI.border}`,
  borderRadius: 5,
  cursor: 'text',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

// Inline rename field — matches the name chip's box (same font, padding, border, radius) so
// swapping the label for the input doesn't change the header's height or push the body.
export const nameInput: CSSProperties = {
  fontWeight: 600,
  fontSize: 14, // the name's own size (tileNameText), so renaming doesn't change it
  lineHeight: 'inherit',
  background: UI.panelAlt,
  color: UI.text,
  border: `1px solid ${UI.accent}`,
  borderRadius: 5,
  padding: '0 6px',
  // Text where the name sat (see nameChip): padding + border out to the left.
  margin: '0 0 0 -7px',
  width: 'calc(100% + 7px)', // fill the title column instead of a fixed width that pushes the header
  boxSizing: 'border-box'
}
