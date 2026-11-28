/** The cluster plot's settings (PCA / UMAP …): its run, its look and its style fields. */
import type { ClusterColorBy, ConditionKey } from '../../engine'
import type { PlotAxes, QuickAccess } from './plotStyle'

/** A cluster plot's look as the two settings it now is — what marks the data, and what territory
 *  outlines it — from any config, old or new: an old 'territory' display is centroids + its saved
 *  shape (hull by default); any other old display had no outline. */
export function clusterLook(c: Pick<ClusterConfig, 'display' | 'outline' | 'territory'>): {
  data: 'replicate' | 'centroid'
  territory: 'hull' | 'gaussian' | 'none'
} {
  const display = c.display ?? 'replicate'
  return {
    data: display === 'replicate' ? 'replicate' : 'centroid',
    territory: c.outline ?? (display === 'territory' ? (c.territory ?? 'hull') : 'none')
  }
}

/** The cluster settings its run computes under: the embedding's, and — colouring by a computed
 *  clustering — the clustering's. Any change to these needs another run; the rest only redraw. */
export interface ClusterRun {
  method: ClusterConfig['method']
  scale: ClusterConfig['scale']
  missing: ClusterConfig['missing']
  center: ClusterConfig['center']
  topVar: ClusterConfig['topVar']
  transform: ClusterConfig['transform']
  replicates: ClusterConfig['replicates']
  /** set only while colouring by cluster: what the groups were computed from */
  clustering?: { on: 'coords' | 'features'; count: 'fixed' | 'conditions' | 'auto'; k?: number }
}

/** A cluster config's run settings (see ClusterRun). */
export const clusterRunOf = (c: ClusterConfig): ClusterRun => {
  const count = c.clusterCount ?? 'fixed'
  return {
    method: c.method,
    scale: c.scale,
    missing: c.missing,
    center: c.center,
    topVar: c.topVar,
    transform: c.transform,
    replicates: c.replicates,
    ...(c.colorBy === 'cluster'
      ? {
          clustering: {
            on: c.clusterOn ?? 'coords',
            count,
            ...(count === 'fixed' ? { k: c.clusterK ?? 3 } : null)
          }
        }
      : null)
  }
}

/** Whether a cluster result was computed under these settings — or a run is needed. Colouring by
 *  a condition reads any run's embedding; colouring by cluster needs the same clustering. */
export function clusterRunMatches(c: ClusterConfig, ran: ClusterRun): boolean {
  const want = clusterRunOf(c)
  const embed = (r: ClusterRun): string =>
    JSON.stringify([r.method, r.scale, r.missing, r.center, r.topVar, r.transform, r.replicates])
  if (embed(want) !== embed(ran)) return false
  return !want.clustering || JSON.stringify(want.clustering) === JSON.stringify(ran.clustering)
}

