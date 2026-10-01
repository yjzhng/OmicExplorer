/**
 * Whether a step can be run yet.
 *
 * A step reads its inputs from its upstreams' RESULTS, so running one before those exist just
 * produces the error it was always going to produce ("Connect and run a Clean data tile upstream").
 * Offering the action anyway makes the pipeline look ready when it isn't.
 *
 * Steps that never run are not prerequisites: a Load tile holds file references rather than a
 * computed result, so it stays `idle` forever and would otherwise block everything behind it.
 */
import { NODE_SPECS } from './registry'
import { isStep, type GraphNode, type StepNode } from './types'

/** The upstream steps of `id` that still have to run, in graph order. Empty = clear to run. */
export function pendingInputs(
  id: string,
  nodes: GraphNode[],
  edges: { source: string; target: string }[]
): StepNode[] {
  const byId = new Map(nodes.filter(isStep).map((n) => [n.id, n as StepNode]))
  const out: StepNode[] = []
  for (const e of edges) {
    if (e.target !== id) continue
    const up = byId.get(e.source)
    if (!up || out.includes(up)) continue
    if (NODE_SPECS[up.data.kind].hasRun && up.data.status !== 'done') out.push(up)
  }
  return out
}
