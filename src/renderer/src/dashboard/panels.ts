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

/** Default tile footprint: half-width (24 of 48 cols), ~340px tall (matches the S1 CSS grid). */
const DEFAULT_W = 24
const DEFAULT_H = 16

/** Tile members 2-up in member order. Pure — same input, same layout. */
export function autoLayout(ids: string[]): PanelLayout {
  return ids.map((id, i) => ({
    i: id,
    x: (i % 2) * DEFAULT_W,
    y: Math.floor(i / 2) * DEFAULT_H,
    w: DEFAULT_W,
    h: DEFAULT_H
  }))
}

/**
 * Merge a saved/edited layout with the current member set: keep existing items,
 * append auto-placed items for new members, drop items whose member is gone.
 * New members are stacked below the tallest existing row so they never overlap.
 */
export function reconcileLayout(existing: PanelLayout, ids: string[]): PanelLayout {
  const byId = new Map(existing.map((it) => [it.i, it]))
  const idSet = new Set(ids)
  const kept = existing.filter((it) => idSet.has(it.i))
  let nextY = kept.reduce((max, it) => Math.max(max, it.y + it.h), 0)
  const out: LayoutItem[] = [...kept]
  let col = 0
  for (const id of ids) {
    if (byId.has(id)) continue
    out.push({ i: id, x: col * DEFAULT_W, y: nextY, w: DEFAULT_W, h: DEFAULT_H })
    col = col === 0 ? 1 : ((nextY += DEFAULT_H), 0)
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
