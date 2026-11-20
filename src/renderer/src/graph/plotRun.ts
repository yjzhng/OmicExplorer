/**
 * A plot's Run: computes what the plot needs to be VIEWED, so a green plot on the canvas is one the
 * results can show at once. It covers every setting the tile offers, so changing one on the tile
 * only re-renders (see each spec's `staleOn` for the few that need another run):
 *
 *  - Enrichment: every method × term source the genes carry, per facet, every tested term
 *    (engine/enrichmentAll, in the worker).
 *  - STRING: every confidence level × gene cap × interactor mode, per facet (two scans of the
 *    organism's links file per facet — see readStringAll).
 *  - Cluster: the sample embedding under its computation settings (engine/buildCluster, in the
 *    worker) — a large dataset's PCA / UMAP / t-SNE would otherwise freeze the UI as it draws.
 *    Colour by condition, plot, territory and look draw from it; the rest need a run (staleOn).
 *  - Every other plot draws straight from its upstream's result: its run checks it can (the
 *    upstream has run and meets the plot's requirement) and stores a marker.
 */
import { type ConditionKey } from '../engine'
import { PLOT_RUNS } from '../nodes/runs'
import { factsOf, unmetRequirement } from './requirements'
import { isDataResult, type NodeConfig, type NodeKind, type NodeResult } from './types'
import { NotReady } from '../shared/diagnostics'

/** Run one plot (`kind` + `config`) on its upstream's result. Throws with the reason it can't be
 *  viewed (the upstream hasn't run, a requirement isn't met, no species …) — that becomes the
 *  plot's error. `cancelled` is polled between the long steps. */
export async function runPlot(
  kind: NodeKind,
  config: NodeConfig,
  upstream: NodeResult | undefined,
  cancelled: () => boolean,
  /** the numeric conditions the upstream carries as the graph sees them (axisAvailFor) — a
   *  Contrast of Curve fits has its inputs' curve axes, which its own rows don't show */
  axes?: ConditionKey[]
): Promise<NodeResult> {
  const facts = (): ReturnType<typeof factsOf> => ({
    ...factsOf(upstream),
    ...(axes ? { axes } : null)
  })
  if (!isDataResult(upstream)) throw new NotReady('Run the step this plot reads from first.')
  // A plot that computes something of its own (nodes/<kind>/run.ts, by kind in nodes/runs.ts) —
  // the cluster's embedding and enrichment check their own requirement; STRING runs after the
  // shared check.
  const own = PLOT_RUNS[kind]
  const ctx = { kind, config, upstream, cancelled, facts }
  if (own && !own.afterRequirement) return own.run(ctx)
  const why = unmetRequirement(kind, config, facts())
  if (why) throw new NotReady(why)
  if (own) return own.run(ctx)
  // Nothing of its own to compute: it draws live from the upstream.
  return { kind: 'plot' }
}
