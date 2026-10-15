/** Page derivation for the paged results view, kept apart from the component so it can be tested
 *  without pulling in Plotly. Every panel the dashboard would lay out in a grid becomes one page,
 *  in pipeline order, tagged with the analysis it belongs to. */
import type { Edge } from '@xyflow/react'

import { deriveTabs, expandMembers, parsePanelId, tabTitles } from '../graph/groups'
import { plotLabel, stepTitle } from '../graph/registry'
import { isStep, type GraphNode, type PlotGroupConfig, type StepNode } from '../graph/types'

export interface ResultPage {
  /** panel id — a node id, or a plot-group child id (see graph/groups) */
  panelId: string
  /** the results tab (its plot group — see deriveTabs), for its condition selection */
  groupId: string
  groupLabel: string
  title: string
}

export function derivePages(nodes: GraphNode[], edges: Edge[]): ResultPage[] {
  const byId = new Map(nodes.filter(isStep).map((n) => [n.id, n as StepNode]))
  const out: ResultPage[] = []
  const tabs = deriveTabs(nodes, edges)
  const titles = tabTitles(tabs, nodes)
  for (const g of tabs) {
    if (!byId.get(g.rootId)) continue
    // The tab's name, as the dashboard shows it — whichever layout you're in.
    const groupLabel = titles.get(g.id) ?? g.label
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
