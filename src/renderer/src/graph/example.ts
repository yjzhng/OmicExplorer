/** Bundled example dataset (copied from omicViz gui_test — M. tuberculosis proteomics).
 *  Written into <workflowDir>/input on first run so the demo workflow is runnable. */
import exampleData from '../engine/__fixtures__/data_long.csv?raw'
import exampleDb from '../engine/__fixtures__/83332_Mtb_DB.csv?raw'
import exampleSamplesheet from '../engine/__fixtures__/samplesheet.csv?raw'

import type { LoadConfig } from './types'

export const EXAMPLE_INPUT: { name: string; content: string }[] = [
  { name: 'data_long.csv', content: exampleData },
  { name: 'samplesheet.csv', content: exampleSamplesheet },
  { name: '83332_Mtb_DB.csv', content: exampleDb }
]

export const EXAMPLE_LOAD_CONFIG: LoadConfig = {
  data: 'data_long.csv',
  samplesheet: 'samplesheet.csv',
  db: '83332_Mtb_DB.csv'
}