/** Sample cluster/embedding (standardize): method + coloring condition. */
export interface ClusterConfig {
  /** its categorical palette (unset = the global one, app settings → categorical) */
  categorical?: import('../../ui/color/palettes').CategoricalId
  method: 'pca' | 'umap' | 'tsne'
  /** A condition, or `'cluster'` to colour by a grouping computed from the data itself. */
  colorBy: ClusterColorBy
  /** simple legend, coloured by condition: up to two — one categorical (the colour) and one
   *  numeric, dose or time (the shade, light = low → dark = high), as QC and the gene bar do.
   *  Unset = `colorBy` alone; read only while it includes `colorBy` (see clusterColorConds). */
  colorConds?: ConditionKey[]
  /** `colorBy: 'groups'` only — the conditions whose every distinct combination is a colour
   *  (cmpd × time: a colour per compound at each time). Unset = every condition the data carries,
   *  a colour per condition group (see clusterGroupConds). */
  groupConds?: ConditionKey[]
  /** Coloured by conditions: the colour conditions picked (the settings' multi-select). `colorBy`
   *  and `groupConds` are written from it (clusterColorWrite) and are what the run and the simple
   *  drawing read; this keeps the pick itself, so colouring by cluster and back restores it.
   *  Unset (older configs) = read back from those (clusterColorPicks). */
  colorPicks?: ConditionKey[]
  /** Coloured by conditions: the numeric condition the colours fade by (light = low → dark =
   *  high), at most one and never a colour condition (see clusterFadeCond). Unset = no fade. */
  fadeCond?: ConditionKey
  /** `colorBy: 'cluster'` only — what the grouping is computed from. 'coords' clusters the embedded
   *  x/y, so colours always match the visual grouping; 'features' clusters the high-dimensional
   *  matrix, so the grouping is the real structure and is the same under PCA/UMAP/t-SNE. */
  clusterOn?: 'coords' | 'features'
  /** `colorBy: 'cluster'` only — how the group count is chosen: `clusterK`, one per distinct
   *  condition, or the largest gap in the dendrogram. */
  clusterCount?: 'fixed' | 'conditions' | 'auto'
  /** `clusterCount: 'fixed'` only — the number of groups. */
  clusterK?: number
  /** What marks the data: 'replicate' plots every replicate; 'centroid' collapses each
   *  condition's replicates to a single centroid marker. 'territory' is the older combined choice
   *  (centroid + outline) — still read, never written; see clusterLook. */
  display: 'replicate' | 'centroid' | 'territory'
  /** The region each condition's replicates occupy, drawn under the markers (with either
   *  `display`): 'hull' is the convex hull of the replicates, claiming only where measurements
   *  actually landed; 'gaussian' is a ~95% covariance ellipse, smoother and comparable across
   *  conditions but extrapolated; 'none' draws none. A condition with too few (or coincident)
   *  replicates to bound gets no outline. Unset on configs from before it existed — see
   *  clusterLook. */
  outline?: 'hull' | 'gaussian' | 'none'
  /** The older outline shape, read only while `display` is the legacy 'territory'. Kept apart from
   *  `outline` because it could linger set while unused (a shape picked, then display switched
   *  back), and reading it as an outline would draw one on a plot that never showed it. */
  territory?: 'hull' | 'gaussian'
  /** Which plot the tile draws.
   *   - 'pc' (default) — the embedding scatter.
   *   - 'scree' — variance explained per component: how many components the dataset actually
   *     carries, and so whether the 2-D scatter is a fair summary.
   *   - 'loadings' — the most influential features as vectors in the same component plane, showing
   *     WHICH measurements drive the separation rather than only that it exists.
   *  All three are PCA-only choices: UMAP/t-SNE have neither component variances nor feature axes
   *  to project onto, so the control isn't offered for them. */
  plot?: 'pc' | 'scree' | 'loadings'
  /** `plot: 'loadings'` only — how many features to draw, longest vector first. Defaults to 10;
   *  more than a handful turns the plot into a thicket of labels. */
  loadings?: number
  /** 'simple' colours by a single condition (colorBy). 'complex' drives marker aesthetics
   *  from every varying condition at once — colour by the qualitative condition(s), shade
   *  by a quantitative one, and connect a dose/time series with arrows. */
  legend?: 'simple' | 'complex'
  /** complex legend: the conditions colour is by, in order — the first picks a hue family, the
   *  rest spread within it (a single numeric one is a sequential ramp). Unset/empty = automatic
   *  (see planAesthetics). */
  schemeColor?: ConditionKey[]
  /** complex legend: the numeric condition shaded light→dark, 'none', or unset = automatic. Only a
   *  numeric condition can be ordered, so any other is ignored. */
  schemeShade?: ConditionKey | 'none'
  /** complex legend: the numeric condition connected low→high by arrows, 'none', or unset =
   *  automatic — numeric only, as shade. */
  schemeArrow?: ConditionKey | 'none'
  /** markers: replicate dots' size (px; default 8) and opacity (0–1; default 0.9), centroids'
   *  size (default 13) and opacity (default 0.95), and their outline — width (px; unset = 0 on
   *  replicates, 1.5 on centroids) and colour ('auto' = the panel's) */
  markerSize?: number
  markerOpacity?: number
  centroidSize?: number
  centroidOpacity?: number
  outlineWidth?: number
  outlineColor?: string
  /** complex legend's arrow trails: drawn (default), their line width (px; default 2) and opacity
   *  (0–1; default 0.85), the arrowheads' size (default 1), and whether the markers stay visible
   *  under them (default off: the trail stands in for them) */
  arrows?: boolean
  trailWidth?: number
  trailOpacity?: number
  arrowSize?: number
  markersUnderArrows?: boolean
  /** Per-gene scaling before embedding. 'unit' z-scores each gene to unit variance
   *  (correlation PCA — every gene weighted equally); 'none' only mean-centers, letting
   *  high-variance genes dominate (covariance PCA — matches Spectronaut). Defaults to 'unit'. */
  scale?: 'unit' | 'none'
  /** Missing-value policy. 'impute' fills gaps with the gene mean (keeps every gene); 'complete'
   *  drops any gene missing in any sample (Spectronaut-style, no imputation) — imputing instead when that
   *  leaves too few genes (MIN_COMPLETE_FEATURES). Defaults to 'complete'. */
  missing?: 'impute' | 'complete'
  /** Per-sample normalization. 'median' removes each sample's offset; 'zscore' also removes its
   *  scale (per-sample standardization, like Pearson); 'quantile' forces a common distribution;
   *  'none' leaves the log2 values as-is. Defaults to 'median'. */
  center?: 'median' | 'zscore' | 'quantile' | 'none'
  /** Feature selection: embed only the N most-variable genes (0 / undefined = all). Restricting to
   *  the most variable proteins stops p ≫ n dilution from flattening PC1. */
  topVar?: number
  /** Log transform: 'auto' (heuristic), 'log2'/'log10' (force), 'none' (linear). Defaults to
   *  'auto'. */
  transform?: 'auto' | 'log2' | 'log10' | 'none'
  /** Replicate handling: 'individual' embeds every replicate; 'mean' averages to condition means
   *  first (cuts noise, lifts a real group axis). Defaults to 'individual'. */
  replicates?: 'individual' | 'mean'
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
  /** the embedding's axes: 'standard' (default) Plotly's full axes; 'minimal' only two short
   *  segments at the bottom-left corner, each with its axis title — no ticks or numbers */
  axisMode?: 'standard' | 'minimal'
}

