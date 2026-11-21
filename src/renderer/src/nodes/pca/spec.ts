/** pca: its node contract (see nodes/contract.ts). */
import { type ClusterConfig, clusterRunMatches } from '../../graph/types'
import { defineSpec } from '../contract'

export const pcaSpec = defineSpec<'pca'>({
  kind: 'pca',
  label: 'Cluster',
  category: 'plotting',
  // Sample-level embedding of the clean intensities only; a fold-change "responsome" embedding
  // (Compare-fed) reads differently enough that it isn't offered here.
  input: { accepts: ['quantity'] },
  output: null,
  hasRun: true,
  // Defaults chosen to match a standard tool's PCA (e.g. Spectronaut): covariance (no per-gene
  // scaling), complete cases only (no imputation), log2, individual replicates, no per-sample
  // normalization. `display: 'replicate'` shows every data point — the raw scatter is what a PCA
  // is usually read from; the centroid + territory view is a summary to switch up to.
  defaultConfig: (): ClusterConfig => ({
    method: 'pca',
    colorBy: 'cmpd',
    display: 'replicate',
    territory: 'hull',
    plot: 'pc',
    loadings: 10,
    clusterOn: 'coords',
    clusterCount: 'fixed',
    clusterK: 3,
    legend: 'simple',
    scale: 'none',
    missing: 'complete',
    center: 'none',
    topVar: 0,
    transform: 'auto',
    replicates: 'individual'
  }),
  // Cluster: the embedding's settings (and, colouring by cluster, the clustering's) need another
  // run; colour by a condition, the plot, territory and look only redraw (clusterRunMatches).
  staleOn: (next, _prev, result) =>
    result?.kind !== 'cluster' || !clusterRunMatches(next as ClusterConfig, result.ran),
  plot: {
    tileHint: 'Cluster samples or responsome (PCA/UMAP/t-SNE). Select to view.',
    configurable: true,
    legend: true,
    axes: true,
    computes: true,
    quick: { clusterOn: false, clusterCount: false, display: false }
  }
})
