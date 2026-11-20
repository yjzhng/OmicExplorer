/** merge: its node contract (see nodes/contract.ts). */
import type { MergeConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const mergeSpec = defineSpec<'merge'>({
  kind: 'merge',
  label: 'Merge',
  subtitle: 'pool datasets into one',
  category: 'processing',
  // Chaining works without listing 'merge' here: outputKindOf resolves a Merge to the
  // standardize result it emits.
  input: { accepts: ['abundance'], max: Infinity },
  output: 'abundance',
  hasRun: true,
  defaultConfig: (): MergeConfig => ({})
})
