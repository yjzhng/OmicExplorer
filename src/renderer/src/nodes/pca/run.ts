/** The cluster plot's run: the sample embedding (PCA / UMAP / t-SNE) under its computation
 *  settings, in the worker — its view settings draw from it without another run. */
import { analysisScaleOf } from '../../engine'
import { engine } from '../../engine/client'
import { holderTable } from '../../engine/lazyRows'
import { clusterRunOf, type ClusterConfig, type NodeResult } from '../../graph/types'
import { CLUSTER_LOADINGS_MAX } from '../kit/runConstants'
import type { PlotRunContext } from '../runContext'
import { NotReady } from '../../shared/diagnostics'

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const { config, upstream } = ctx
  if (upstream.kind !== 'standardize') throw new NotReady('Needs a Clean data upstream.')
  const cfg = config as ClusterConfig
  const ran = clusterRunOf(cfg)
  // a columnar table goes as its columns (none of its rows built here)
  const cluster = await engine.buildCluster(holderTable(upstream.std) ?? upstream.std.rows, {
    method: cfg.method,
    colorBy: cfg.colorBy,
    clusterOn: cfg.clusterOn,
    clusterCount: cfg.clusterCount,
    clusterK: cfg.clusterK,
    // PCA: the loadings plot's most it can show, so its count only redraws
    loadings: cfg.method === 'pca' ? CLUSTER_LOADINGS_MAX : 0,
    // the vectors labelled with the gene/protein NAME rather than the raw uniqID
    displayMap: upstream.std.displayMap,
    scale: cfg.scale,
    missing: cfg.missing,
    center: cfg.center,
    topVar: cfg.topVar,
    transform: cfg.transform,
    autoScale: analysisScaleOf(upstream.std),
    replicates: cfg.replicates
  })
  return { kind: 'cluster', cluster, ran }
}
