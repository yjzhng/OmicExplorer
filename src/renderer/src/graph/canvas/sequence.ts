/**
 * A step never sits before one of its inputs.
 *
 * The node list is the user's own order, and the form layout presents it as a sequence built top to
 * bottom — which is only meaningful if the wiring agrees with it. The constraint exists FOR that
 * presentation, but it is maintained for the whole app rather than in form mode alone: an edge
 * drawn on the canvas reorders the list the same way one picked in a form does (see the store's
 * `onConnect`). There is no such thing as a graph that only obeys the rule in one view.
 *
 * So `orderedByWiring` is the guarantee, and the other two are the form's UI resting on it: only
 * earlier steps are offered as inputs, and a drag can't move a section past its own wiring.
 */
export interface SeqEdge {
  source: string
  target: string
}

/** Position of each id in the user's order, for O(1) before/after tests. */
const ranks = (order: string[]): Map<string, number> => new Map(order.map((id, i) => [id, i]))

/** The steps `id` may take as input: those above it, plus whatever it is ALREADY wired to.
 *
 *  The second half should be redundant — `orderedByWiring` puts every input above the step it feeds
 *  — but it is not merely defensive. A `<select>` whose value is absent from its options renders
 *  blank, so if the invariant is ever missed the picker shows "no input" for a step that has one,
 *  and the next click through it silently drops the edge. The UI must never contradict the graph,
 *  even when the graph is in a state it shouldn't be. */
export function eligibleInputs(id: string, order: string[], edges: SeqEdge[]): string[] {
  const self = ranks(order).get(id)
  if (self === undefined) return []
  const current = new Set(edges.filter((e) => e.target === id).map((e) => e.source))
  return order.filter((o, i) => o !== id && (i < self || current.has(o)))
}

/** Reorder so every edge points down the list, disturbing the given order as little as possible: a
 *  stable topological sort that repeatedly takes the FIRST step whose inputs are all placed. The
 *  user's sequence survives wherever the wiring allows it, and only a step sitting above one of its
 *  inputs moves.
 *
 *  A cycle can't be ordered at all; its members are appended in their original order rather than
 *  dropped, so nothing ever disappears from the list. */
export function orderedByWiring(order: string[], edges: SeqEdge[]): string[] {
  const ids = new Set(order)
  const inputs = new Map<string, Set<string>>(order.map((id) => [id, new Set<string>()]))
  for (const e of edges)
    if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
      inputs.get(e.target)?.add(e.source)
  const out: string[] = []
  const placed = new Set<string>()
  const left = [...order]
  while (left.length) {
    const i = left.findIndex((id) => [...(inputs.get(id) ?? [])].every((p) => placed.has(p)))
    if (i === -1) break // only cycles remain
    const [id] = left.splice(i, 1)
    out.push(id)
    placed.add(id)
  }
  return [...out, ...left]
}

/** Whether dropping `id` just before `beforeId` (null = the end) is a move worth making: it must
 *  change the order, and must not put the step above one of its inputs or below one of its outputs.
 *  A drop that changes nothing is refused here so the drag indicator never lights up on a slot the
 *  step already occupies; `moveStep` guards the same case again, for callers that aren't a drag. */
export function canMoveBefore(
  id: string,
  beforeId: string | null,
  order: string[],
  edges: SeqEdge[]
): boolean {
  if (id === beforeId) return false
  const rest = order.filter((o) => o !== id)
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId)
  if (at === -1) return false
  const next = [...rest.slice(0, at), id, ...rest.slice(at)]
  if (next.every((o, i) => o === order[i])) return false
  const rank = ranks(next)
  const self = rank.get(id) as number
  for (const e of edges) {
    if (e.target === id && (rank.get(e.source) ?? -1) > self) return false
    if (e.source === id && (rank.get(e.target) ?? Infinity) < self) return false
  }
  return true
}

/** The drop slots `id` can't take while it's being dragged — each keyed by the step it would land
 *  above (null = the end). Unlike `canMoveBefore`, a no-op is NOT blocked: the slots right above
 *  and below the step are where it already is, and greying those would read as "can't stay put".
 *  What's left is the stretch above its inputs and below its outputs. */
export function blockedDrops(id: string, order: string[], edges: SeqEdge[]): Set<string | null> {
  const i = order.indexOf(id)
  const out = new Set<string | null>()
  if (i === -1) return out
  const own = new Set<string | null>([id, i + 1 < order.length ? order[i + 1] : null])
  for (const slot of [...order, null])
    if (!own.has(slot) && !canMoveBefore(id, slot, order, edges)) out.add(slot)
  return out
}
