/** The popover shell shared by a tile's settings and download windows (opened from the panel
 *  header buttons), plus the small labelled-field and segmented-control widgets they share. */
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { styles } from './tileDialogStyles'

/** Where a popover hangs from, in viewport coordinates: `top`/`bottom` of the opening button (it
 *  drops below, or flips above), `right` the edge it right-aligns to (the tile's right edge). */
export type Anchor = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right'>

const POP_W = 340
const GAP = 6 // between the button and the popover
const MARGIN = 8 // kept clear of the viewport edges

/**
 * The window shell shared by a tile's settings and download popovers: a card hanging just below
 * the header button, right-aligned to the tile's edge so it reads in context, clamped inside the viewport
 * (its body scrolls when the space below is short). An invisible click-away layer closes it; there
 * is no dimming scrim. Themed explicitly because it portals outside the app root.
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

  // Below the button, right-aligned to the anchor's right edge (the tile's); slid left/right to
  // stay inside the viewport. If the
  // space below is too short for even a small card, flip above the button instead.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(POP_W, vw - 2 * MARGIN)
  const left = Math.max(MARGIN, Math.min(anchor.right - width, vw - MARGIN - width))
  const below = vh - anchor.bottom - GAP - MARGIN
  const above = anchor.top - GAP - MARGIN
  const flip = below < 240 && above > below
  const place: CSSProperties = flip
    ? { bottom: vh - anchor.top + GAP, maxHeight: above }
    : { top: anchor.bottom + GAP, maxHeight: below }
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
    <div style={styles.segmented}>
      {options.map((o) => {
        const on = value === o.v
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              ...styles.segment,
              background: on ? UI.accent : 'transparent',
              color: on ? UI.accentText : UI.text
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
