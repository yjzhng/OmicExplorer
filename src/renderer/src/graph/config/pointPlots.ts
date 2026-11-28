/** The point plots' settings: Volcano, contrast Scatter and MA. */
import { capOn, type FcPaletteConfig, type PlotAxes, type PointStyle } from './plotStyle'
import type { PotencyConfig } from './dr'

/** Volcano (compare). The y-axis stat (−log10 p vs q) follows the upstream Compare's threshold
 *  `statType`, so the drawn guide matches the calls — it isn't a per-tile choice. */
export interface VolcanoConfig extends FcPaletteConfig {
  /** cap labels: explicit switch (undefined on older configs → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N most significant genes (applied only while `capEnabled`);
   *  otherwise the placement layer labels as many significant genes as fit. */
  labelTop: number
  /** draw genes with a fold change but no p-value (a reference protein, one too thin to test) at 0
   *  on the significance axis, rather than leave them out */
  untestedAtZero?: boolean
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Contrast scatter (FC1 vs FC2); labels the top-N most divergent genes. */
export interface ScatterConfig extends FcPaletteConfig {
  /** cap labels: explicit switch (undefined on older configs → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N most divergent genes (applied only while `capEnabled`) */
  labelTop: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
export const labelCapOn = (c: VolcanoConfig | ScatterConfig | PotencyConfig | MAConfig): boolean =>
  capOn(c.capEnabled, c.labelTop)

/** MA plot (compare): mean abundance vs log2FC, with fold-change guide lines. */
export interface MAConfig extends FcPaletteConfig {
  fcLow: number
  fcHigh: number
  /** cap labels: explicit switch (undefined → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N genes by |log₂FC| (applied only while `capEnabled`);
   *  otherwise the placement layer labels as many significant genes as fit */
  labelTop?: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
