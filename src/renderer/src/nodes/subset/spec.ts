/** subset: its node contract (see nodes/contract.ts). */
import type { SubsetConfig } from '../../graph/types'
import { defineSpec } from '../contract'

export const subsetSpec = defineSpec<'subset'>({
  kind: 'subset',
  label: 'Subset',
  subtitle: 'keep chosen conditions',
  category: 'processing',
  // Like Merge, it emits a Clean-data result (see outputKindOf), so it chains off either. Off Load
  // data it filters the raw import instead, before Clean data cleans it (see wiredKindOf).
  input: { accepts: ['import', 'quantity'] },
  output: 'quantity',
  hasRun: true,
  defaultConfig: (): SubsetConfig => ({ keep: {} })
})
