/** Renders a single tile's output (table or plot) for the results dashboard.
 *  Salvaged from the retired OutputDock's OutputBody: the per-kind dispatch and
 *  the comparison/contrast column builders live here now. */
import { type ReactNode } from 'react'

import { hasTermRows } from '../engine'
import { categoryOf } from '../graph/registry'
import { useGraph } from '../graph/store'
import { plotResultKey } from '../graph/types'
import { Empty, PlotNotRun } from '../nodes/kit/views/common'
import { type PanelBodyProps, usePlotContext } from '../nodes/kit/views/context'
import { SUBSET_TOGGLE_KINDS } from './subset'
import { VIEWS } from '../nodes/views'

/**
 * One tile's body. Tables read their own result from `results[node.id]`; plots
 * derive from the single upstream result. (Highlight-driven re-render memoization
 * is added in the linked-selection stage.)
 */
/** A 2-way ANOVA's two plot sets (see PanelBody): the directional plots read its overall 2×2 fold
 *  changes; the variance and interaction plots, its factors. */
const OVERALL_ONLY_KINDS: ReadonlySet<string> = new Set(['dr', 'bubble', 'tdr', 'enrich', 'string'])
const FACTORS_ONLY_KINDS: ReadonlySet<string> = new Set(['variance', 'interaction'])

export function PanelBody(props: PanelBodyProps): ReactNode {
  const ctx = usePlotContext(props)
  const { kind, child, node, results, upId, selectedOnly, genes, facetSel } = ctx

  if (SUBSET_TOGGLE_KINDS.has(kind) && selectedOnly && genes.length === 0)
    return <Empty text="No genes selected — pick genes in the gene menu or click them in a plot." />
  // A plot is viewed from its run (graph/plotRun.ts) — what the canvas shows green. Until it has
  // run, the tile says why it isn't drawn: not run yet, running, or the reason its run failed (a
  // requirement the upstream data doesn't meet, no species …).
  const plotRun =
    categoryOf(kind) === 'plotting' ? results[plotResultKey(node.id, child?.id)] : undefined
  if (categoryOf(kind) === 'plotting') {
    const runState = child ? (child.status ?? 'idle') : node.data.status
    const runError = child ? child.error : node.data.error
    if (runState !== 'done' || !plotRun)
      return (
        <PlotNotRun
          status={runState}
          error={runError}
          onRun={() => {
            const g = useGraph.getState()
            void (child ? g.runPlotChild(node.id, child.id) : g.runNode(node.id))
          }}
        />
      )
  }
  // A 2-way ANOVA's two plot sets, each following the group's `show` pick: the overall 2×2 fold
  // changes (the directional plots) and the factors (variance, interaction). A tile of the other set
  // says so rather than drawing the wrong rows.
  const rawUp = upId ? results[upId] : undefined
  if (facetSel && rawUp?.kind === 'compare' && hasTermRows(rawUp.cmp)) {
    const factorsOn = facetSel.show === 'factors'
    if (factorsOn && OVERALL_ONLY_KINDS.has(kind))
      return <Empty text="Shows the overall fold changes — switch show to overall." />
    if (!factorsOn && FACTORS_ONLY_KINDS.has(kind))
      return <Empty text="Shows the factors — switch show to factors." />
  }
  // The kind's own body (nodes/<kind>/View.tsx, by kind in nodes/views.ts).
  const view = VIEWS[kind]
  if (view) return view({ ...ctx, plotRun, rawUp })

  return <Empty text="No output." />
}
