/** Groups (canvas frames) in the step ORDER — the node list form mode shows as its column.
 *
 *  Group membership is shared by both views; form mode shows a group as a block of neighbouring
 *  steps under a header. `groupedOrder` keeps every group one block wherever the wiring allows (a
 *  step never sits above its own input — see sequence.ts), changing the user's order as little as
 *  possible. Only a group with an outside step in the middle of one of its chains can't be one
 *  block; it is split into pieces, shown as "(continued)" (see `formTree`). Pure functions. */
import { frameTiles, parentMap } from './frames'
import { orderedByWiring, type SeqEdge } from './sequence'
import type { CanvasFrame } from './types'

const ranks = (order: string[]): Map<string, number> => new Map(order.map((id, i) => [id, i]))

/** Reorder so each group's steps sit together (nested groups too), every edge still points down
 *  the list, and the order otherwise stays as it was. */
export function groupedOrder(order: string[], edges: SeqEdge[], frames: CanvasFrame[]): string[] {
  if (!frames.length) return orderedByWiring(order, edges)
  const byId = new Map(frames.map((f) => [f.id, f]))
  const parent = parentMap(frames)
  const rank = ranks(order)
  const tilesOf = (item: string): string[] =>
    byId.has(item) ? frameTiles(frames, item).filter((t) => rank.has(t)) : [item]
  const firstRank = (item: string): number => Math.min(...tilesOf(item).map((t) => rank.get(t)!))
  const byFirst = (a: string, b: string): number => firstRank(a) - firstRank(b)

  // Order one level's items (tiles and groups) as blocks, then each group's members inside it.
  const arrange = (items: string[]): string[] => {
    let level = items.filter((i) => tilesOf(i).length).sort(byFirst)
    for (;;) {
      const owner = new Map<string, string>()
      for (const item of level) for (const t of tilesOf(item)) owner.set(t, item)
      const deps = new Map<string, Set<string>>(level.map((i) => [i, new Set<string>()]))
      for (const e of edges) {
        const a = owner.get(e.source)
        const b = owner.get(e.target)
        if (a && b && a !== b) deps.get(b)!.add(a)
      }
      // Stable topological sort: repeatedly take the first block whose inputs are all placed.
      const out: string[] = []
      const placed = new Set<string>()
      const left = [...level]
      for (;;) {
        const i = left.findIndex((id) => [...deps.get(id)!].every((d) => placed.has(d)))
        if (i === -1) break
        const [id] = left.splice(i, 1)
        out.push(id)
        placed.add(id)
      }
      if (!left.length)
        return out.flatMap((i) => (byId.has(i) ? arrange(byId.get(i)!.members) : [i]))
      // Stuck: blocks feeding each other in a loop — a group with an outside step in the middle
      // of one of its chains. Split those groups into their members and order again.
      const inLoop = (start: string): boolean => {
        const seen = new Set<string>()
        const stack = [...deps.get(start)!]
        while (stack.length) {
          const d = stack.pop()!
          if (d === start) return true
          if (seen.has(d) || placed.has(d)) continue
          seen.add(d)
          stack.push(...deps.get(d)!)
        }
        return false
      }
      const split = new Set(left.filter((i) => byId.has(i) && inLoop(i)))
      if (!split.size) return [...out, ...left].flatMap(tilesOf) // a loop of steps: can't happen
      level = level
        .flatMap((i) => (split.has(i) ? byId.get(i)!.members : [i]))
        .filter((i) => tilesOf(i).length)
        .sort(byFirst)
    }
  }
  const top = [...order.filter((id) => !parent.has(id)), ...frames.map((f) => f.id)].filter(
    (id) => !parent.has(id)
  )
  return orderedByWiring(arrange(top), edges)
}

/** Form mode's column: steps, and groups (a header over their steps, nested), in list order. A
 *  group that can't be one block appears again further down, marked `continued`. */
export type FormItem =
  | { kind: 'step'; id: string }
  | { kind: 'group'; frameId: string; continued: boolean; items: FormItem[] }

export function formTree(order: string[], frames: CanvasFrame[]): FormItem[] {
  const parent = parentMap(frames)
  const root: FormItem[] = []
  const open: { frameId: string; items: FormItem[] }[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const chain: string[] = []
    for (let p = parent.get(id); p && chain.length <= frames.length; p = parent.get(p))
      chain.unshift(p)
    let k = 0
    while (k < open.length && k < chain.length && open[k].frameId === chain[k]) k++
    open.length = k
    for (const f of chain.slice(k)) {
      const g: FormItem = { kind: 'group', frameId: f, continued: seen.has(f), items: [] }
      seen.add(f)
      ;(open.length ? open[open.length - 1].items : root).push(g)
      open.push({ frameId: f, items: g.items })
    }
    ;(open.length ? open[open.length - 1].items : root).push({ kind: 'step', id })
  }
  return root
}

/** Where a dragged step or group may land: before a step, or at the end of a group (`end` = its
 *  id) or of the whole list (`end: null`). */
export type DropSlot = { before: string } | { end: string | null }

/** The order after dropping `item` (a step or a group) at `slot`, or null when the drop isn't
 *  allowed or changes nothing. Dragging never changes membership: an item lands only among its
 *  own siblings — a step in a group stays in that group, a loose step stays out of every group. */
export function dropOrder(
  order: string[],
  edges: SeqEdge[],
  frames: CanvasFrame[],
  item: string,
  slot: DropSlot
): string[] | null {
  const parent = parentMap(frames)
  const isFrame = frames.some((f) => f.id === item)
  const home = parent.get(item) // undefined: top level
  const moving = new Set(isFrame ? frameTiles(frames, item) : [item])
  const rest = order.filter((id) => !moving.has(id))
  const block = order.filter((id) => moving.has(id))
  if (!block.length) return null
  let at: number
  if ('before' in slot) {
    if (moving.has(slot.before)) return null
    // The sibling holding the target step: its ancestor right below `home`.
    let sib = slot.before
    for (let p = parent.get(sib); p !== home; p = parent.get(p)) {
      if (!p) return null // the target isn't inside `home`: it would change membership
      sib = p
    }
    const sibTiles = new Set(frames.some((f) => f.id === sib) ? frameTiles(frames, sib) : [sib])
    at = rest.findIndex((id) => sibTiles.has(id))
  } else {
    if ((slot.end ?? undefined) !== home) return null
    if (slot.end == null) at = rest.length
    else {
      const homeTiles = new Set(frameTiles(frames, slot.end))
      const last = rest.reduce((m, id, i) => (homeTiles.has(id) ? i : m), -1)
      if (last === -1) return null
      at = last + 1
    }
  }
  if (at === -1) return null
  const next = [...rest.slice(0, at), ...block, ...rest.slice(at)]
  if (next.every((id, i) => id === order[i])) return null
  const rank = ranks(next)
  if (
    edges.some(
      (e) => rank.has(e.source) && rank.has(e.target) && rank.get(e.source)! > rank.get(e.target)!
    )
  )
    return null
  return next
}
