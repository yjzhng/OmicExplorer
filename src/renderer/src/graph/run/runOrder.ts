/** Run All's order: every step after all of its inputs, and each branch run to its end before the
 *  next one starts (depth-first) — so a finished branch can be viewed while the rest still run,
 *  rather than every branch waiting on one level at a time. Siblings keep the node order. */
export function runOrder(ids: string[], edges: { source: string; target: string }[]): string[] {
  const known = new Set(ids)
  const dag = edges.filter((e) => known.has(e.source) && known.has(e.target))
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const e of dag) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  const pos = new Map(ids.map((id, i) => [id, i]))
  const byPos = (a: string, b: string): number => pos.get(a)! - pos.get(b)!
  // A stack, not a queue (Kahn's sort, depth-first): the steps a finished one readies are taken
  // next. Pushed last-first, so the first sibling comes off first.
  const stack = ids.filter((id) => indeg.get(id) === 0).reverse()
  const order: string[] = []
  while (stack.length) {
    const id = stack.pop()!
    order.push(id)
    const ready: string[] = []
    for (const e of dag) {
      if (e.source !== id) continue
      const d = indeg.get(e.target)! - 1
      indeg.set(e.target, d)
      if (d === 0) ready.push(e.target)
    }
    stack.push(...ready.sort(byPos).reverse())
  }
  for (const id of ids) if (!order.includes(id)) order.push(id) // cycle safety
  return order
}

/** Every step downstream of `id` (not `id` itself). */
export function downstreamOf(id: string, edges: { source: string; target: string }[]): Set<string> {
  const out = new Set<string>()
  const todo = [id]
  while (todo.length) {
    const cur = todo.pop()!
    for (const e of edges)
      if (e.source === cur && !out.has(e.target)) {
        out.add(e.target)
        todo.push(e.target)
      }
  }
  return out
}

/** What running a target set runs, in Run all's order: the targets, and the steps above them they
 *  need — those with no up-to-date result (`stale`: not done, not already running), walked up
 *  through such steps (a done one's inputs were done when it ran) and through steps with no run of
 *  their own (`runs` false: a Subset off Load data passes its input on). One tile, a group's tiles
 *  or every step: the same run. `ids` is every step, in node order. */
export function runPlan(
  ids: string[],
  edges: { source: string; target: string }[],
  targets: Iterable<string>,
  stale: (id: string) => boolean,
  runs: (id: string) => boolean
): string[] {
  const known = new Set(ids)
  const plan = new Set([...targets].filter((t) => known.has(t)))
  const seen = new Set(plan)
  const todo = [...plan]
  while (todo.length) {
    const cur = todo.pop()!
    for (const e of edges) {
      if (e.target !== cur || seen.has(e.source) || !known.has(e.source)) continue
      seen.add(e.source)
      if (!runs(e.source)) todo.push(e.source)
      else if (stale(e.source)) {
        plan.add(e.source)
        todo.push(e.source)
      }
    }
  }
  return runOrder(
    ids.filter((id) => plan.has(id)),
    edges
  )
}
