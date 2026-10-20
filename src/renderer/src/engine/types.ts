import type { LogTransform, ScaleEvidence, ValueHistogram, ValueScale } from './scale'
import type { ImputeOptions, ImputeSummary } from './impute'
import type { NormalizeOptions, NormalizeSummary } from './normalize'
/** Shared types for the analysis engine. */

/** The four built-in condition axes. `cell`/`cmpd` are categorical, `dose`/`time` numeric. */
export type PresetConditionKey = 'cell' | 'cmpd' | 'dose' | 'time'
/** A user-defined condition axis (see the interactive import's Conditions step). Categorical —
 *  its values are labels, never ordered, taking a grouping/facet/colour role only — unless the
 *  import declared it numeric (NumericConds): then it is ordered, like dose and time. Its values are
 *  strings either way (a numeric one read through numValue).
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
/**
 * The conditions a dataset declares numeric — its condition schema: dose and time always (their
 * values are numbers by the data format), plus the custom ones declared numeric at import. Carried
 * on Clean data (StandardizeResult.numericConditions; numericOf reads it) and handed to everything
 * that asks isNumericCond, so a numeric custom condition is ordered wherever its data goes.
 */
export type NumericConds = ReadonlySet<ConditionKey>

/** A dataset's numeric conditions from its declared numeric custom ones (dose and time always). */
export function numericConds(customs: readonly CustomConditionKey[] = []): NumericConds {
  return new Set<ConditionKey>(['dose', 'time', ...customs])
}

/** The numeric conditions of a Clean data result (absent — none declared, or a result from before
 *  declarations — dose and time only). */
export const numericOf = (
  std: { numericConditions?: readonly CustomConditionKey[] } | null | undefined
): NumericConds => numericConds(std?.numericConditions)

/** Whether a condition's values are numeric and therefore ORDERED, in a dataset with these numeric
 *  conditions (`numeric`, its schema — required, so no caller can forget the custom ones). Ordered
 *  channels (a response axis, a light→dark shade, a low→high arrow) must only take one of these. */
export const isNumericCond = (c: ConditionKey, numeric: NumericConds): boolean => numeric.has(c)
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
  /** filename, e.g. `mydata_datamatrix.csv`; wide vs long is read from the columns */
  dataFilename: string
  /** raw text of the samplesheet CSV */
  samplesheetText: string
  /** optional ID-mapping DB CSV text (organism DB); when omitted, IDs pass through */
  dbText?: string
  /** active conditions; defaults to all present */
  activeConditions?: ConditionKey[]
  /** Subset steps between Load data and Clean data: only the samples every filter keeps are read
   *  (conditions, replicates, samples left out — subset.ts SampleFilter), so the clean-up below
   *  sees just those. Unset = every sample. */
  subsets?: import('./subset').SampleFilter[]
  /** samplesheet columns to read as custom conditions. The interactive import passes what the
   *  user defined; when omitted (a hand-written samplesheet) they're auto-detected — see
   *  `detectCustomConditions` in ingest.ts. */
  customConditions?: string[]
  /** of those, the ones declared numeric (the import's cat/num chip): their values must be numbers,
   *  and the result lists them (StandardizeResult.numericConditions) */
  numericConditions?: string[]
  /** clean-up: drop genes identified (non-null value) in fewer than this % of
   *  samples. 0 / undefined = keep everything. */
  minSamplePct?: number
  /** conditions the % threshold is measured WITHIN: samples are grouped by the tuple of these
   *  conditions and a gene is dropped only when its within-group coverage is below the threshold
   *  in EVERY group (clearing it in any one group keeps the gene whole — absence elsewhere may just
   *  be below the detection limit). Empty / undefined pools all samples. */
  minSamplePctBy?: ConditionKey[]
  /** median-normalise the samples after clean-up, before imputation (see normalize.ts);
   *  undefined = leave them as they arrived */
  normalize?: NormalizeOptions
  /** fill missing values after clean-up (see impute.ts); undefined = leave them missing */
  impute?: ImputeOptions
  /** pathway name → KEGG category (global; from the interactive import). Passed straight through to
   *  the result — it's not per-row, so it can't ride the DB columns. */
  keggCategories?: Record<string, string>
  /** the log-transform to present the values on (see scale.ts); unset = the default for the
   *  detected input scale (log₁₀ for linear input, none for logged) */
  logTransform?: LogTransform
}

