/** A table's scroller, ready-made: the app's scrollbars, spanning only what scrolls (see
 *  ./useStickyGutter). For a scroller that needs its own ref or handlers, use the hook. */
import { useRef, type CSSProperties, type ReactNode } from 'react'

import { TABLE_SCROLL, useStickyGutter } from './useStickyGutter'

export function TableScroll({
  style,
  children
}: {
  style?: CSSProperties
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useStickyGutter(ref)
  return (
    <div ref={ref} className={TABLE_SCROLL} style={style}>
      {children}
    </div>
  )
}
