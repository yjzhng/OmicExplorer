/** The swappable grid seam. Callers pass a library-agnostic PanelLayout in/out and
 *  never import react-grid-layout directly — replace this file to change grid libs.
 *
 *  Dragging is bound to each panel's header (`.panel-drag`), not the body, so the
 *  charts inside stay interactive (hover, future brushing) instead of being
 *  swallowed by a body-wide drag target. */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import GridLayout, { type EventCallback, type ResizeHandleAxis } from 'react-grid-layout'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboard.css'

import { DOT_GRID, PALETTES } from '../ui/app/theme'
import { useUiTheme } from '../ui/app/useUiTheme'
import { gravityCompactor } from './gridCompactor'
import { GridPitchContext } from './gridPitch'
import { useElementSize } from './useElementSize'
import { GRID_COLS, GRID_MARGIN, GRID_PADDING, ROW_HEIGHT, type PanelLayout } from './panels'

/** Every edge and corner, so a panel can be resized from whichever side has room. */
const HANDLES: ResizeHandleAxis[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']

interface Props {
  ids: string[]
  layout: PanelLayout
  onLayoutChange: (layout: PanelLayout) => void
  children: (id: string) => ReactNode
}

export function DashboardGrid({ ids, layout, onLayoutChange, children }: Props): ReactNode {
  // Note: useElementSize holds the last real width while a tab is hidden, so the grid
  // keeps its layout instead of rebuilding every plot on each tab switch.
  const { ref, width: gridWidth } = useElementSize<HTMLDivElement>()
  // Tiles can always be dragged (by the header) and resized; this is whether one is being, right
  // now — the snap dots show only then, so the dashboard isn't dotted the rest of the time.
  const [moving, setMoving] = useState(false)
  const mode = useUiTheme((s) => s.mode)
  const start = (): void => setMoving(true)
  const stop = (): void => setMoving(false)

  // The packing (gridCompactor): gravity up, with swaps along a row. It's told when a drag or
  // resize starts, steps and ends; a drag also passes the dragged tile's middle as the pointer has
  // it, in columns — from the pointer's travel since the drag began.
  const [flow] = useState(gravityCompactor)
  const dragFrom = useRef<{ clientX: number; mid: number } | null>(null)
  const colPitch = (): number =>
    (gridWidth - GRID_MARGIN[0] * (GRID_COLS - 1) - GRID_PADDING[0] * 2) / GRID_COLS +
    GRID_MARGIN[0]
  const clientX = (e: Event): number | null =>
    'clientX' in e
      ? (e as MouseEvent).clientX
      : 'touches' in e && (e as TouchEvent).touches.length
        ? (e as TouchEvent).touches[0].clientX
        : null
  const dragStart: EventCallback = (layout, item, _new, _ph, e) => {
    start()
    if (!item) return
    flow.begin(layout, item.i, 'drag')
    const x = clientX(e)
    dragFrom.current = x === null ? null : { clientX: x, mid: item.x + item.w / 2 }
  }
  const drag: EventCallback = (_layout, _old, item, _ph, e) => {
    const from = dragFrom.current
    const x = clientX(e)
    flow.step(
      from && x !== null
        ? from.mid + (x - from.clientX) / colPitch()
        : item
          ? item.x + item.w / 2
          : undefined
    )
  }
  const resizeStart: EventCallback = (layout, item) => {
    start()
    if (item) flow.begin(layout, item.i, 'resize')
  }
  const end = (): void => {
    stop()
    flow.end()
    dragFrom.current = null
  }

  // Faint dots marking the grid's snap lines, shown only while a tile is moving: one dot in the
  // middle of every gap between cells, so each tile's edges sit the same half-gap inside the dots
  // around it, wherever it lands. Placed from the grid's own numbers (react-grid-layout puts column
  // x at padding + x·(colWidth + margin)), so they stay registered as the window is resized.
  //
  // Drawn as one SVG line per column, dashed into dots down the rows — not a repeating background:
  // a background tile's size snaps to whole (device) pixels, and with a fractional column pitch
  // repeated across 48 columns that drifted the dots several pixels off the tiles by the right
  // edge. Each line here sits at its exact x; the row pitch is a whole number of pixels anyway.
  const dots = useMemo<ReactNode>(() => {
    if (!moving || gridWidth <= 0) return null
    const colWidth =
      (gridWidth - GRID_MARGIN[0] * (GRID_COLS - 1) - GRID_PADDING[0] * 2) / GRID_COLS
    const colPitch = colWidth + GRID_MARGIN[0]
    const rowPitch = ROW_HEIGHT + GRID_MARGIN[1]
    // The gaps' centres: column k's left gap at padding + k·pitch − margin/2, row j's above it the
    // same. The grid's outer edges have a dot line too — half a gap outside the first and last
    // column, which falls just past the wrapper's edge, so pulled in to the dot's radius
    // to stay whole. (Rows likewise: the first, half a gap above row 0, sits at about 1px.)
    const r = DOT_GRID.size / 2
    const firstRow = Math.max(r, GRID_PADDING[1] - GRID_MARGIN[1] / 2)
    const xs = Array.from({ length: GRID_COLS + 1 }, (_, k) =>
      Math.min(gridWidth - r, Math.max(r, GRID_PADDING[0] + k * colPitch - GRID_MARGIN[0] / 2))
    )
    return (
      <svg style={{ ...dotLayer, stroke: PALETTES[mode].axis }} aria-hidden>
        {xs.map((x) => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1={firstRow}
            y2="100%"
            // a zero-length dash with round caps is a dot, one per row
            strokeDasharray={`0 ${rowPitch}`}
          />
        ))}
      </svg>
    )
  }, [moving, gridWidth, mode])

  return (
    <div
      ref={ref}
      // The wrapper fills the dashboard so the snap-dot backdrop shows in the empty space
      // around tiles (tiles are opaque and cover their own dots). A tall buffer below the
      // content keeps free space to scroll into and drag tiles down onto — it always
      // re-extends below wherever the tiles end.
      style={{ width: '100%', minHeight: '100%', paddingBottom: '60vh', position: 'relative' }}
      className="oe-grid editing"
    >
      {/* (before the grid, so its tiles are drawn over their own dots) */}
      {dots}
      {gridWidth > 0 && (
        // the column pitch, for plots that step their layout with the grid (gridPitch.ts)
        <GridPitchContext.Provider value={colPitch()}>
          <GridLayout
            width={gridWidth}
            layout={layout}
            onLayoutChange={onLayoutChange}
            compactor={flow.compactor}
            onDragStart={dragStart}
            onDrag={drag}
            onDragStop={end}
            onResizeStart={resizeStart}
            onResize={() => flow.step()}
            onResizeStop={end}
            gridConfig={{
              cols: GRID_COLS,
              rowHeight: ROW_HEIGHT,
              margin: GRID_MARGIN,
              containerPadding: GRID_PADDING
            }}
            dragConfig={{
              enabled: true,
              handle: '.panel-drag',
              // Controls inside a header stay clickable rather than starting a drag.
              cancel: 'button,select,input,a'
            }}
            resizeConfig={{ enabled: true, handles: HANDLES }}
          >
            {ids.map((id) => (
              <div key={id} className="oe-grid-item">
                {children(id)}
              </div>
            ))}
          </GridLayout>
        </GridPitchContext.Provider>
      )}
    </div>
  )
}

/** The snap dots' layer: the whole wrapper, scroll buffer included, behind the tiles and never in
 *  the way. The workflow canvas's dot (DOT_GRID, colour set per theme): only the spacing is the
 *  grid's own. */
const dotLayer: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  strokeWidth: DOT_GRID.size,
  strokeLinecap: 'round'
}
