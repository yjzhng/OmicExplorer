/** plotGroup: its node contract (see nodes/contract.ts). */
import type { PlotGroupConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const plotGroupSpec = defineSpec<'plotGroup'>({
  kind: 'plotGroup',
  label: 'Plot',
  category: 'plotting',
  // Union of every plotting op's inputs, so a group can wire from any of them; all its
  // children must be compatible with the single upstream it actually binds to.
  input: { accepts: ['abundance', 'comparison', 'curves', 'contrast'] },
  output: null,
  hasRun: true,
  defaultConfig: (): PlotGroupConfig => ({ children: [] })
})
