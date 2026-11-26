/** The components that draw a windowed list (see ./useVirtualRows — the rules for long content). */
import type { CSSProperties, ReactNode } from 'react'

import { range, useVirtualRows, type VirtualRows, type VirtualRowsOptions } from './useVirtualRows'

/** A flat list of `count` rows in a <div> (its style yours: a flex column, a gap…). `row(i)`
 *  renders row i, keyed. Give `vr` to drive it from outside (to scroll to a row, say). */
export function VirtualList({
  count,
  row,
  style,
  className,
  scroller,
  onEnd,
  keyOf,
  vr
}: {
  count: number
  row: (i: number) => ReactNode
  style?: CSSProperties
  className?: string
  scroller?: () => HTMLElement | null
  /** the view neared the end: load more (see useVirtualRows) */
  onEnd?: () => void
  /** row i's identity, for its measured height (see useVirtualRows); memoise it */
  keyOf?: VirtualRowsOptions['keyOf']
  vr?: VirtualRows<HTMLDivElement>
}): ReactNode {
  // driven from outside (`vr`): this one idles
  const own = useVirtualRows<HTMLDivElement>(vr ? 0 : count, { scroller, onEnd, keyOf })
  const { attach, start, end, before, after } = vr ?? own
  return (
    <div ref={attach} style={style} className={className}>
      {before > 0 && <div data-vr-spacer aria-hidden style={{ height: before, flex: 'none' }} />}
      {range(start, end).map(row)}
      {after > 0 && <div data-vr-spacer aria-hidden style={{ height: after, flex: 'none' }} />}
    </div>
  )
}

/** A table body of `count` rows; `row(i)` renders a keyed <tr>. `span` = the column count (the
 *  spacer rows span them all). `tail` goes after the rows (a probe row, say). */
export function VirtualTbody({
  count,
  row,
  span,
  scroller,
  onEnd,
  keyOf,
  vr,
  tail
}: {
  count: number
  row: (i: number) => ReactNode
  span: number
  scroller?: () => HTMLElement | null
  /** the view neared the end: load more (see useVirtualRows) */
  onEnd?: () => void
  /** row i's identity, for its measured height (see useVirtualRows); memoise it */
  keyOf?: VirtualRowsOptions['keyOf']
  vr?: VirtualRows<HTMLTableSectionElement>
  tail?: ReactNode
}): ReactNode {
  // driven from outside (`vr`): this one idles
  const own = useVirtualRows<HTMLTableSectionElement>(vr ? 0 : count, { scroller, onEnd, keyOf })
  const { attach, start, end, before, after } = vr ?? own
  return (
    <tbody ref={attach}>
      {before > 0 && <SpacerRow height={before} span={span} />}
      {range(start, end).map(row)}
      {after > 0 && <SpacerRow height={after} span={span} />}
      {tail}
    </tbody>
  )
}

function SpacerRow({ height, span }: { height: number; span: number }): ReactNode {
  return (
    <tr data-vr-spacer aria-hidden style={{ height }}>
      <td colSpan={span} style={{ padding: 0, border: 'none' }} />
    </tr>
  )
}

/** A hidden row that lays out each column's widest text (see longestText): sized, never seen,
 *  copied or selected. */
export function ProbeRow({
  texts,
  cellStyle
}: {
  texts: string[]
  cellStyle?: CSSProperties
}): ReactNode {
  return (
    <tr aria-hidden data-vr-spacer style={{ visibility: 'hidden' }}>
      {texts.map((t, k) => (
        <td
          key={k}
          style={{
            ...cellStyle,
            paddingTop: 0,
            paddingBottom: 0,
            borderBottom: 'none',
            lineHeight: 0,
            height: 0,
            // the text still overhangs its 0-high line by half a glyph: clipped, or it adds ~6px
            // of scroll to the table — a two-row table scrolled for it
            overflow: 'hidden'
          }}
        >
          {t}
        </td>
      ))}
    </tr>
  )
}
