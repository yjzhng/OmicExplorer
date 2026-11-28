/** The fold-change heatmap's clustering settings, as its tile and its run both read them: the run
 *  builds the heatmap under these, stamped with their key, and a change to any of them needs
 *  another run (the spec's staleOn) — as a Compare's statistic does. */
import { type LeafOrder, type TopSplit } from '../../engine'
import { heatmapCapOn, type HeatmapConfig, type HeatmapLinkage } from '../../graph/config/heatmap'
import { topCountOf } from '../../graph/config/plotStyle'

export interface FcHeatmapRunOpts {
  /** the top-N cap (0 = every differential gene) */
  maxGenes: number
  topSplit?: TopSplit
  topUp?: number
  topDown?: number
  linkage: HeatmapLinkage
  leafOrder: LeafOrder
  /** cluster the comparison columns on the pattern of their changes alone */
  colPattern: boolean
}

export function fcHeatmapRunOpts(cfg: HeatmapConfig): FcHeatmapRunOpts {
  return {
    maxGenes: heatmapCapOn(cfg) ? topCountOf(cfg, cfg.maxGenes) : 0,
    topSplit: cfg.topSplit,
    topUp: cfg.topUp,
    topDown: cfg.topDown,
    linkage: cfg.linkage ?? 'ward',
    leafOrder: cfg.leafOrder ?? 'mean',
    colPattern: (cfg.condDistance ?? 'size') === 'pattern'
  }
}

/** Those settings as one string: what a run was built under. */
export const fcHeatmapRunKey = (cfg: HeatmapConfig): string => JSON.stringify(fcHeatmapRunOpts(cfg))
