/** standardize: its node contract (see nodes/contract.ts). */
import type { StandardizeConfig } from '../../graph/config/standardize'
import { defineSpec } from '../contract'

export const standardizeSpec = defineSpec<'standardize'>({
  kind: 'standardize',
  label: 'Clean data',
  category: 'processing',
  // Load data (an import to read), or Clean data (a Merge, a Subset of one): a second Clean data
  // runs its clean-up, normalisation and imputation on the table it's given
  input: { accepts: ['import', 'quantity'] },
  output: 'quantity',
  hasRun: true,
  defaultConfig: (): StandardizeConfig => ({
    activeConditions: null,
    minSamplePct: 0
  })
})
