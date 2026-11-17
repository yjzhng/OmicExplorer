/** Bringing saved Clean-data results' scales in line with their steps, as a workflow is opened.
 *
 *  A Clean-data result carries the scale it's presented on (StandardizeResult.scale — see
 *  engine/scale.ts presentScaleOf), stamped by Clean data from its log-transform and passed on by a
 *  Merge or Subset. Before it was, the scale was read from the Clean data step's setting wherever it
 *  was shown, so a result saved then holds the scale it RAN with — stale when the log-transform was
 *  flipped after. Each is re-stamped here from what the graph says it should carry: a Clean data
 *  step's from its own log-transform, a Merge's from its first input, a Subset's from its input. A
 *  result already right is left the same object. */
import type { Edge } from '@xyflow/react'

import { withLogTransform, withScale, type ValueScale } from '../engine'
import { isStep, type GraphNode, type NodeResult, type StandardizeConfig } from './types'

export function restampScales(
  nodes: GraphNode[],
  edges: Edge[],
  results: Record<string, NodeResult>
): Record<string, NodeResult> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const firstInput = (id: string): string | undefined => edges.find((e) => e.target === id)?.source
  const out: Record<string, NodeResult> = { ...results }
  let changed = false
  // Each result's scale once settled (inputs first), so a chain is settled from its top.
  const settled = new Map<string, ValueScale | undefined>()
  const scaleOf = (id: string, seen: Set<string>): ValueScale | undefined => {
    if (settled.has(id)) return settled.get(id)
    const r = out[id]
    const n = byId.get(id)
    if (r?.kind !== 'standardize' || !n || !isStep(n) || seen.has(id)) return undefined
    seen.add(id)
    let std = r.std
    if (n.data.kind === 'standardize')
      std = withLogTransform(std, (n.data.config as StandardizeConfig).logTransform)
    else if (n.data.kind === 'merge' || n.data.kind === 'subset') {
      const up = firstInput(id)
      const s = up ? scaleOf(up, seen) : undefined
      if (s) std = withScale(std, s)
    }
    if (std !== r.std) {
      out[id] = { ...r, std }
      changed = true
    }
    settled.set(id, std.scale)
    return std.scale
  }
  for (const id of Object.keys(results)) scaleOf(id, new Set())
  return changed ? out : results
}
