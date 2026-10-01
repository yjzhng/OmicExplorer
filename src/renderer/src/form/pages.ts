/** Page derivation for the paged results view, kept apart from the component so it can be tested
 *  without pulling in Plotly. Every panel the dashboard would lay out in a grid becomes one page,
 *  in pipeline order, tagged with the analysis it belongs to. */
import type { Edge } from '@xyflow/react'

import { deriveGroups, expandMembers, parsePanelId } from '../graph/groups'
import { plotLabel, stepTitle } from '../graph/registry'
import { isStep, type GraphNode, type PlotGroupConfig, type StepNode } from '../graph/types'

export interface ResultPage {
  /** panel id — a node id, or a plot-group child id (see graph/groups) */
  panelId: string
  /** the analysis group, for the shared facet selection */
  groupId: string
  groupLabel: string
  title: string
}

export function derivePages(nodes: GraphNode[], edges: Edge[]): ResultPage[] {
  const byId = new Map(nodes.filter(isStep).map((n) => [n.id, n as StepNode]))
  const out: ResultPage[] = []
  for (const g of deriveGroups(nodes, edges)) {
    const root = byId.get(g.rootId)
    if (!root) continue
    // The step's own name when it has one, matching the dashboard's tab labels — a renamed
    // Compare should read the same whichever layout you're in.
    const groupLabel = stepTitle(root)
    for (const panelId of expandMembers(g.memberIds, nodes)) {
      const { nodeId, childId } = parsePanelId(panelId)
      const n = byId.get(nodeId)
      if (!n) continue
      const child = childId
        ? (n.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
        : undefined
      // A stale child id (subcard removed since a layout was saved) has nothing to render.
      if (childId && !child) continue
      out.push({
        panelId,
        groupId: g.id,
        groupLabel,
        // A plot-group child has no name of its own (PlotChild carries only kind + config), so it
        // stays on its type label; a standalone tile uses whatever it's been renamed to.
        title: child ? plotLabel(child.kind, child.config) : stepTitle(n)
      })
    }
  }
  return out
}