/** One sample as the samplesheet gave it: its conditions and replicate. */
export interface SampleConds {
  sample: string
  cell: string
  cmpd: string
  dose: number | null
  time: number | null
  rep: number | null
  extra?: Record<string, string>
}

export interface StandardizeResult {
  rows: StandardRow[]
  /** every sample with its conditions — the small sample space behind the gene × sample rows (what
   *  the data's shape is read from; see dataShape). Absent on results from before it was kept. */
  samples?: SampleConds[]
  /** uniqID → display label (gene name / locus / uniqID) */
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
  /** the custom conditions declared numeric (of the active ones) — the dataset's condition schema
   *  with dose and time (numericOf). Absent = none (a result from before declarations). */
  numericConditions?: CustomConditionKey[]
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
  /** normalisation summary when it ran (absent = not normalised) */
  normalization?: NormalizeSummary
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
  /** the compared conditions, stated by the Compare dialog (several allowed). Absent = inferred from
   *  the pins: the one condition both sides pin to different values (configs saved before). */
  compared?: ConditionKey[]
  /** conditions merged into one group on BOTH sides: not split on the numerator, not matched on the
   *  denominator. Absent = none (an unmatched condition still splits the numerator). */
  pool?: ConditionKey[]
  activeConditions: ConditionKey[]
  /** the dataset's custom conditions declared numeric (its Clean data's numericConditions; dose and
   *  time are always numeric) — its condition schema, numericConds(…) */
  numericConditions: readonly CustomConditionKey[]
  method?: 'ttest'
  transform?: boolean
  threshold?: import('./stats').ThresholdConfig
  /** curve fit only: the numeric condition the curve runs over (dose). It is the fit's x-axis, so
   *  neither a facet nor matched — each numerator group pools every level of it into one curve. */
  curveAxis?: ConditionKey
  /** curve fit: the axis's scale as the Curve fit confirmed it (log / linear). Absent = the one its
   *  levels' spacing shows (detectScale), else the axis's preset. Both methods follow it. */
  axisScale?: import('./axisModel').AxisScale
  /** curve fit: what the baseline is to the curve, as the Curve fit set it — 'reference' (a control
   *  off the curve, the vehicle) or 'matched' (the curve's own first point: t₀, the lowest
   *  temperature). Absent = the axis's preset (dose reference, time matched, any other reference).
   *  Both methods follow it. */
  axisBaseline?: import('./axisModel').AxisBaseline
  /** curve fit: each axis's scale / baseline as set, per condition — every axis a surface runs over
   *  (a one-axis curve: `axisScale` / `axisBaseline` win). Absent: detected / the preset. */
  axisScales?: Partial<Record<ConditionKey, import('./axisModel').AxisScale>>
  axisBaselines?: Partial<Record<ConditionKey, import('./axisModel').AxisBaseline>>
  /** curve fit: each axis's models — detector, descriptor, a surface's coupling (AxisFit). Absent:
   *  the method's. */
  axisFits?: Partial<Record<ConditionKey, import('./axisModel').AxisFit>>
  /** curve fit: the whole axis model, overriding `axisScale`, `axisBaseline` and the preset
   *  (axisModel.ts) — for tests; the app sets `axisScale` / `axisBaseline` only */
  axisModel?: import('./axisModel').AxisModel
  /** curve fit, every model and axis: CurveCurator's interpolation (`interpolation = true`) — every
   *  4PL fit also sees points midway between the measured levels (a surface: one per grid cell),
   *  read off straight lines between the measured values; SSEs stay on the real points. 4PL: the
   *  detector's fits, decoys and simulated nulls alike (fitCurve, surfaceJoint). Hybrid: only the
   *  description's 4PL — the spline detector, and so the calls, never see it. */
  interpolation?: boolean
  /** curve fit: describe every curve / surface, or only those within DESCRIBE_Q (responders).
   *  Unset: the response surface method describes responders; a 4PL curve every curve (its 4PL is
   *  its test — responders only marks the rest `described: false`, their test kept). */
  describeAll?: boolean
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

/** A curve's final model: the fitted 4-parameter logistic, or M0 — flat, the mean ratio — when
 *  the 4PL's F-test doesn't reject that flat null. */
export type CurveModel = '4PL' | 'M0'

/** One row of a comparison result table (mirrors omicViz norm CSV schema). */
/** An ANOVA term row (see CompareResultRow.term): unsigned, so not a fold change. */
export const isTermRow = (r: { term?: unknown }): boolean => r.term != null

/** An ANOVA's overall row over two or more factors: their interaction (a 2×2, 2×2×2 …), its log2FC
 *  a fold change of fold changes — a one-way ANOVA's are a level against the control. */
export const isInteractionRow = (r: {
  term?: unknown
  slope?: unknown
  cmp_cond?: string
}): boolean => !isTermRow(r) && r.slope == null && String(r.cmp_cond ?? '').includes(':')

/** An ANOVA's overall row through a slope (CompareResultRow.slope): a per-unit change. */
export const isSlopeRow = (r: { slope?: unknown }): boolean => r.slope != null

/** The rows with a signed fold change — every Compare row but a two-way ANOVA's term rows. For the
 *  readers that need a direction (DR, bubble, enrichment's up / down, Contrast sides …). Returns
 *  the same array when there are none, so memos keyed on it hold. */
export function termless<R extends { term?: unknown }>(rows: R[]): R[] {
  return rows.some(isTermRow) ? rows.filter((r) => !isTermRow(r)) : rows
}

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
  /** two-way ANOVA only: a model term's row — `comparison` is the term ("cmpd", "cmpd × cell"),
   *  `log2FC` its UNSIGNED effect size (the term's RMS contribution, log₂; ≥ 0), pP / pQ its F-test.
   *  Never a signed fold change: termless() keeps these rows from every reader that needs one. */
  term?: true
  /** ANOVA: an overall row through a slope — `log2FC` a change per unit of the numeric condition
   *  (per decade on a log axis), or with factors a difference of such slopes; it carries no value
   *  of that condition */
  slope?: true
  /** two-way ANOVA: the row's F-test — a term's own, or a 2×2 contrast's (one df: F = t², the same
   *  test as its t) — on (df1, df2 = the residual df, plus the prior's when moderated) */
  ftest?: { F: number; df1: number; df2: number }
  /** curve fit only: the final model — the 4PL when its F-test rejects the flat null at the
   *  threshold's α, else M0 (flat, at the curve's `m0`). Set with the call (classifyCompareRow), so
   *  it follows threshold edits; absent on results classified before it existed. */
  model?: CurveModel
  /** curve fit only: the fitted dose–response curve behind the row (log2FC is its curve fold
   *  change, pP its recalibrated F-test). x is log₁₀ of the curve axis, in its own units. */
  curve?: Omit<import('./curveFit').CurveFit, 'log2FC' | 'pVal'> & {
    axis: ConditionKey
    /** the baseline in words (baselineText): "DMSO · dose 0", "dose 0 · time 60" */
    baseline?: string
    /** CurveCurator's target–decoy q-value (under its relevance threshold; see applyCurveFdr) */
    q?: number
    /** called by a target FDR: the α its comparison settled on (see applyCurveFdr) */
    ccAlpha?: number
    /** the measured points the curve was fitted to: log₁₀ dose and ratio to the control (the
     *  control itself, ratio 1 at −∞, not listed) — absent on results run before they were kept */
    x?: number[]
    y?: number[]
    /** each measured point's replicate (null = none given) — a sample is its dose and replicate */
    rep?: Array<number | null>
    /** the control samples' own ratios to the control mean, and their replicates */
    cy?: number[]
    crep?: Array<number | null>
    /** a linear axis: x is the level in steps of `step` (absent = log₁₀ of the level; see
     *  axisModel.ts — xUnits maps x back) */
    scale?: 'linear'
    step?: number
    /** a log axis whose matched baseline sits at 0 (t₀): the offset in log₁₀(level + offset) */
    timeOffset?: number
    /** false: not described — its run described responders only (q ≤ DESCRIBE_Q, BH over the
     *  run's raw p) and this curve isn't one. Its 4PL is still its test; its EC50, slope and
     *  plateaus aren't read (curveDescribed). Absent = described. */
    described?: false
  }
  /** SAM permutation FDR only: the moderated difference d and the pooled t's degrees of freedom
   *  (pP is that t-test; pQ the permutation q-value) */
  sam?: { d: number; df: number }
  /** Curve fit by the response surface method only (detection model Spline): the spline test and
   *  its description. log2FC is the fitted curve's / surface's peak, pP its moderated-F p, pQ its
   *  q (BH × Storey's π₀ over the run). Never set together with `curve` (the CurveCurator
   *  method's 4PL). */
  rs?: ResponseFit
}

