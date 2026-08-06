/** The swappable grid seam. Callers pass a library-agnostic PanelLayout in/out and
 *  never import react-grid-layout directly — replace this file to change grid libs.
 *
 *  Dragging is bound to each panel's header (`.panel-drag`), not the body, so the
 *  charts inside stay interactive (hover, future brushing) instead of being
 *  swallowed by a body-wide drag target. */
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import GridLayout, { type ResizeHandleAxis } from 'react-grid-layout'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './dashboard.css'

import { useElementSize } from './useElementSize'
import { GRID_COLS, GRID_MARGIN, GRID_PADDING, ROW_HEIGHT, type PanelLayout } from './panels'

/** Every edge and corner, so a panel can be resized from whichever side has room. */
const HANDLES: ResizeHandleAxis[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']

interface Props {
  ids: string[]
  layout: PanelLayout
  editing: boolean
  onLayoutChange: (layout: PanelLayout) => void
  children: (id: string) => ReactNode
}

export function DashboardGrid({
  ids,
  layout,
  editing,
  onLayoutChange,
  children
}: Props): ReactNode {
  // Note: useElementSize holds the last real width while a tab is hidden, so the grid
  // keeps its layout instead of rebuilding every plot on each tab switch.
  const { ref, width: gridWidth } = useElementSize<HTMLDivElement>()

  // Faint dots marking the grid's snap intersections, shown only while editing.
  // The pitch is derived from the same numbers the grid uses, so the dots stay
  // registered with where tiles actually land as the container is resized.
  const dotStyle = useMemo<CSSProperties>(() => {
    if (!editing || gridWidth <= 0) return {}
    const colWidth =
      (gridWidth - GRID_MARGIN[0] * (GRID_COLS - 1) - GRID_PADDING[0] * 2) / GRID_COLS
    const colPitch = colWidth + GRID_MARGIN[0]
    const rowPitch = ROW_HEIGHT + GRID_MARGIN[1]
    return {
      // Thin dots, but brighter than --border so the snap grid still reads on dark.
      backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
      backgroundSize: `${colPitch}px ${rowPitch}px`,
      // Shift by half a cell so dots sit on cell corners, not centres.
      backgroundPosition: `${GRID_PADDING[0] - colPitch / 2}px ${GRID_PADDING[1] - rowPitch / 2}px`,
      // Tile the dots across the full scroll height, not just the first viewport.
      backgroundRepeat: 'repeat'
    }
  }, [editing, gridWidth])

  return (
    <div
      ref={ref}
      // In edit mode the wrapper fills the dashboard so the snap-dot backdrop shows
      // in the empty space around tiles (tiles are opaque and cover their own dots).
      // A tall dotted buffer below the content keeps free space to scroll into and drag
      // tiles down onto — the buffer always re-extends below wherever the tiles end.
      style={{
        width: '100%',
        ...(editing ? { minHeight: '100%', paddingBottom: '60vh', ...dotStyle } : {})
      }}
      className={editing ? 'oe-grid editing' : 'oe-grid'}
    >
      {gridWidth > 0 && (
        <GridLayout
          width={gridWidth}
          layout={layout}
          onLayoutChange={onLayoutChange}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight: ROW_HEIGHT,
            margin: GRID_MARGIN,
            containerPadding: GRID_PADDING
          }}
          dragConfig={{
            enabled: editing,
            handle: '.panel-drag',
            // Controls inside a header stay clickable rather than starting a drag.
            cancel: 'button,select,input,a'
          }}
          resizeConfig={{ enabled: editing, handles: HANDLES }}
        >
          {ids.map((id) => (
            <div key={id} className="oe-grid-item">
              {children(id)}
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  )
}
