/** Pure plot-export planning: enumerate exportable plots and name their output files.
 *  Kept free of React/Plotly imports so it is trivially testable and cheap to import. */
import type { Edge } from '@xyflow/react'

import { GOI_TOGGLE_KINDS } from '../dashboard/goi'
import { focusIds, resolveChildFocus, resolveFocus } from '../graph/focus'
import { deriveGroups } from '../graph/groups'
import { categoryOf, NODE_SPECS } from '../graph/registry'
import {
  isStep,
  type GraphNode,
  type NodeResult,
  type PlotChild,
  type PlotGroupConfig,
  type StepNode
} from '../graph/types'

/** One exportable plot: a whole plot node, or one subcard of a group tile. */
export interface ExportSpec {
  node: StepNode
  child?: PlotChild
  /** analysis root this plot hangs off — used to give each analysis a unique folder */
  rootId: string
  /** human label for the upstream analysis this plot belongs to (the tab/group name) */
  analysis: string
  /** plot-kind label (e.g. "Volcano") */
  plot: string
  /** unique component of the filename (node id, plus child id for a group subcard) */
  key: string
  /** the plot draws all genes but has ≥1 focus gene, so a GOI-subset variant is worth exporting */
  hasGoi: boolean
}

/** Prefer the concrete comparison names for the folder/label, matching the Results tabs. */
function analysisLabel(
  rootId: string,
  fallback: string,
  results: Record<string, NodeResult>
): string {
  const r = results[rootId]
  if (r?.kind === 'compare') return r.cmp.comparisons.join(', ')
  if (r?.kind === 'contrast') return r.ctr.comparisons.join(', ')
  return fallback
}

/**
 * Enumerate exportable plots, grouped by analysis (so folder/label match the Results
 * dashboard). Group tiles are expanded into one spec per subcard. When `only` is given,
 * restrict to members whose node id is in the set (a selected group contributes all its
 * subcards).
 */
export function collectSpecs(
  nodes: GraphNode[],
  edges: Edge[],
  results: Record<string, NodeResult>,
  only?: Set<string>
): ExportSpec[] {
  const steps = nodes.filter(isStep)
  const specs: ExportSpec[] = []
  for (const g of deriveGroups(nodes, edges)) {
    const analysis = analysisLabel(g.rootId, g.label, results)
    for (const id of g.memberIds) {
      if (only && !only.has(id)) continue
      const node = nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || categoryOf(node.data.kind) !== 'plotting') continue
      if (node.data.kind === 'plotGroup') {
        for (const c of (node.data.config as PlotGroupConfig).children) {
          const genes = focusIds(resolveChildFocus(c, node.id, steps, edges))
          specs.push({
            node,
            child: c,
            rootId: g.rootId,
            analysis,
            plot: NODE_SPECS[c.kind].label,
            key: `${node.id}_${c.id}`,
            hasGoi: GOI_TOGGLE_KINDS.has(c.kind) && genes.length > 0
          })
        }
      } else {
        const genes = focusIds(resolveFocus(node.id, steps, edges))
        specs.push({
          node,
          rootId: g.rootId,
          analysis,
          plot: NODE_SPECS[node.data.kind].label,
          key: node.id,
          hasGoi: GOI_TOGGLE_KINDS.has(node.data.kind) && genes.length > 0
        })
      }
    }
  }
  return specs
}
