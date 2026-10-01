import type { LogTransform, ScaleEvidence, ValueHistogram, ValueScale } from './scale'
import type { ImputeOptions, ImputeSummary } from './impute'
/** Shared types for the analysis engine. */

/** The four built-in condition axes. `cell`/`cmpd` are categorical, `dose`/`time` numeric. */
export type PresetConditionKey = 'cell' | 'cmpd' | 'dose' | 'time'
/** A user-defined condition axis (see the interactive import's Conditions step). ALWAYS
 *  categorical — its values are strings, never ordered — so it can take a grouping/facet/colour
 *  role but never a response axis, a light→dark shade or a low→high arrow.
 *
 *  The sigil is `@`, not `:`, because a result row's `cmp_cond` joins the compared condition keys
 *  with `:` and `comparisonDims` splits them back apart on it (see plotData.ts); a `:` in the key
 *  itself would be torn in half there. The slug after the sigil is both the samplesheet column
 *  name and the display label. */
export type CustomConditionKey = `@${string}`
export type ConditionKey = PresetConditionKey | CustomConditionKey

/** The built-in conditions, in hierarchy order (identity-like before covariate-like). Custom
 *  conditions are NOT here — they're data-dependent; use `condsIn`/`orderConds` for the full set. */
export const VALID_CONDITIONS: PresetConditionKey[] = ['cell', 'cmpd', 'dose', 'time']

/** Reserved samplesheet column names a custom condition may not take. */
export const RESERVED_COND_NAMES: readonly string[] = [
  ...VALID_CONDITIONS,
  'rep',
  'sample',
  'strain',
  'value',
  'peptides',
  'position',
  'plate',
  'well',
  'uniqid',
  'gene',
  'gene_label',
  'taxon'
]

export const isCustomCond = (c: ConditionKey): c is CustomConditionKey => c.charCodeAt(0) === 64
/** The samplesheet column / display name behind a custom key (`@genotype` → `genotype`). */
export const customSlug = (c: CustomConditionKey): string => c.slice(1)
export const customCond = (name: string): CustomConditionKey => `@${name}` as CustomConditionKey
/** What to call a condition on screen: its slug for a custom one, the key itself for a preset. */
export const condLabel = (c: ConditionKey): string => (isCustomCond(c) ? customSlug(c) : c)
/** Whether a condition's values are numeric and therefore ORDERED. Only dose and time are —
 *  every custom condition is categorical, so ordered channels must never be handed one. */
export const isNumericCond = (c: ConditionKey): boolean => c === 'dose' || c === 'time'
/** Whether `name` can be used as a custom condition: a lowercase identifier, not reserved. */
export const validCondName = (name: string): boolean =>
  /^[a-z][a-z0-9_]*$/.test(name) && !RESERVED_COND_NAMES.includes(name)

/** Anything carrying custom condition values — every condition-bearing row shape satisfies it. */
export interface HasExtra {
  extra?: Record<string, string>
}

/** The custom conditions these rows actually carry a value for, in first-seen order. */
export function customCondsIn(rows: ReadonlyArray<HasExtra>): CustomConditionKey[] {
  const seen: CustomConditionKey[] = []
  const have = new Set<string>()
  for (const r of rows) {
    if (r.extra == null) continue
    for (const [k, v] of Object.entries(r.extra)) {
      if (v === '' || have.has(k)) continue
      have.add(k)
      seen.push(customCond(k))
    }
  }
  return seen
}

/** Every condition these rows can carry: the presets in hierarchy order, then the customs. */
export function condsIn(rows: ReadonlyArray<HasExtra>): ConditionKey[] {
  return [...VALID_CONDITIONS, ...customCondsIn(rows)]
}

/** Put a set of conditions back into canonical order — presets by hierarchy, then customs
 *  alphabetically (a stable order independent of which row happened to be seen first). */
export function orderConds(conds: readonly ConditionKey[]): ConditionKey[] {
  const presets = VALID_CONDITIONS.filter((c) => conds.includes(c))
  const customs = conds.filter(isCustomCond).sort()
  return [...presets, ...customs]
}