/** How one axis of a stored surface maps its levels to x (as StoredScale: absent scale = log₁₀,
 *  with `timeOffset`), and its baseline — its kind and level. */
export interface SurfaceAxisMap {
  scale?: 'linear'
  step?: number
  timeOffset?: number
  baseline: import('./axisModel').AxisBaseline
  base: number
  /** a log axis's place for its base level at 0 when that level is a cell (a surface against one
   *  position: dose 0 at a higher temperature) — see AxisMap.zeroX */
  zeroX?: number
}

/** A response surface method fit behind one result row — a curve over one axis, or a dose × time
 *  surface (one row per gene × compound). Values are log₂ relative to the vehicle. */
export interface ResponseFit {
  /** the curve's axis, or 'surface' for a dose × time surface */
  axis: ConditionKey | 'surface'
  /** the baseline in words (baselineText): "DMSO · dose 0", "time 0" */
  baseline?: string
  /** a surface's detector: absent = the spline surface; '4pl' = the 4PL surface (adjusted F) */
  detector?: '4pl'
  /** a 4PL surface's CurveCurator test, for its relevance score and target–decoy FDR (as a 4PL
   *  curve's `curve`): its F on CurveCurator's scale and n (see scoreJoint4pl), its decoy q and
   *  settled α */
  cc?: import('./curveFit').CcTest
  /** the moderated F-test of spline vs flat: statistic and its two df */
  F: number
  df1: number
  df2: number
  /** one-axis curves: the level positions — baseline first (log₁₀ of the level, or the level itself
   *  on a linear axis; against one reference — dose — the baseline a step below the lowest, against
   *  a matched control — time: log₁₀(t + timeOffset) — the level 0 is) — the log₂ level means vs
   *  the baseline, the spline's fit at them, and the spline sampled finely for drawing */
  x?: number[]
  y?: number[]
  fitted?: number[]
  line?: { x: number[]; y: number[] }
  /** a log axis with a matched baseline (time) and surfaces: the offset in log₁₀(t + offset) */
  timeOffset?: number
  /** surfaces over another pair than dose × time, or on other axes than log × log: the two
   *  conditions (the first in the `dose` slot of `cells`, the second in `time`'s) and how each one's
   *  levels map to x (absent: dose × time, log₁₀ dose against the vehicle, log₁₀(t + timeOffset)
   *  from t₀) */
  pair?: [ConditionKey, ConditionKey]
  maps?: [SurfaceAxisMap, SurfaceAxisMap]
  /** one-axis curves on a linear axis: x is the level in steps of `step` (absent = log₁₀; see
   *  axisModel.ts — xUnits maps x back) */
  scale?: 'linear'
  step?: number
  /** surfaces: every treated cell — its dose, time, log₂ effect vs that time's vehicle, and the
   *  spline surface's fit there */
  cells?: Array<{ dose: number; time: number; y: number; fitted: number }>
  /** surfaces: the samples that aren't cells, for the views that show the reference (heatmap,
   *  3-D) — the vehicle's replicates at each of its levels (`vehicle`: at the first axis's base
   *  level, dose 0) and treated samples at a baseline level (t₀ under a matched second axis); each
   *  one's mean and replicates as log₂ vs its level's vehicle mean, so the vehicle scatters about 0.
   *  Levels as measured (0 included): a log axis places them. Absent on results fitted before. */
  controls?: Array<{ dose: number; time: number; y: number; reps: number[]; vehicle?: true }>
  /** a surface tested for response changes: the response axis, the axis compared across, and how
   *  the slices differ from the base slice — the largest consistent offset (drift) and departure
   *  beyond it (shape), log₂; the offset's share of the difference and what it mostly is */
  shift?: import('./splineFit').SliceShift & { kind: 'drift' | 'shape' | 'both' }
  /** the description, for curves with q within the describe cutoff: a one-axis curve's 4PL, or a
   *  surface's (per time slice, or joint) */
  desc?: import('./splineFit').CurveDescription
  surface?: import('./splineFit').SurfaceDescription
}

export interface VehNormResult {
  rows: CompareResultRow[]
  /** the comparisons present, e.g. ["E28 | DMSO"] */
  comparisons: string[]
  /** the threshold the rows' calls were made with (see CompareTableResult; absent on results
   *  saved before it existed) */
  threshold?: import('./stats').ThresholdConfig
  /** curve fit only: decoy curves per comparison group, and the calls' estimated FDR (see
   *  CompareTableResult) */
  decoys?: Record<string, import('./curveFit').DecoyCurve[]>
  curveFdr?: number
  ccAlpha?: Record<string, number>
  /** two-way ANOVA: the model behind the rows (see CompareTableResult) */
  anova?: import('./anova').AnovaResult
}