/** A cluster plot's marker and arrow-trail look with every default filled in (see ClusterConfig). */
export interface ClusterStyle {
  markerSize: number
  markerOpacity: number
  centroidSize: number
  centroidOpacity: number
  /** undefined = the default, DEFAULT_OUTLINE (0.5 px) */
  outlineWidth?: number
  outlineColor: string
  arrows: boolean
  trailWidth: number
  trailOpacity: number
  arrowSize: number
  markersUnderArrows: boolean
}
/** The settings ClusterStyle is made of, persisted with the tile. */
export const CLUSTER_STYLE_FIELDS = [
  'markerSize',
  'markerOpacity',
  'centroidSize',
  'centroidOpacity',
  'outlineWidth',
  'outlineColor',
  'arrows',
  'trailWidth',
  'trailOpacity',
  'arrowSize',
  'markersUnderArrows'
] as const
// One resolved look per config object (the store replaces it on any edit), so the view's memo
// keyed on it only rebuilds when a setting changed.
const clusterStyleCache = new WeakMap<object, ClusterStyle>()
export function clusterStyle(c: Partial<ClusterConfig>): ClusterStyle {
  let st = clusterStyleCache.get(c)
  if (!st)
    clusterStyleCache.set(
      c,
      (st = {
        markerSize: c.markerSize ?? 8,
        markerOpacity: c.markerOpacity ?? 0.9,
        centroidSize: c.centroidSize ?? 13,
        centroidOpacity: c.centroidOpacity ?? 0.95,
        outlineWidth: c.outlineWidth,
        outlineColor: c.outlineColor ?? 'auto',
        arrows: c.arrows ?? true,
        trailWidth: c.trailWidth ?? 2,
        trailOpacity: c.trailOpacity ?? 0.85,
        arrowSize: c.arrowSize ?? 1,
        markersUnderArrows: c.markersUnderArrows ?? false
      })
    )
  return st
}
