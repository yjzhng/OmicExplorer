/** heatmap: its node contract (see nodes/contract.ts). */
import type { HeatmapConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const heatmapSpec = defineSpec<'heatmap'>({
  kind: 'heatmap',
  label: 'Heatmap',
  category: 'plotting',
  // Standardize → intensity heatmap; Compare / Curve fit → log2FC heatmap (same tile, upstream
  // decides).
  input: { accepts: ['abundance', 'comparison', 'curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): HeatmapConfig => ({ capEnabled: false, maxGenes: 50 }),
  plot: {
    configurable: true,
    legend: true,
    axes: true,
    quick: {
      // log₂FC heatmap: of its clustering, the linkage, leaf order and both sides' modules sit on
      // the tile by default (a gene module and a condition module pick a block together); the
      // trees are tuned in the settings window
      geneTree: false,
      condTree: false
    }
  }
})
