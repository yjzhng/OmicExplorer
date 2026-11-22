/** The dashboard's packing: gravity up, with swaps along a row (designed in mockup/resize-logic.html).
 *
 *  - Every tile floats up as far as it can; sideways gaps stay where they are.
 *  - The tile being dragged or resized sits exactly where it's held, and whatever it overlaps is
 *    pushed down out of its way; on release it floats up too.
 *  - Dragged sideways along its own row (within half its height of where it began), a tile that
 *    runs into a neighbour trades places with it once its middle passes the neighbour's: the row's
 *    tiles keep their spacing (the gaps stay where they were, by position in the row) instead of
 *    the neighbour being pushed down. Into free space in the row, it just moves there.
 *
 *  Part of the grid seam (DashboardGrid): react-grid-layout calls `compact` on every drag or resize
 *  step, right after DashboardGrid's own drag/resize callback — which marks the step (`step`) — and
 *  again once on release, unmarked: that one, and any other (a layout change), settles. */
import type { Compactor, Layout, LayoutItem } from 'react-grid-layout'

type Geo = Pick<LayoutItem, 'x' | 'y' | 'w' | 'h'>

const overlaps = (a: Geo, b: Geo): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** Gravity: `heldId` (if any) stays where it is; every other tile, top to bottom, floats up from
 *  the top until it would overlap one already placed. Returned in the input's order. */
export function gravityLayout(layout: Layout, heldId?: string | null): Layout {
  const held = heldId ? layout.find((t) => t.i === heldId) : undefined
  const placed: LayoutItem[] = held ? [{ ...held, moved: false }] : []
  const rest = layout.filter((t) => t !== held).sort((a, b) => a.y - b.y || a.x - b.x)
  for (const t of rest) {
    const p = { ...t, y: 0, moved: false }
    while (placed.some((q) => overlaps(q, p))) {
      // jump to just below the lowest tile in the way, rather than a row at a time
      p.y = Math.max(...placed.filter((q) => overlaps(q, p)).map((q) => q.y + q.h))
    }
    placed.push(p)
  }
  const byId = new Map(placed.map((t) => [t.i, t]))
  return layout.map((t) => byId.get(t.i) ?? t)
}

/** The row reorder for a tile dragged along its own row, or null when the drag isn't one (it has
 *  left the row, or it's over free space in the row — plain gravity then). `base` is the layout
 *  when the drag began; `held` the dragged tile's requested cell; `mid` its middle as the pointer
 *  has it, in columns (the snapped cell is clamped at the grid's edge, so at the left edge it could
 *  never pass the first tile's middle). Returns `base` with the row's tiles in their new slots. */
export function rowSwap(
  base: Layout,
  heldId: string,
  held: Geo,
  mid: number,
  cols: number
): Layout | null {
  const start = base.find((t) => t.i === heldId)
  if (!start || Math.abs(held.y - start.y) > Math.floor(start.h / 2)) return null
  const row = base.filter((t) => t.y === start.y).sort((a, b) => a.x - b.x)
  const others = row.filter((t) => t.i !== heldId)
  const there = { ...start, x: held.x }
  if (!others.some((t) => overlaps(there, t))) return null
  // the row's gaps, by position: before the first tile, then between each pair
  const gaps = row.map((t, k) => (k === 0 ? t.x : t.x - (row[k - 1].x + row[k - 1].w)))
  let j = others.findIndex((t) => mid < t.x + t.w / 2)
  if (j < 0) j = others.length
  const order = [...others]
  order.splice(j, 0, start)
  const slots = new Map<string, number>()
  let x = 0
  order.forEach((t, k) => {
    x += gaps[k]
    slots.set(t.i, Math.min(x, cols - t.w))
    x += t.w
  })
  return base.map((t) => (slots.has(t.i) ? { ...t, x: slots.get(t.i)!, y: start.y } : t))
}

/** One grid's compactor, with the drag or resize in progress. DashboardGrid calls `begin` when a
 *  drag or resize starts, `step` from each of its callbacks (before react-grid-layout compacts that
 *  step), and `end` when it stops. */
export function gravityCompactor(): {
  compactor: Compactor
  begin: (base: Layout, id: string, kind: 'drag' | 'resize') => void
  step: (mid?: number) => void
  end: () => void
} {
  let active: { base: Layout; id: string; kind: 'drag' | 'resize' } | null = null
  let fresh = false
  let mid = 0
  return {
    compactor: {
      type: 'vertical',
      allowOverlap: false,
      compact(layout, cols) {
        const live = active && fresh
        fresh = false
        if (!active || !live) return gravityLayout(layout)
        // The other tiles from where they were when this began (react-grid-layout's own pushes
        // along the way are ignored); the held one as it's held now.
        const { base, id, kind } = active
        const held = layout.find((t) => t.i === id)
        if (!held) return gravityLayout(layout)
        const swapped = kind === 'drag' ? rowSwap(base, id, held, mid, cols) : null
        const input =
          swapped ??
          base.map((t) => (t.i === id ? { ...t, x: held.x, y: held.y, w: held.w, h: held.h } : t))
        return gravityLayout(input, id)
      }
    },
    begin: (base, id, kind) => {
      active = { base: base.map((t) => ({ ...t })), id, kind }
    },
    step: (m) => {
      fresh = true
      if (m !== undefined) mid = m
    },
    end: () => {
      active = null
      fresh = false
    }
  }
}
