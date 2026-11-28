/** "Tidy": lay a selection of canvas tiles out as a left-to-right flow — the shape the canvas's
 *  edges read in (an output on a tile's right, inputs on its left).
 *
 *  - Columns by depth: each tile one column right of its deepest selected input (longest path),
 *    so every edge inside the selection runs left to right.
 *  - Order within a column by the barycentre of each tile's neighbours (a few sweeps right and
 *    left), which pulls linked tiles level with each other and removes most edge crossings.
 *  - Rows from the leaves up, as a tree: a tile's daughters stack first and the tile is centred
 *    vertically on its immediate daughters. Sibling subtrees pack by their per-column contours, so
 *    a short branch tucks up beside a neighbour whose leaves sit further right; nothing overlaps.
 *    A chain stays on one line.
 *  - Loose tiles (no connection in the selection) stack in the first column, under its last tile.
 *  - The selection keeps its top-left corner; tiles outside it don't move, and edges to them are
 *    ignored. */

export interface TidyNode {
  id: string
  x: number
  y: number
  /** drawn height; the layout stacks by it */
  h: number
}
export interface TidyEdge {
  source: string
  target: string
}

/** A tile's width (230) plus the gap to the next column (80), and the gap between stacked tiles. */
export const TIDY_COL = 310
export const TIDY_GAP = 30

