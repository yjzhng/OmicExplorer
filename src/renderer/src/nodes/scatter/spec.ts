/** scatter: its node contract (see nodes/contract.ts). */
import type { ScatterConfig } from '../../graph/types'
import { defineSpec } from '../contract'
import { anova, NO_GROUP_MEANS } from '../kit/requirements'

export const scatterSpec = defineSpec<'scatter'>({
  kind: 'scatter',
  label: 'Scatter',
  category: 'plotting',
  // Contrast → FC1 vs FC2. Compare → log10 intensity of the two compared groups
  // (mean1 vs mean2), e.g. the basal clpP-vs-WT abundances from a direct comparison.
  input: { accepts: ['contrast', 'comparison'] },
  output: null,
  hasRun: true,
  defaultConfig: (): ScatterConfig => ({ capEnabled: false, labelTop: 20 }),
  requirement: (u) => (anova(u) ? NO_GROUP_MEANS : null),
  plot: {
    tileHint: 'Group A vs group B. Select to view.',
    configurable: true,
    legend: 'groups',
    axes: true,
    guides: true
  }
})
