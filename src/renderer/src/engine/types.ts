/** Shared types for the analysis engine. */

export type ConditionKey = 'strain' | 'cmpd' | 'dose' | 'time'
export const VALID_CONDITIONS: ConditionKey[] = ['strain', 'cmpd', 'dose', 'time']

/** One row of the tidy standardized table (one gene × one sample). */
export interface StandardRow {
  uniqID: string
  strain: string
  cmpd: string
  dose: number | null
  time: number | null
  rep: number | null
  value: number | null
  /** optional PSM/peptide count carried through for DEqMS (unused in M1) */
  peptides?: number | null
}

export interface StandardizeInput {
  /** raw text of the data CSV (wide or long) */
  dataText: string
  /** filename — its stem must end with _wide or _long to detect the format */
  dataFilename: string
  /** raw text of the samplesheet CSV */
  samplesheetText: string
  /** optional ID-mapping DB CSV text (organism DB); when omitted, IDs pass through */
  dbText?: string
  /** active conditions; defaults to all present */
  activeConditions?: ConditionKey[]
  /** clean-up: drop genes identified (non-null value) in fewer than this % of
   *  samples. 0 / undefined = keep everything. */
  minSamplePct?: number
}

export interface StandardizeResult {
  rows: StandardRow[]
  /** uniqID → display label (gene name / locus_tag / uniqID) */
  displayMap: Record<string, string>
  /** condition columns that carry at least one non-empty value */
  activeConditions: ConditionKey[]
  /** distinct compound names found */
  compounds: string[]
  /** clean-up summary: how many genes were dropped and how many total samples the
   *  presence threshold was measured against. */
  cleanup: { droppedGenes: number; sampleCount: number; minSamplePct: number }
}

/** A (numerator, denominator) compound pair for a comparison. */
export type Pair = [string, string]

/** Explicit per-condition value selection for one side of a comparison: condition → the
 *  chosen value(s) (as strings; numeric conditions compared value-wise). A condition absent
 *  from the map is unpinned ("any") for that side. */
export type CondSelector = Partial<Record<ConditionKey, string[]>>

/** An explicit comparison: numerator vs denominator cond-value selections, plus which of the
 *  remaining (unpinned) conditions must be matched like-for-like between the two sides. Every
 *  non-axis condition present in the numerator becomes a context facet; matched ones also
 *  constrain the denominator, unmatched ones let the denominator pool over them. */
export interface CompareInput {
  rows: StandardRow[]
  num: CondSelector
  den: CondSelector
  /** conditions (not the comparison axis) to match like-for-like; others are pooled */
  match: ConditionKey[]
  activeConditions: ConditionKey[]
  method?: 'ttest'
  transform?: boolean
  threshold?: import('./stats').ThresholdConfig
}

export interface VehNormInput {
  rows: StandardRow[]
  /** compound pairs, e.g. [["E28","DMSO"]] */
  pairs: Pair[]
  activeConditions: ConditionKey[]
  /** 'ttest' only for M1 */
  method?: 'ttest'
  /** ttest only: log2-transform before testing (omicViz default true) */
  transform?: boolean
  threshold?: import('./stats').ThresholdConfig
}

/** One row of a comparison result table (mirrors omicViz norm CSV schema). */
export interface CompareResultRow {
  uniqID: string
  cmpd: string
  dose: number | null
  time: number | null
  strain?: string
  cmp_cond: string
  comparison: string
  mean1: number | null
  mean2: number | null
  sd1: number | null
  sd2: number | null
  log2FC: number | null
  pP: number | null
  pQ: number | null
  thrsh: string
  signf: boolean
  effect: 'up' | 'down' | 'none'
}

export interface VehNormResult {
  rows: CompareResultRow[]
  /** the comparisons present, e.g. ["E28 | DMSO"] */
  comparisons: string[]
}
