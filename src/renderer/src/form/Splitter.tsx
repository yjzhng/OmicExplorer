/**
 * A draggable vertical divider between two panels.
 *
 * The line a panel is bounded by and the handle you grab are the same thing, so there is no
 * separate gutter eating horizontal space: the element is a few pixels of hit area with a hairline
 * drawn down its middle, and it thickens and takes the accent colour while hovered or dragged.
 *
 * Dragging reports a DELTA rather than a width, because which side the pixels belong to depends on
 * the divider — the left one grows the nav, the right one grows the details column by shrinking as
 * the pointer moves right. The owner applies the delta and clamps it; a splitter that clamped for
 * itself would drift out of step with the width actually rendered.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'

/** Hit area; the visible line is 1px of it, centred. */
const GRAB = 7

export function Splitter({
  onDelta,
  ariaLabel
}: {
  /** pointer movement in px since the last call, positive to the right */
  onDelta: (dx: number) => void
  ariaLabel: string
}): ReactNode {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const lastX = useRef(0)
  const lit = hovered || dragging

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(ev) => {
        // Capture so the drag survives the pointer leaving this thin strip — without it, moving
        // faster than the re-render drops the drag almost immediately.
        ev.currentTarget.setPointerCapture(ev.pointerId)
        lastX.current = ev.clientX
        setDragging(true)
      }}
      onPointerMove={(ev) => {
        if (!dragging) return
        const dx = ev.clientX - lastX.current
        if (dx === 0) return
        lastX.current = ev.clientX
        onDelta(dx)
      }}
      onPointerUp={(ev) => {
        ev.currentTarget.releasePointerCapture(ev.pointerId)
        setDragging(false)
      }}
      style={{ ...styles.grab, width: GRAB, cursor: 'col-resize' }}
    >
      <div
        style={{
          ...styles.line,
          width: lit ? 3 : 1,
          background: lit ? UI.accent : UI.border
        }}
      />
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  grab: {
    flex: '0 0 auto',
    alignSelf: 'stretch',
    display: 'flex',
    justifyContent: 'center',
    // Keeps the pointer's own cursor while dragging past the strip, and stops text selection
    // elsewhere from fighting the drag.
    userSelect: 'none',
    touchAction: 'none'
  },
  line: { alignSelf: 'stretch', transition: 'width 90ms ease, background 90ms ease' }
}
