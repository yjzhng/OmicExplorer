/**
 * Pillar #3 of the omicViz concepts (see [[omicviz-conceptual-reuse]]): which
 * plots suit which analysis / data type. Mirrors the intent of omicViz
 * PLOT_GROUPS. `implemented` flags what M1 can actually render.
 */
export type Analysis = 'standardize' | 'veh_norm' | 'direct' | 'contrast' | 'two_way_anova'

export interface PlotOption {
  plot: string
  implemented: boolean
}

const GROUPS: Record<Analysis, string[]> = {
  standardize: ['heatmap', 'pca'],
  veh_norm: ['volcano', 'MA', 'bubbleDR', 'bubbleTR', 'DR', 'TR', 'pca'],
  direct: ['volcano', 'MA', 'bubbleDR', 'bubbleTR', 'DR', 'TR', 'pca'],
  contrast: ['scatter', 'dumbbell'],
  two_way_anova: ['volcano', 'MA']
}

const IMPLEMENTED = new Set([
  'volcano',
  'heatmap',
  'pca',
  'MA',
  'DR',
  'TR',
  'bubbleDR',
  'bubbleTR',
  'scatter',
  'dumbbell'
])

/** Plots recommended for an analysis type, each flagged by whether M1 renders it. */
export function recommendedPlots(analysis: Analysis): PlotOption[] {
  return (GROUPS[analysis] ?? []).map((plot) => ({ plot, implemented: IMPLEMENTED.has(plot) }))
}
