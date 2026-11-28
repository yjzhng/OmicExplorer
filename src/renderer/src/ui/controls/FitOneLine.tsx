/**
 * A row of controls while it fits on one line, else something more compact in its place (a
 * dropdown): a settings field whose choices are few enough to show outright, but could be many
 * (a condition per checkbox, for data with many conditions).
 *
 * The row's width: an invisible copy at its natural one-line width (`max-content`, in a zero-size
 * clipped box so it can't widen the panel). The room: this box's own width, the field's control
 * column. Both are layout widths (offsetWidth / clientWidth), so a panel scaled or sliding in reads
 * the same as at rest.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export function FitOneLine({
  row,
  fallback
}: {
  /** the controls laid out on one line (rendered twice: once hidden, to measure) */
  row: ReactNode
  /** shown instead when `row` doesn't fit */
  fallback: ReactNode
}): ReactNode {
  const boxRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const box = boxRef.current
    const measure = measureRef.current
    if (!box || !measure) return
    const check = (): void => setFits(measure.offsetWidth <= box.clientWidth)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(box)
    ro.observe(measure)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={boxRef} style={styles.box}>
      <div style={styles.clip} aria-hidden>
        <div ref={measureRef} style={styles.measure}>
          {row}
        </div>
      </div>
      {fits ? row : fallback}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  box: { position: 'relative', minWidth: 0 },
  clip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none'
  },
  measure: { position: 'absolute', left: 0, top: 0, width: 'max-content' }
}
