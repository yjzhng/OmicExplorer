/** interaction: its node contract (see nodes/contract.ts). */
import type { InteractionConfig } from '../../graph/config/anovaPlots'
import { defineSpec } from '../contract'
import { needsAnova } from '../kit/requirements'

export const interactionSpec = defineSpec<'interaction'>({
  kind: 'interaction',
  label: 'Interaction',
  category: 'plotting',
  // An ANOVA's per-gene cell means across one factor, a line per level of another (others averaged).
  input: { accepts: ['comparison'] },
  output: null,
  hasRun: true,
  defaultConfig: (): InteractionConfig => ({}),
  requirement: needsAnova,
  plot: {
    tileHint: 'A gene’s cell means across the two factors. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
