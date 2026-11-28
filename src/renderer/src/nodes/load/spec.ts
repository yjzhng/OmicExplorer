/** load: its node contract (see nodes/contract.ts). */
import type { LoadConfig } from '../../graph/config/load'
import { defineSpec } from '../contract'

export const loadSpec = defineSpec<'load'>({
  kind: 'load',
  label: 'Load data',
  category: 'data',
  input: { accepts: [] },
  output: 'import',
  hasRun: false,
  defaultConfig: (): LoadConfig => ({
    mode: 'interactive',
    data: null,
    samplesheet: null,
    db: null,
    matrix: null
  })
})
