/** The gene plots' settings: Bubble grid, Dumbbell, Gene bar and Table. */
import type { ConditionKey, SampleOrder } from '../../engine'
import type { PaletteRef } from '../../ui/color/palettes'
import {
  capOn,
  type FcPaletteConfig,
  type PlotAxes,
  type PlotEffectColors,
  type QuickAccess,
  type TopSplitConfig
} from './plotStyle'
import type { PlotOrient } from '../types'
import type { DRConfig } from './dr'

/** Bubble grid (compare) over dose or time, one gene per row. */
export interface BubbleConfig extends FcPaletteConfig, TopSplitConfig {
  axis: ConditionKey
  /** the up / down / none colours, this plot's own; unset (or 'auto') = from its FC palette */
  effectColors?: PlotEffectColors
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N by |log2FC| (applied only while `capEnabled`; otherwise all, up to the
   *  renderer's safety cap) */
  topGenes: number
  /** what ranks the top genes: their log₂FC ('fc', default) or the significance column the
   *  upstream Compare calls by ('sig' — its P or Q value) */
  rank?: 'fc' | 'sig'
  /** that score over the dose/time levels: its peak ('peak', default) or its total */
  over?: 'peak' | 'total'
  /** what a bubble's size shows: |log₂FC| ('fc', default) or −log₁₀ of the Compare's P or Q */
  sizeBy?: 'fc' | 'sig'
  /** what its colour shows: log₂FC on the FC palette ('fc', default), or −log₁₀ P/Q on `sigPalette` */
  colorBy?: 'fc' | 'sig'
  /** the palette −log₁₀ P/Q is coloured on (unset = Purples, BUBBLE_SIG_PALETTE) */
  sigPalette?: PaletteRef
  /** what its outline's width shows: nothing ('none', default — no outline), |log₂FC| or −log₁₀ P/Q */
  outlineBy?: 'none' | 'fc' | 'sig'
  /** the outline's colour (unset or 'auto' = a darker shade of each bubble's own colour) */
  outlineColor?: string
  /** a ∗ at the centre of each bubble significant at its level */
  asterisk?: boolean
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Dumbbell (contrast): FC1↔FC2 per gene, top-N by |FCdiff|. */
export interface DumbbellConfig extends TopSplitConfig {
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N significant genes by |FCdiff| (applied only while `capEnabled`; otherwise
   *  all significant, up to the renderer's safety cap) */
  topGenes: number
  /** gene order: by the first side's value, the second side's, or |FCdiff| (unset = 'diff') */
  order?: 'fc1' | 'fc2' | 'diff'
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
export const geneCapOn = (c: BubbleConfig | DumbbellConfig | DRConfig): boolean =>
  capOn(c.capEnabled, c.topGenes)

/** Gene bar (standardize): each selected gene's value across every condition. */
export interface BarConfig {
  /** its categorical palette (unset = the global one, app settings → categorical) */
  categorical?: import('../../ui/color/palettes').CategoricalId
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
  /** the value axis scaled to each gene's own values — its min to its max (default) — or to the
   *  whole dataset's, so paging genes keeps one scale */
  yScale?: 'global' | 'gene'
  /** the conditions along the axis: natural by condition (default) or the data's own order */
  sampleOrder?: SampleOrder
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** each replicate drawn as a dot over its bar (on for a new tile — the spec's default) */
  replicates?: boolean
  /** replicate dot size (px; default 6) and opacity (0–1; default 0.6) */
  repSize?: number
  repOpacity?: number
  /** replicate dot colour: 'auto' (default) = its bar's group colour (without the numeric
   *  condition's shade), else a fixed colour */
  repColor?: string
  /** replicate dots spread sideways across the bar (default) or in one column over its centre */
  repJitter?: boolean
  /** the error bars: standard deviation (default), standard error of the mean, or 95% CI */
  error?: 'sd' | 'sem' | 'ci95'
  /** error bar line width (px; default 1.4) */
  errorWidth?: number
  /** error bar colour: 'auto' (default) = its bar's group colour (without the numeric condition's
   *  shade), else a fixed colour */
  errorColor?: string
  /** bar fill: by value or by condition (`colorConds`); unset = by condition with few samples, by
   *  value with many. An older config may hold a single condition key here — read it through
   *  barColoring. */
  colorBy?: 'value' | 'condition' | ConditionKey
  /** Older configs' colour by condition: up to two — one categorical (the colour) and one numeric
   *  (the fade). Read back through conditionColoring; new picks go to colorPicks / fadeCond. */
  colorConds?: ConditionKey[]
  /** colour by condition: the conditions the colours stand for (see conditionColoring) */
  colorPicks?: ConditionKey[]
  /** colour by condition: the numeric condition fading them, at most one */
  fadeCond?: ConditionKey
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Data-table tile (plotting): shows the upstream step's results table interactively in the
 *  dashboard. The upstream step already computes the table; this node just opts a tile in. */
export interface TableConfig {
  /** the view for tables that offer a Long ⇆ Matrix toggle (standardize/compare/contrast) — and,
   *  of Clean data, its per-sample QC; absent = matrix. A Clean data table's in-tile switch writes
   *  it (so its download is the view on show); the others start on it. */
  view?: 'long' | 'matrix' | 'qc'
  /** the gene column's display cap in characters (longer names cut with "…", in full on hover);
   *  unset = TABLE_GENE_MAX */
  geneMaxLen?: number
  /** the same for the uniqID column; unset = TABLE_GENE_MAX */
  idMaxLen?: number
  /** colour the value cells (default on) */
  colored?: boolean
  /** the cells' palette (unset: viridis for Clean data's abundance, RdBu reversed for a Compare's
   *  or Contrast's signed values) */
  palette?: PaletteRef
}
/** The table's default display cap for its uniqID and gene columns (TableConfig.idMaxLen /
 *  geneMaxLen). */
export const TABLE_GENE_MAX = 20
