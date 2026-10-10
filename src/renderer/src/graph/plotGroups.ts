/** Every visualisation tile is a plot group — one with a single plot included — so adding a second
 *  plot is just adding to the group, never a change of tile type. These helpers wrap a lone plot
 *  in a group of one, for new tiles and for projects saved before the rule. */
import type { PanelLayoutItem } from './types'
import { childPanelId } from './groups'
import { categoryOf } from './registry'
import { isStep, type GraphNode, type PlotGroupConfig, type StepNode } from './types'

/** A plot kind that, standing alone, belongs inside a group (everything plotting but the group). */
export const isLonePlot = (n: GraphNode): n is StepNode =>
  isStep(n) && categoryOf(n.data.kind) === 'plotting' && n.data.kind !== 'plotGroup'

/** The same tile — id, position, name — as a group holding its plot as subcard `childId`. */
export function wrapPlot(node: StepNode, childId: string): StepNode {
  const config: PlotGroupConfig = {
    children: [{ id: childId, kind: node.data.kind, config: structuredClone(node.data.config) }]
  }
  return {
    ...node,
    data: {
      kind: 'plotGroup',
      config,
      status: 'idle',
      ...(node.data.name ? { name: node.data.name } : {})
    }
  }
}

/** Wrap every lone plot among `nodes`, minting subcard ids from `nextId`. Its results-dashboard
 *  tile moves with it: the panel id a plot had (its node id) becomes its subcard's. */
export function wrapLonePlots(
  nodes: GraphNode[],
  nextId: number,
  layouts: Record<string, PanelLayoutItem[]>
): { nodes: GraphNode[]; nextId: number; layouts: Record<string, PanelLayoutItem[]> } {
  const remap = new Map<string, string>()
  let id = nextId
  const out = nodes.map((n) => {
    if (!isLonePlot(n)) return n
    const childId = `sub-${id++}`
    remap.set(n.id, childPanelId(n.id, childId))
    return wrapPlot(n, childId)
  })
  if (!remap.size) return { nodes, nextId, layouts }
  const moved = Object.fromEntries(
    Object.entries(layouts).map(([root, items]) => [
      root,
      items.map((it) => (remap.has(it.i) ? { ...it, i: remap.get(it.i)! } : it))
    ])
  )
  return { nodes: out, nextId: id, layouts: moved }
}
