/**
 * The heatmaps' settings: the Clean data heatmap and the fold-change heatmap, their clustering and
 * condition bar.
 */
import type { LeafOrder, Linkage, SampleOrder } from '../../engine'
import type { PaletteRef } from '../../ui/color/palettes'
import {
  capOn,
  type FcPaletteConfig,
  type PlotAxes,
  type QuickAccess,
  type TopSplitConfig
} from './plotStyle'
import type { PlotOrient } from '../types'
import { condColorByDefault } from './coloring'

/** Heatmap: genes × samples log10 intensity (from Standardize) OR genes × comparisons log2FC
 *  (from Compare) — the tile picks the rendering from its upstream. */
export interface HeatmapConfig extends FcPaletteConfig, TopSplitConfig {
  /** from a two-way ANOVA, outside a group (in one, it follows the group's `show` pick): its
   *  overall rows — the signed 2×2 interaction fold changes (default, the diverging palette) — or
   *  its factors rows (unsigned effect sizes, the palette's upper half from 0) — one at a time, as
   *  they can't share a colour scale */
  fcRows?: 'overall' | 'factors'
  /** from Clean data: the value palette (unset = viridis). From a Compare it draws log₂FC on
   *  `fcPalette` instead. */
  valuePalette?: PaletteRef
  /** cap genes: explicit switch (undefined on older configs → inferred from maxGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N differential genes by |log2FC| (applied only while `capEnabled`). Only
   *  applies to a Compare-fed heatmap; the Standardize-fed intensity heatmap always shows the
   *  full proteome. */
  maxGenes: number
  /** Unused: an intensity heatmap now follows Clean data's log-transform setting. Kept so older
   *  saved workflows still type-check. */
  log10?: boolean
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
  /** a Clean-data heatmap's condition bar (a coloured track per condition along the samples):
   *  shown or hidden; unset = shown with few samples (see heatmapCondBar) */
  condBar?: boolean
  /** a Clean-data heatmap's sample columns: natural by condition (default) or the data's own
   *  order — see SampleOrder; read through sampleOrderOf */
  sampleOrder?: SampleOrder
  /** a fold-change heatmap's clustering linkage; unset = Ward (see HEATMAP_LINKAGES) */
  linkage?: HeatmapLinkage
  /** a fold-change heatmap's leaf order; unset = by mean (see HEATMAP_LEAF_ORDERS) */
  leafOrder?: LeafOrder
  /** what a fold-change heatmap's condition columns are clustered on: the size and pattern of
   *  their changes (unset), or the pattern alone (see HEATMAP_COND_DISTANCES) */
  condDistance?: HeatmapCondDistance
  /** A fold-change heatmap's gene clustering look: the tree cut into at most `dendroClades`
   *  clusters (unset = DENDRO_CLADES_DEFAULT), a coloured bar over each (modules), the tree itself,
   *  and the bars' palette (unset = the global categorical one). Modules and tree unset = hidden. */
  dendroClades?: number
  geneModules?: boolean
  geneTree?: boolean
  geneCategorical?: import('../../ui/color/palettes').CategoricalId
  /** …and its condition (comparison column) clustering look, likewise. */
  dendroColClades?: number
  condModules?: boolean
  condTree?: boolean
  condCategorical?: import('../../ui/color/palettes').CategoricalId
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** A Clean-data heatmap's condition bar: as set, else on while the primary condition's levels fit
 *  the palette (condColorByDefault). */
export const heatmapCondBar = (c: HeatmapConfig, levels: number): boolean =>
  c.condBar ?? condColorByDefault(levels)

/** The most clusters a fold-change heatmap's gene or condition tree is cut into (a tree of fewer
 *  rows / columns: one cluster each). */
export const DENDRO_CLADES_DEFAULT = 10

/** A fold-change heatmap's linkages (hierarchical, euclidean distance), for the settings select. */
export type HeatmapLinkage = Extract<Linkage, 'ward' | 'complete'>
export const HEATMAP_LINKAGES: Record<HeatmapLinkage, string> = {
  ward: 'Ward (compact, even-sized clusters)',
  complete: 'complete (farthest pair — tight clusters)'
}
/** What a fold-change heatmap's condition columns are clustered on (the genes: always on their
 *  changes as they are, size included). */
export type HeatmapCondDistance = 'size' | 'pattern'
export const HEATMAP_COND_DISTANCES: Record<HeatmapCondDistance, string> = {
  size: 'size and pattern (euclidean)',
  pattern: 'pattern only (correlation)'
}
/** …and its leaf orders. */
export const HEATMAP_LEAF_ORDERS: Record<LeafOrder, string> = {
  mean: 'by mean (branches low → high log₂FC)',
  optimal: 'optimal (neighbouring rows most alike)'
}

export const heatmapCapOn = (c: HeatmapConfig): boolean => capOn(c.capEnabled, c.maxGenes)
