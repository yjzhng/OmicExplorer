/** Grid geometry + pure layout helpers for the dashboard.
 *  A PanelLayout item is react-grid-layout's `{ i, x, y, w, h }`, so it serializes
 *  straight into the workflow file (persistence stage). */
import type { Layout as RglLayout, LayoutItem } from 'react-grid-layout'

export type PanelLayout = RglLayout // LayoutItem[]

// Fine grid: 48 cols × 20px rows — columns are twice as dense as before (24), so tiles snap at
// half the previous horizontal step. Layouts saved on a coarser grid are scaled on load (see the
// workflowDoc migration): pre-v3 by ×2 on both axes, pre-v4 by a further ×2 on columns only — so a
// pre-existing half-width tile keeps the same size on the denser grid.
export const GRID_COLS = 48
export const ROW_HEIGHT = 20
export const GRID_MARGIN: [number, number] = [12, 6]
export const GRID_PADDING: [number, number] = [4, 4]

/** Plots per row a dashboard is laid out with before it's arranged by hand (Settings). */
export type PlotsPerRow = 2 | 3 | 4
export const DEFAULT_PER_ROW: PlotsPerRow = 3

/** A tile's default footprint at `perRow` across: an equal share of the 48 columns, and a little
 *  shorter as it narrows (~340px tall two-up, ~300 three-up, ~260 four-up), so a plot keeps a
 *  usable shape. */
function footprint(perRow: PlotsPerRow): { w: number; h: number } {
  return { w: GRID_COLS / perRow, h: { 2: 16, 3: 14, 4: 12 }[perRow] }
}

/** Tile members `perRow`-up in member order. Pure — same input, same layout. */
export function autoLayout(ids: string[], perRow: PlotsPerRow = DEFAULT_PER_ROW): PanelLayout {
  const { w, h } = footprint(perRow)
  return ids.map((id, i) => ({
    i: id,
    x: (i % perRow) * w,
    y: Math.floor(i / perRow) * h,
    w,
    h
  }))
}

/**
 * Merge a saved/edited layout with the current member set: keep existing items,
 * append auto-placed items for new members, drop items whose member is gone.
 * New members are stacked below the tallest existing row so they never overlap.
 */
export function reconcileLayout(
  existing: PanelLayout,
  ids: string[],
  perRow: PlotsPerRow = DEFAULT_PER_ROW
): PanelLayout {
  const { w, h } = footprint(perRow)
  const byId = new Map(existing.map((it) => [it.i, it]))
  const idSet = new Set(ids)
  const kept = existing.filter((it) => idSet.has(it.i))
  let nextY = kept.reduce((max, it) => Math.max(max, it.y + it.h), 0)
  const out: LayoutItem[] = [...kept]
  let col = 0
  for (const id of ids) {
    if (byId.has(id)) continue
    out.push({ i: id, x: col * w, y: nextY, w, h })
    col = col + 1 < perRow ? col + 1 : ((nextY += h), 0)
  }
  return out
}

/** True when two layouts differ in any item's position or size (ignores mount/drag-frame echo). */
export function geometryChanged(a: PanelLayout, b: PanelLayout): boolean {
  if (a.length !== b.length) return true
  const byId = new Map(a.map((it) => [it.i, it]))
  return b.some((it) => {
    const prev = byId.get(it.i)
    return !prev || prev.x !== it.x || prev.y !== it.y || prev.w !== it.w || prev.h !== it.h
  })
}
