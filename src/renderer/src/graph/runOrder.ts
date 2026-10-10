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