export function tidyLayout(
  nodes: TidyNode[],
  edges: TidyEdge[]
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  if (nodes.length === 0) return out
  const ids = new Set(nodes.map((n) => n.id))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inner = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
  const ins = new Map<string, string[]>()
  const outs = new Map<string, string[]>()
  for (const n of nodes) {
    ins.set(n.id, [])
    outs.set(n.id, [])
  }
  for (const e of inner) {
    ins.get(e.target)!.push(e.source)
    outs.get(e.source)!.push(e.target)
  }

  // Depth = longest path from a selection source (Kahn's order; a cycle — not expected on this
  // canvas — leaves its tiles at the depth reached so far).
  const depth = new Map(nodes.map((n) => [n.id, 0]))
  const indeg = new Map(nodes.map((n) => [n.id, ins.get(n.id)!.length]))
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const t of outs.get(id)!) {
      depth.set(t, Math.max(depth.get(t)!, depth.get(id)! + 1))
      indeg.set(t, indeg.get(t)! - 1)
      if (indeg.get(t) === 0) queue.push(t)
    }
  }

  // Columns, first ordered by where the tiles sit now (a stable start for the sweeps).
  const cols: string[][] = []
  for (const n of [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const d = depth.get(n.id)!
    ;(cols[d] ??= []).push(n.id)
  }
  for (let d = 0; d < cols.length; d++) cols[d] ??= []

  const rank = new Map<string, number>()
  const setRanks = (): void => cols.forEach((c) => c.forEach((id, i) => rank.set(id, i)))
  setRanks()
  const bary = (id: string, nbrs: string[]): number =>
    nbrs.length ? nbrs.reduce((s, n) => s + rank.get(n)!, 0) / nbrs.length : rank.get(id)!
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0
    const order = down ? cols.map((_, i) => i) : cols.map((_, i) => cols.length - 1 - i)
    for (const d of order) {
      const key = new Map(cols[d].map((id) => [id, bary(id, down ? ins.get(id)! : outs.get(id)!)]))
      cols[d].sort((a, b) => key.get(a)! - key.get(b)! || rank.get(a)! - rank.get(b)!)
      cols[d].forEach((id, i) => rank.set(id, i))
    }
  }

  // Rows, worked from the leaves up: each tile's daughters (the tiles it feeds, in their column
  // order) are stacked first, then the tile is centred vertically on them, and whole subtrees
  // stack one below the next. A tile fed by several (a contrast's two inputs) hangs under one of
  // them only — the input in the column just before it, highest first — so the shape is a tree.
  const x0 = Math.min(...nodes.map((n) => n.x))
  const y0 = Math.min(...nodes.map((n) => n.y))
  const parentOf = new Map<string, string>()
  for (const n of nodes) {
    const p = [...ins.get(n.id)!].sort(
      (a, b) => depth.get(b)! - depth.get(a)! || rank.get(a)! - rank.get(b)!
    )[0]
    if (p) parentOf.set(n.id, p)
  }
  const kids = new Map(nodes.map((n) => [n.id, [] as string[]]))
  for (const [c, p] of parentOf) kids.get(p)!.push(c)
  for (const list of kids.values()) list.sort((a, b) => rank.get(a)! - rank.get(b)!)
  // Subtrees are packed by their CONTOURS — per column, the top and bottom of the tiles they hold —
  // not by their overall extent: a sibling only has to clear the tiles in the columns it shares
  // with the ones above it. A short branch (a lone plot) therefore tucks up beside a neighbour
  // whose own leaves sit further right, instead of below that neighbour's whole fan.
  type Sub = { ys: Map<string, number>; cont: Map<number, [number, number]> }
  const h = (id: string): number => byId.get(id)!.h
  /** How far to shift `sub` down so it clears `acc` in every shared column (and, given an
   *  `anchor`, so that tile starts at `minTop` or lower). */
  const fit = (acc: Sub, sub: Sub, anchor?: string, minTop?: number): number => {
    let dy = -Infinity
    for (const [col, [t]] of sub.cont) {
      const a = acc.cont.get(col)
      if (a) dy = Math.max(dy, a[1] + TIDY_GAP - t)
    }
    if (anchor && minTop != null) dy = Math.max(dy, minTop - sub.ys.get(anchor)!)
    return dy === -Infinity ? 0 : dy
  }
  const merge = (acc: Sub, sub: Sub, dy: number): void => {
    for (const [id, y] of sub.ys) acc.ys.set(id, y + dy)
    for (const [col, [t, b]] of sub.cont) {
      const a = acc.cont.get(col)
      acc.cont.set(col, a ? [Math.min(a[0], t + dy), Math.max(a[1], b + dy)] : [t + dy, b + dy])
    }
  }
  /** A subtree laid out from its leaves up, at an arbitrary vertical origin. */
  const build = (id: string): Sub => {
    const children = kids.get(id)!
    const d = depth.get(id)!
    if (!children.length) return { ys: new Map([[id, 0]]), cont: new Map([[d, [0, h(id)]]]) }
    const acc: Sub = { ys: new Map(), cont: new Map() }
    let prev: string | undefined
    for (const c of children) {
      const sub = build(c)
      // Daughters keep their order: each also starts below the previous daughter tile itself.
      const dy = acc.ys.size
        ? fit(acc, sub, c, prev ? acc.ys.get(prev)! + h(prev) + TIDY_GAP : undefined)
        : 0
      merge(acc, sub, dy)
      prev = c
    }
    // Centred on its immediate daughters: from the first one's top to the last one's bottom.
    const first = acc.ys.get(children[0])!
    const last = children[children.length - 1]
    const y = (first + acc.ys.get(last)! + h(last)) / 2 - h(id) / 2
    merge(acc, { ys: new Map([[id, y]]), cont: new Map([[d, [y, y + h(id)]]]) }, 0)
    return acc
  }
  const all: Sub = { ys: new Map(), cont: new Map() }
  // Loose tiles (no connection within the selection) wait until the connected trees are laid out,
  // then stack in the first column right under its lowest tile — not under the trees' whole
  // extent, which would strand them far below.
  const loose = (id: string): boolean => !ins.get(id)!.length && !outs.get(id)!.length
  const roots = nodes
    .filter((n) => !parentOf.has(n.id) && !loose(n.id))
    .sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || rank.get(a.id)! - rank.get(b.id)!)
  for (const r of roots) {
    const sub = build(r.id)
    merge(all, sub, all.ys.size ? fit(all, sub) : 0)
  }
  // The whole layout keeps the selection's top edge.
  const top = all.ys.size ? Math.min(...all.ys.values()) : y0
  const ys = new Map([...all.ys].map(([id, y]) => [id, y - top + y0]))
  const col0 = all.cont.get(0)
  let firstColBottom = col0 ? col0[1] - top + y0 + TIDY_GAP : y0
  for (const n of [...nodes].filter((n) => loose(n.id)).sort((a, b) => a.y - b.y || a.x - b.x)) {
    ys.set(n.id, firstColBottom)
    firstColBottom += n.h + TIDY_GAP
  }
  for (const n of nodes) out.set(n.id, { x: x0 + depth.get(n.id)! * TIDY_COL, y: ys.get(n.id)! })
  return out
}
