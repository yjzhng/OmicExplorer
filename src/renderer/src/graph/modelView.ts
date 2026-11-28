/** A step's result as the plots below it read it — a Curve fit's through its model view (see
 *  engine/modelView.ts). Read by every plot's context (nodes/kit/views/context.tsx) and by the plot
 *  runs (graph/state/run.ts), so a plot drawn live and one computed from a run see the same rows. */
import { withModelView } from '../engine'
import {
  type CompareConfig,
  type GraphNode,
  isComparisonKind,
  isStep,
  modelViewOf,
  type NodeResult
} from './types'

/** `result` (of `node`) as its plots read it: a Curve fit's through its model view (the
 *  descriptor's fold changes, or the detector's), anything else as it is. The same object per
 *  result and view, so what's keyed on it holds. */
export function viewedResult(
  result: NodeResult | undefined,
  node: GraphNode | undefined
): NodeResult | undefined {
  if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return result
  return withModelView(result, modelViewOf(node.data.config as CompareConfig))
}