/** One row of the tidy standardized table (one gene × one sample). */
export interface StandardRow {
  uniqID: string
  cell: string
  cmpd: string
  dose: number | null
  time: number | null
  rep: number | null
  /** custom condition slug → value ('' / absent = that condition doesn't apply to this row).
   *  Reached only through condValue/setCond/condPresent, like the preset columns. */
  extra?: Record<string, string>
  value: number | null
  /** optional PSM/peptide count carried through for DEqMS (unused in M1) */
  peptides?: number | null
  /** true when `value` was filled in by imputation rather than measured */
  imputed?: boolean
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
  /** samplesheet columns to read as custom conditions. The interactive import passes what the
   *  user defined; when omitted (a hand-written samplesheet) they're auto-detected — see
   *  `detectCustomConditions` in ingest.ts. */
  customConditions?: string[]
  /** clean-up: drop genes identified (non-null value) in fewer than this % of
   *  samples. 0 / undefined = keep everything. */
  minSamplePct?: number
  /** conditions the % threshold is measured WITHIN: samples are grouped by the tuple of these
   *  conditions and a gene is dropped only when its within-group coverage is below the threshold
   *  in EVERY group (clearing it in any one group keeps the gene whole — absence elsewhere may just
   *  be below the detection limit). Empty / undefined pools all samples. */
  minSamplePctBy?: ConditionKey[]
  /** fill missing values after clean-up (see impute.ts); undefined = leave them missing */
  impute?: ImputeOptions
  /** pathway name → KEGG category (global; from the interactive import). Passed straight through to
   *  the result — it's not per-row, so it can't ride the DB columns. */
  keggCategories?: Record<string, string>
  /** the log-transform to present the values on (see scale.ts); unset = the default for the
   *  detected input scale (log₁₀ for linear input, none for logged) */
  logTransform?: LogTransform
}

export interface StandardizeResult {
  rows: StandardRow[]
  /** uniqID → display label (gene name / locus_tag / uniqID) */
  displayMap: Record<string, string>
  /** uniqID → { annotation column → value } carried from the ID-map DB (e.g. GO terms,
   *  KEGG fetched in the interactive import). Empty when no DB / no annotations.
   *  Consumed by enrichment analysis; other plots ignore it. */
  annotationMap: Record<string, Record<string, string>>
  /** pathway name → KEGG category (global; passed through from the interactive import). Used by
   *  enrichment to group/colour terms. Empty when KEGG categories weren't fetched. */
  keggCategories: Record<string, string>
  /** condition columns that carry at least one non-empty value */
  activeConditions: ConditionKey[]
  /** distinct compound names found */
  compounds: string[]
  /** clean-up summary: how many genes were dropped, how many total samples the presence threshold
   *  was measured against, the threshold, and the conditions it was measured within (if any). */
  cleanup: {
    droppedGenes: number
    sampleCount: number
    minSamplePct: number
    by?: ConditionKey[]
  }
  /** imputation summary when it ran (absent = values left missing) */
  imputation?: ImputeSummary
  /** The scale the values are PRESENTED on (the table, the written CSV) — `rows` themselves are
   *  always linear (see scale.ts). Absent on results from before scales existed = linear. */
  scale?: ValueScale
  /** the scale the input arrived on, as detected (its rows were converted from it to linear) */
  inputScale?: ValueScale
  /** what that detection saw, for the message beside it */
  scaleEvidence?: ScaleEvidence
  /** the input values' distribution, as they arrived (a sample of a large matrix) */
  inputHistogram?: ValueHistogram
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
  cell?: string
  /** custom condition slug → value, carried through as context like cell/dose/time */
  extra?: Record<string, string>
  cmp_cond: string
  comparison: string
  mean1: number | null
  mean2: number | null
  sd1: number | null
  sd2: number | null
  log2FC: number | null
  /** standard error of log2FC (log2 scale) — the fold-change's uncertainty; null when < 2 reps */
  fcSE?: number | null
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
  /** the threshold the rows' calls were made with (see CompareTableResult; absent on results
   *  saved before it existed) */
  threshold?: import('./stats').ThresholdConfig
}
