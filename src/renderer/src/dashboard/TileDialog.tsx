/** The popover shell shared by a tile's settings and download windows (opened from the panel
 *  header buttons), plus the small labelled-field and segmented-control widgets they share. */
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cssVars, PALETTES } from '../ui/theme'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { useUiTheme } from '../ui/useUiTheme'
import { styles } from './tileDialogStyles'

/** Where a popover hangs from, in viewport coordinates: the TILE's box. The window opens beside
 *  it (right, else left) and aligns to its top, so the plot it configures stays in view. `bottom`
 *  is the tile's, used only to keep a short window from hanging past it. */
export type Anchor = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>

const POP_W = 340
const GAP = 8 // between the tile and the window
const MARGIN = 8 // kept clear of the viewport edges

/**
 * The window shell shared by a tile's settings and download popovers: a card BESIDE the tile —
 * to its right, or to its left when the right would cross the viewport edge — so a change applies
 * in full view of the plot instead of behind the window. Aligned to the tile's top and clamped
 * inside the viewport (its body scrolls when it's taller than the screen). An invisible click-away
 * layer closes it; there is no dimming scrim. Themed explicitly because it portals outside the app
 * root.
 */
export function TileDialog({
  title,
  label,
  anchor,
  busy,
  onClose,
  footer,
  children
}: {
  title: string
  label: string
  anchor: Anchor
  /** while set, clicking away doesn't close the window (a write is in flight) */
  busy?: boolean
  onClose: () => void
  footer: ReactNode
  children: ReactNode
}): ReactNode {
  // The portal target (document.body) is outside the app root that defines the theme CSS
  // variables, so re-apply them here or UI.* (var(--…)) would resolve to nothing.
  const mode = useUiTheme((s) => s.mode)
  // Escape closes, like the click-away layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  // Beside the tile: to its right when the window fits there, else to its left; if neither side
  // has room (a tile spanning a narrow window), it sits against whichever edge is roomier.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(POP_W, vw - 2 * MARGIN)
  const roomRight = vw - anchor.right - GAP - MARGIN
  const roomLeft = anchor.left - GAP - MARGIN
  const onRight = roomRight >= width || roomRight >= roomLeft
  const left = onRight
    ? Math.min(anchor.right + GAP, vw - MARGIN - width)
    : Math.max(MARGIN, anchor.left - GAP - width)
  // Top-aligned with the tile, then lifted if that would run it off the bottom of the screen.
  const maxHeight = vh - 2 * MARGIN
  const top = Math.max(MARGIN, Math.min(anchor.top, vh - MARGIN - Math.min(maxHeight, 240)))
  const place: CSSProperties = { top, maxHeight: vh - MARGIN - top }
  return createPortal(
    <div style={cssVars(PALETTES[mode])}>
      <div style={styles.clickAway} onClick={busy ? undefined : onClose} />
      <div style={{ ...styles.popover, left, width, ...place }} role="dialog" aria-label={label}>
        <div style={styles.head}>{title}</div>
        <div style={styles.body}>
          {children}
          <div style={styles.foot}>{footer}</div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={styles.field}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
    </div>
  )
}

export function Segmented({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ v: string; label: string }>
}): ReactNode {
  return (
    <ToggleSwitch
      label="Option"
      value={value}
      options={options.map((o) => ({ value: o.v, label: o.label }))}
      onChange={onChange}
    />
  )
}
