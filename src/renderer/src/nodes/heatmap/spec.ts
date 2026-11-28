/** heatmap: its node contract (see nodes/contract.ts). */
import type { HeatmapConfig } from '../../graph/config/heatmap'
import { defineSpec } from '../contract'
import { fcHeatmapRunKey } from './runKey'

export const heatmapSpec = defineSpec<'heatmap'>({
  kind: 'heatmap',
  label: 'Heatmap',
  category: 'plotting',
  // Standardize → intensity heatmap; Compare / Curve fit → log2FC heatmap (same tile, upstream
  // decides).
  input: { accepts: ['quantity', 'comparison', 'curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): HeatmapConfig => ({ capEnabled: false, maxGenes: 50 }),
  // Its run clusters (heatmap/run.ts): a fold-change heatmap's clustering settings need another
  // run, as a Compare's statistic does — the rest only redraw. A result from before the heatmap
  // clustered in its run (a bare marker) runs again on any change.
  staleOn: (next, _prev, result) =>
    result?.kind !== 'heatmap' ||
    (!!result.fc && result.fc.key !== fcHeatmapRunKey(next as HeatmapConfig)),
  plot: {
    computes: true,
    configurable: true,
    legend: true,
    axes: true,
    quick: {
      // log₂FC heatmap: of its clustering, the linkage, leaf order and both sides' modules sit on
      // the tile by default (a gene module and a condition module pick a block together); the
      // trees are tuned in the settings window
      geneTree: false,
      condTree: false,
      condDistance: false
    }
  }
})
