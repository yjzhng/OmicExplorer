/** Types for the composable pipeline graph. */
import type { Node } from '@xyflow/react'

import type {
  CompareResultRow,
  AxisBaseline,
  AxisFit,
  AxisScale,
  CondSelector,
  ClusterColorBy,
  CustomConditionKey,
  ClusterData,
  ConditionKey,
  ContrastResult,
  ContrastStat,
  EnrichData,
  EnrichSource,
  FilterSpec,
  ImputeMethod,
  InteractiveRole,
  NormalizeReference,
  PairFix,
  InteractiveSampleCond,
  SampleOrder,
  MatrixPreset,
  Pair,
  StandardizeResult,
  ThresholdConfig,
  VehNormResult
} from '../engine'
import { holderTable, rowCount } from '../engine/lazyRows'
import {
  condLabel,
  condValue,
  crossPairs,
  curvesReplicated,
  nestedCol,
  axisModelFor,
  isCustomCond,
  isNumericCond,
  VALID_CONDITIONS,
  numericConds,
  numericOf,
  type LeafOrder,
  type Linkage,
  type NumericConds
} from '../engine'
import type { StringAll } from '../ui/stringModel'
import { ROLE_DEFAULTS, paletteEffectColors, toPaletteRef, type PaletteRef } from '../ui/palettes'
export type { StringAll }

/** High-level node category — derived from the op, never stored (see `categoryOf`). */
export type NodeCategory = 'data' | 'processing' | 'plotting'
/** The specific operation a node performs (its intrinsic, canonical type). */
export type NodeKind =
  | 'load'
  | 'standardize'
  | 'merge'
  | 'subset'
  | 'compare'
  | 'curveFit'
  | 'contrast'
  | 'volcano'
  | 'heatmap'
  | 'scatter'
  | 'ma'
  | 'dr'
  | 'potency'
  | 'metrics'
  | 'variance'
  | 'interaction'
  | 'curveMad'
  | 'response'
  | 'bubble'
  | 'dumbbell'
  | 'pca'
  | 'tdr'
  | 'geneBar'
  | 'enrich'
  | 'string'
  | 'qc'
  | 'corr'
  | 'table'
  | 'plotGroup'
export type StepStatus = 'idle' | 'running' | 'done' | 'error'
/** Plot orientation for the tiles that support it (bubble/dumbbell/heatmap/bar): genes/
 *  categories across x (landscape) or down y (portrait). Undefined = the plot's default. */
export type PlotOrient = 'landscape' | 'portrait'

/** Merge has nothing to configure yet — which datasets it pools is the wiring, not a setting. */
export type MergeConfig = Record<string, never>

/** Subset keeps the samples whose conditions take the chosen values: condition → kept values. A
 *  condition absent or empty is unfiltered, so the default passes the dataset through. */
export interface SubsetConfig {
  keep: CondSelector
  /** the replicates kept ("1", "2", …), across every condition; unset or empty = all */
  reps?: string[]
  /** samples left out by name (a bad replicate of one condition) */
  drop?: string[]
}

export interface FileEntry {
  name: string
  content: string
}

// ── per-kind configuration ──────────────────────────────────────────────────────

/** A Load tile references input files by name under the workflow's `input/` folder. */
/** How the Load tile sources its data:
 *  - `manual`: user picks the three standard files (data + samplesheet + ID map).
 *  - `interactive`: user picks one raw data matrix (e.g. a DIA-NN protein-group table);
 *    an adapter derives the three standard inputs from it (see engine/interactive.ts). New
 *    load nodes default to `interactive`; a legacy project with no `mode` field falls back
 *    to `manual`. */
export type LoadMode = 'manual' | 'interactive'

export interface LoadConfig {
  mode?: LoadMode
  data: string | null
  samplesheet: string | null
  db: string | null
  /** interactive mode: the single raw data matrix file (in the project data folder). */
  matrix?: string | null
  /** the units the numeric conditions' values are in (set where the conditions are mapped).
   *  Display-only — axis titles, EC50 and a dose curve's molar pEC50; never stales a result (see
   *  setLoadUnits). */
  units?: CondUnits
  /** the custom conditions declared numeric (their cat/num chip) — one declaration for both modes,
   *  as `units` is: set in the interactive import's Conditions step or the manual panel's
   *  Conditions, and kept when the tile switches mode. Read it through declaredNumeric (a project
   *  from before kept the import's in InteractiveImport.numericConditions). */
  numericConditions?: string[]
  /** interactive mode: the import spec built across the 4-step wizard. */
  interactive?: InteractiveImport
}

/** A Load tile's custom conditions declared numeric — whichever mode it is in (one declaration, as
 *  its units), falling back to where an import saved before kept them. */
export const declaredNumeric = (c: LoadConfig | undefined): string[] =>
  c?.numericConditions ?? c?.interactive?.numericConditions ?? []

/** Resolve a Load tile's effective mode, tolerating older saved values:
 *  - `manual` / `interactive` → themselves
 *  - any other stored value (e.g. the pre-rename `diann`) → `interactive`
 *  - no `mode` field → `manual` if it already references the standard files, else `interactive`
 *    (so a fresh tile defaults to interactive but a legacy manual project still reads as manual). */
export function resolveLoadMode(c: LoadConfig): LoadMode {
  const m = c.mode as string | undefined
  if (m === 'manual') return 'manual'
  if (m != null) return 'interactive'
  return c.data || c.samplesheet || c.db ? 'manual' : 'interactive'
}

/** The samplesheet columns Clean data reads as custom conditions off this Load tile: the ones the
 *  interactive import defined, less those switched off; undefined for a hand-written samplesheet
 *  (manual mode), whose customs ingest auto-detects. */
export const loadCustomConditions = (c: LoadConfig): string[] | undefined =>
  c.interactive?.customConditions?.filter((n) => !c.interactive?.hiddenConditions?.includes(n))

/** …and of those, the ones declared numeric (the import's cat/num chip; a manual tile's on its
 *  panel). */
export const loadNumericConditions = (c: LoadConfig): string[] =>
  resolveLoadMode(c) === 'manual'
    ? declaredNumeric(c)
    : declaredNumeric(c).filter(
        (n) =>
          c.interactive?.customConditions?.includes(n) &&
          !c.interactive?.hiddenConditions?.includes(n)
      )

/** Why a Load tile isn't ready to feed a Clean data step — null when it is. Both standard files
 *  must be set: Clean data reads them in either mode (interactive materialises them on convert),
 *  so this mirrors the run's own check rather than merely "some file is named". */
export function unconfiguredLoad(c: LoadConfig): string | null {
  const interactive = resolveLoadMode(c) === 'interactive'
  if (!c.data)
    return interactive
      ? 'Not configured — click “Configure samples…” and convert'
      : 'No data file selected'
  if (!c.samplesheet) return interactive ? 'Not converted yet' : 'No samplesheet selected'
  return null
}

/** Interactive import: the user's column classification + per-sample conditions, from which the
 *  three standard files are generated (see engine buildStandardInputs). */
export interface InteractiveImport {
  /** all matrix column headers */
  columns: string[]
  /** header → role (id / sample / label / meta / filter / ignore) */
  roles: Record<string, InteractiveRole>
  /** sample header → assigned conditions */
  conditions: Record<string, InteractiveSampleCond>
  /** custom condition axes the user added beyond the five presets, in display order. Each becomes
   *  a samplesheet column of the same name, and a `@name` condition key downstream. Categorical
   *  unless listed in `numericConditions`. */
  customConditions?: string[]
  /** Legacy: where the import first kept its declared numeric conditions — now on the Load tile
   *  (LoadConfig.numericConditions, shared by both modes). Only read, by declaredNumeric, for a
   *  project saved before. */
  numericConditions?: string[]
  /** conditions switched off that still carry values: kept (switching one back on restores them),
   *  but left out of the samplesheet and the checks while off */
  hiddenConditions?: string[]
  /** filter-column header → row-filter spec (Filtering step); absent = no row filtering */
  filters?: Record<string, FilterSpec>
  /** sample header → condition field → the token-index range [start, end) that field occupies in
   *  the sample name (Conditions step). The single source of truth for the step: the extracted
   *  value, the highlight and the samplesheet "original" all derive from it. Stored per row (not one
   *  global rule) so a paint on one group of rows can't disturb another, and unaffected by a value
   *  rename. Persisted so reopening restores the highlights, mirroring how column roles are kept. */
  spans?: Record<string, Partial<Record<string, [number, number]>>>
  /** token separator the Conditions step splits sample names on (default '_'); spans are token
   *  indexes under it, so changing it clears them */
  separator?: string
  /** last wizard stage the user was on (1–5) — reopens the wizard where they left off */
  step?: number
  /** last column-classification preset (Columns step) */
  preset?: MatrixPreset | 'custom'
  /** fetched external annotations (UniProt) merged into the DB, keyed by the feature's ID value
   *  (uniqID/accession). Persisted so a reopened wizard keeps them and they're written on convert. */
  annotations?: AnnotationSet
}

/** External-annotation columns fetched for the feature IDs (e.g. from UniProt). */
export interface AnnotationSet {
  /** provider tag (currently 'uniprot') */
  source: string
  /** output column names, in order (e.g. ['proteinName', 'geneNames']) */
  fields: string[]
  /** feature ID (accession) → { field → value } */
  byId: Record<string, Record<string, string>>
  /** dominant NCBI taxon id learned from the fetch — the species for the STRING network */
  taxon?: number
  /** dominant KEGG organism code (e.g. 'hsa') learned from the fetch — for STRING pathway mode */
  keggOrg?: string
  /** pathway name → top-level KEGG category (BRITE), for grouping/colouring enrichment terms */
  keggCategories?: Record<string, string>
}

export interface StandardizeConfig {
  /** null = auto-detect all present conditions */
  activeConditions: ConditionKey[] | null
  /** clean-up on/off. Absent on older configs → on iff minSamplePct > 0. */
  cleanupEnabled?: boolean
  /** clean-up: drop genes identified (non-null) in fewer than this % of samples (applied only
   *  while `cleanupEnabled`). */
  minSamplePct: number
  /** conditions to measure the % threshold within (e.g. ['cell'] = per cell, ['cell', 'dose'] =
   *  per cell × dose); a gene is dropped only if it falls short in every group. Empty/absent = all
   *  samples pooled. */
  minSamplePctBy?: ConditionKey[]
  /** The scale Clean data presents its values on (its table, its written CSV): none = as the input
   *  arrived, or log₁₀ / log₂. Analyses always work from exact linear values (see engine scale.ts).
   *  Absent = the default for the detected input scale: log₁₀ for linear input, none for logged. */
  logTransform?: 'none' | 'log2' | 'log10'
  /** median normalisation on/off (absent = off) */
  normalizeEnabled?: boolean
  /** the genes each sample's median is taken over (absent = 'shared': genes in every sample), or
   *  one reference protein ('protein': normalizeProtein) */
  normalizeReference?: NormalizeReference
  /** normalizeReference 'protein': the reference protein's uniqID */
  normalizeProtein?: string
  /** also equalise each sample's spread, Perseus width adjustment (absent = off) */
  normalizeSpread?: boolean
  /** imputation on/off (absent = off) */
  imputeEnabled?: boolean
  /** imputation method while enabled (absent = 'perseus') */
  imputeMethod?: ImputeMethod
  /** perseus: downshift in sample SDs (absent = 1.8) */
  imputeShift?: number
  /** perseus: width as a fraction of the sample SD (absent = 0.3) */
  imputeWidth?: number
}

/** Whether a Standardize config's clean-up applies — the explicit switch, or (older configs
 *  without one) a non-zero threshold. */
export const cleanupOn = (c: StandardizeConfig): boolean =>
  c.cleanupEnabled ?? (c.minSamplePct ?? 0) > 0

/** Whether imputation applies: its own switch, AND clean-up — without a coverage threshold a gene
 *  seen once would be mostly imputed and could come out as a confident call, so imputation is
 *  gated on clean-up being on. */
export const imputeOn = (c: StandardizeConfig): boolean => !!c.imputeEnabled && cleanupOn(c)

export interface CompareConfig {
  /** which comparison analysis to run. On a Compare tile, the goal the Compare window picks:
   *  'compare' — the t-test, the explicit numerator / denominator model (a t-test per test group)
   *  — or 'anova' — the compared conditions as the factors of one ANOVA (any
   *  number; one is a one-way ANOVA). A saved 'two_way_anova' reads as 'anova' (see
   *  normalizeCompareConfig). A Curve fit tile is always
   *  'curve_fit' — the same config with `num` as the treatments (one curve per numerator group)
   *  and `den` as the control, the curve's baseline. A Compare saved in curve-fit mode opens as a
   *  Curve fit tile (see migrateCurveCompare). */
  analysis: 'compare' | 'anova' | 'curve_fit'
  method: 'ttest'
  /** curve_fit only: the numeric condition the curve runs over (absent = dose) */
  curveAxis?: ConditionKey
  /** curve_fit: an axis's scale as the user set it in the Curve fit window, per condition; absent =
   *  the one its levels' spacing shows (engine detectAxisScale), else its preset's. Set only where
   *  the user overrode the detection, so the rest keeps following the data. Both methods follow it
   *  (one-axis curves; a surface is log on both axes). An ANOVA's slopes read it too (set in the
   *  Compare window). */
  axisScale?: Partial<Record<ConditionKey, AxisScale>>
  /** anova: the compared numeric conditions taken as factors (one level each); every other
   *  compared numeric condition is a slope — the default */
  asFactor?: ConditionKey[]
  /** curve_fit: what an axis's baseline is to its curves, as the user set it in the Curve fit
   *  window, per condition — 'reference' (a control off the curve: the vehicle) or 'matched' (its
   *  own first point: t₀, the lowest temperature — ratio to the lowest level). Absent = the axis's
   *  preset (dose reference, time matched, any other reference); set only where the user picked the
   *  other. Both methods follow it (one-axis curves; a surface keeps the presets'). */
  axisBaseline?: Partial<Record<ConditionKey, AxisBaseline>>
  /** curve_fit: each axis's models as the user set them (a custom method) — the detector's shape,
   *  the descriptor's and on a surface the coupling (engine AxisFit; graph/axisFits.ts resolves
   *  them). Absent: the method preset's (`detection`'s detector everywhere, the 4PL descriptor; on
   *  a surface each axis's drift as its baseline gives — a reference axis drifts along a matched
   *  one, two of a kind both drift: engine driftsByDefault). `detection` is kept as what they amount
   *  to (detectionOf). */
  axisFits?: Partial<Record<ConditionKey, AxisFit>>
  /** curve_fit, surfaces: the two numeric conditions — the first runs from the baseline (dose), the
   *  baseline matched at each level of the second (time). Absent: dose × time. */
  surfacePair?: [ConditionKey, ConditionKey]
  /** curve_fit only: the detection model — '4pl' (absent): the CurveCurator method; 'spline': the
   *  response surface method (spline detection, moderated F, 4PL description) */
  detection?: '4pl' | 'spline'
  /** curve_fit: 'custom' when the detector and descriptor were picked by hand rather than by a
   *  method preset; unset = the preset `detection` implies (spline → Hybrid, 4PL → 4PL). See
   *  curveMethodOf. UI only — the run reads the models themselves. */
  curveMethod?: 'custom'
  /** curve_fit, the CurveCurator method (4PL over one axis): its interpolation — the fit also sees
   *  points between the doses, read off straight lines between the measured ratios; the test stays
   *  on the real points. Off (unset) by default, as CurveCurator's own. */
  interpolation?: boolean
  /** curve_fit, spline only: one dose × time surface per gene × compound instead of curves over
   *  `curveAxis` */
  surface?: boolean
  /** curve_fit, surfaces only (legacy — now surfaceIntent decides): describe slice by slice —
   *  drawn per time (absent / 'slices') or per dose ('doseSlices') — or by one joint model
   *  ('joint'). No longer written; a run with surfaceIntent ignores it. */
  surfaceDescription?: 'slices' | 'doseSlices' | 'joint'
  /** curve_fit, surfaces only: what the fit is for — capture the response's shape (absent /
   *  'shape': the surface against flat, the joint description) or test response changes
   *  ('changes': curves along the response axis compared across the other — engine runSliceShift) */
  surfaceIntent?: 'shape' | 'changes'
  /** curve_fit, testing response changes: the axis the curves run along (the other is compared
   *  across) — the user's pick; absent: not picked yet, the run asks for it */
  responseAxis?: ConditionKey
  /** curve_fit, testing response changes with a 4PL along the response axis: the F's null —
   *  the adjusted F (absent / 'adjusted': simulated) or NPARC's df estimated across the genes
   *  ('nparc' — degenerate on log₂ single-replicate data such as the TPP example; parked) */
  changesStat?: 'nparc' | 'adjusted'
  /** curve_fit: describe (4PL — EC50, top) every gene (true), or the responders only (false:
   *  q ≤ DESCRIBE_Q). Unset = every gene under the 4PL detector over one axis (its 4PL is its
   *  test), responders otherwise — see describesAll. Every gene is slower with a separate
   *  descriptor, and a flat curve's EC50 means little — but every gene then has one, e.g. to
   *  contrast pEC50 between two conditions. */
  describeAll?: boolean
  /** curve_fit only: the control is a background treatment (e.g. drug B alone, for drug A
   *  titrated on top of it) rather than the vehicle — confirmed by the user, since a curve's
   *  control is its starting point (see controlIsBaseline) */
  controlBackground?: boolean
  /** Legacy: the dose unit a curve fit used to carry itself. The unit now lives on the Load tile
   *  (LoadConfig.units); this is only read as a fallback for a workflow saved before. */
  doseUnit?: DoseUnit
  /** Unused: a Compare now tests on Clean data's log-transform scale (logged or not). Kept so
   *  older saved workflows still type-check. */
  transform?: boolean
  /** explicit comparison (analysis === 'compare'): the two sides' cond-value selections and
   *  which non-axis conditions must be matched like-for-like (others are pooled). */
  num: CondSelector
  den: CondSelector
  match: ConditionKey[]
  /** explicit comparison, as the Compare dialog states it: the compared conditions (several allowed)
   *  and the context conditions merged into one group on both sides. Absent (configs saved before)
   *  = inferred from the pins, and nothing pooled. */
  compared?: ConditionKey[]
  pool?: ConditionKey[]
  /** Legacy (a 2-way ANOVA saved before the compared conditions named its factors): the two factors
   *  and their numerator/denominator levels — read into num / den / compared on load */
  condition: ConditionKey
  pairNum: string
  pairDen: string
  condition2: ConditionKey
  pair2Num: string
  pair2Den: string
  threshold: ThresholdConfig
  /** display names for the effect classes (legends, tables); absent = "down" / "up" / "none".
   *  Display-only — never stales the result (see setCompareEffectLabels). */
  effectLabels?: EffectLabels
  /** colours for the effect classes, inherited by every plot the Compare feeds (a plot can
   *  override its own); absent = the shared red / blue / grey. Display-only, as the labels. */
  effectColors?: Partial<EffectColors>
}

/** The molar units the app knows, with their size in molar. A unit is free text (CondUnits); one
 *  of these only puts a log axis's pEC50 in molar — pEC50 (M), whatever the doses were given in. */
export const DOSE_UNITS = { M: 1, mM: 1e-3, µM: 1e-6, nM: 1e-9, pM: 1e-12 } as const
export type DoseUnit = keyof typeof DOSE_UNITS
const MOLAR_UNITS: Record<string, number> = {
  ...DOSE_UNITS,
  // micro typed as the Greek mu or a u; femtomolar
  μM: 1e-6,
  uM: 1e-6,
  fM: 1e-15
}
/** Common time units — suggestions only, as DOSE_UNIT_SUGGESTIONS. */
export const TIME_UNITS = ['s', 'min', 'h', 'd', 'wk'] as const
export type TimeUnit = (typeof TIME_UNITS)[number]

/** Arbitrary units: a numeric condition's values carry no physical unit (a dose then has no molar
 *  scale, so a curve's EC50 gets no pEC50 in molar). Picked explicitly at import, like a unit. */
export const AU = 'a.u.'
export type ArbitraryUnit = typeof AU

/** What the unit boxes offer as you type (any other text is a unit too). */
export const DOSE_UNIT_SUGGESTIONS: readonly string[] = [
  AU,
  ...Object.keys(DOSE_UNITS),
  'mg/mL',
  'µg/mL',
  '%',
  'X',
  'MIC'
]
export const TIME_UNIT_SUGGESTIONS: readonly string[] = [AU, ...TIME_UNITS]

/** The units of the numeric conditions, as named at import, keyed by condition: free text (nM,
 *  mg/mL, MIC, %, h, …) — labels, except that a molar unit puts a log axis's pEC50 in molar
 *  (isMolar). a.u. = none. Absent = not named yet (the import asks for one before it goes on; an
 *  older project shows it unitless, like a.u.). */
export type CondUnits = {
  dose?: string
  time?: string
} & { [K in CustomConditionKey]?: string }

/** A condition's unit, if it has one (only numeric conditions do). */
export function unitOf(units: CondUnits | undefined, c: ConditionKey): string | undefined {
  if (!units) return undefined
  if (c === 'dose' || c === 'time') return units[c]
  return isCustomCond(c) ? units[c] : undefined
}

/** Whether a unit is a molar one (M, mM, µM / μM / uM, nM, pM, fM), so a log axis's pEC50 is put in
 *  molar. */
export const isMolar = (u: string | undefined): boolean =>
  u != null && Object.prototype.hasOwnProperty.call(MOLAR_UNITS, u.trim())
/** A molar unit's size in molar (1 for any other unit). */
export const molarScale = (u: string | undefined): number =>
  u != null && isMolar(u) ? MOLAR_UNITS[u.trim()] : 1

/** The units the data feeding `id` was imported with: walks upstream (through every input of a
 *  Merge) to the Load tile(s); the first one to name a condition's unit wins it. */
export function condUnitsFor(
  g: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
  id: string | undefined
): CondUnits {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  const queue = id ? [id] : []
  while (queue.length) {
    const cur = queue.shift()!
    if (seen.has(cur)) continue
    seen.add(cur)
    const n = g.nodes.find((x) => x.id === cur)
    if (n && isStep(n) && n.data.kind === 'load') {
      const u = (n.data.config as LoadConfig).units
      for (const [c, v] of Object.entries(u ?? {})) if (v) out[c] ??= v
      continue
    }
    for (const e of g.edges) if (e.target === cur) queue.push(e.source)
  }
  return out as CondUnits
}

/** A numeric axis's title with its unit: `dose (nM)`, or just `dose` when none is set. `axis` is a
 *  condition key (a custom one titled by its name). */
export function axisTitle(axis: string, units: CondUnits): string {
  const c = axis as ConditionKey
  const u = unitOf(units, c)
  return u ? `${condLabel(c)} (${u})` : condLabel(c)
}

/** A curve fit's axis unit and, when it is molar, its molar scale (for pEC50): the imported unit
 *  of its axis (a dose axis: else a legacy Compare-level one); none or a.u. = no molar scale. A
 *  unit that isn't molar (time's, a custom condition's) has scale 1 — its unit for the EC50's label
 *  only. */
export function curveDoseUnit(
  cfg: CompareConfig | undefined,
  units: CondUnits
): { unit?: string; scale: number; molar?: boolean } {
  if (!cfg || cfg.analysis !== 'curve_fit') return { scale: 1 }
  const axis = cfg.curveAxis ?? 'dose'
  const unit = unitOf(units, axis) ?? (axis === 'dose' ? cfg.doseUnit : undefined)
  if (!unit) return { scale: 1 }
  return isMolar(unit) ? { unit, scale: molarScale(unit), molar: true } : { unit, scale: 1 }
}

/** The axis a curve fit's curves run along, with its unit and molar scale — a one-axis curve's
 *  axis; a surface's response axis when testing changes, else its first (its dose curves): what a
 *  potency is read along (EC50 in its units; pEC50 when molar). curveDoseUnit stays the dose's. */
export function curveAxisUnit(
  cfg: CompareConfig | undefined,
  units: CondUnits
): { axis: ConditionKey; unit?: string; scale: number; molar?: boolean } {
  const pair = cfg?.surfacePair ?? ['dose', 'time']
  const axis: ConditionKey = !cfg
    ? 'dose'
    : cfg.surface
      ? cfg.surfaceIntent === 'changes' && cfg.responseAxis && pair.includes(cfg.responseAxis)
        ? cfg.responseAxis
        : pair[0]
      : (cfg.curveAxis ?? 'dose')
  const unit = unitOf(units, axis) ?? (axis === 'dose' ? cfg?.doseUnit : undefined)
  if (!unit) return { axis, scale: 1 }
  return isMolar(unit)
    ? { axis, unit, scale: molarScale(unit), molar: true }
    : { axis, unit, scale: 1 }
}

/** CurveCurator's default significance: α = 0.05, |curve log₂FC| ≥ 0.5 (as every curve fit's
 *  default fold-change limit), on raw p. */
export const CURVECURATOR_THRESHOLD: Partial<ThresholdConfig> = {
  type: 'curvecurator',
  statType: 'pP',
  statMin: -Math.log10(0.05),
  fcHigh: 0.5,
  fcLow: -0.5
}

/** The response surface method's default call (as the engine's RESPONSE_THRESHOLD): the
 *  hyperbolic boundary on q, P asymptote q = 5%, FC asymptote |log₂FC| = 0.5. */
export const RESPONSE_THRESHOLD_DEFAULT: Partial<ThresholdConfig> = {
  type: 'non-linear',
  statType: 'pQ',
  statMin: -Math.log10(0.05),
  b: 1,
  s0: -0.5,
  fcHigh: 0.5,
  fcLow: -0.5
}

/** The threshold a Curve fit should carry for its detection model `to` (and, `surface`, over
 *  dose × time) — or null when it can stay. The CurveCurator method's curves start on its
 *  relevance score; the response surface method, and any dose × time surface, start on q (a 4PL
 *  surface can then switch to the relevance score, its decoys surfaces). */
/** A Curve fit's method: a preset of its detector and descriptor (Hybrid: spline + 4PL; 4PL: 4PL +
 *  4PL), or 'custom' when they were picked by hand. */
export type CurveMethod = 'hybrid' | '4pl' | 'custom'
export function curveMethodOf(c: Pick<CompareConfig, 'curveMethod' | 'detection'>): CurveMethod {
  return c.curveMethod === 'custom' ? 'custom' : c.detection === 'spline' ? 'hybrid' : '4pl'
}

/** Whether a Curve fit describes every gene (else its responders only): its setting, else every
 *  gene under the 4PL detector over one axis — its 4PL is its test, so already fitted — and the
 *  responders otherwise. `surface` = the run is a dose × time surface. */
export function describesAll(
  c: Pick<CompareConfig, 'describeAll' | 'detection'>,
  surface: boolean
): boolean {
  return c.describeAll ?? (c.detection !== 'spline' && !surface)
}

export function thresholdForDetection(
  to: NonNullable<CompareConfig['detection']>,
  t: ThresholdConfig,
  surface = false
): ThresholdConfig | null {
  if (to === 'spline' || surface)
    return t.type === 'curvecurator' ? { ...t, ...RESPONSE_THRESHOLD_DEFAULT } : null
  return t.type === 'curvecurator' ? null : { ...t, ...CURVECURATOR_THRESHOLD }
}

/** The threshold a Compare should carry after switching its analysis from `from` to `to` — or null
 *  when it can stay. A curve fit starts on CurveCurator's relevance score (its own defaults); a
 *  method the new analysis can't run (CurveCurator outside a curve fit, SAM outside a t-test)
 *  falls back to the p-value route's hyperbolic boundary, FDR-controlled. */
export function thresholdForAnalysis(
  from: CompareConfig['analysis'],
  to: CompareConfig['analysis'],
  t: ThresholdConfig
): ThresholdConfig | null {
  if (to === 'curve_fit' && from !== 'curve_fit') return { ...t, ...CURVECURATOR_THRESHOLD }
  const unsupported =
    (t.type === 'curvecurator' && to !== 'curve_fit') || (t.type === 'sam_fdr' && to !== 'compare')
  return unsupported ? { ...t, type: 'non-linear', statType: 'pQ' } : null
}

export interface EffectLabels {
  down: string
  up: string
  /** the genes called neither (not significant) */
  none: string
}
/** A cluster plot's look as the two settings it now is — what marks the data, and what territory
 *  outlines it — from any config, old or new: an old 'territory' display is centroids + its saved
 *  shape (hull by default); any other old display had no outline. */
export function clusterLook(c: Pick<ClusterConfig, 'display' | 'outline' | 'territory'>): {
  data: 'replicate' | 'centroid'
  territory: 'hull' | 'gaussian' | 'none'
} {
  const display = c.display ?? 'replicate'
  return {
    data: display === 'replicate' ? 'replicate' : 'centroid',
    territory: c.outline ?? (display === 'territory' ? (c.territory ?? 'hull') : 'none')
  }
}

export const DEFAULT_EFFECT_LABELS: EffectLabels = { down: 'down', up: 'up', none: 'none' }
/** The effect groups' colours, from the Compare: up, down, and none (not significant). */
export interface EffectColors {
  up: string
  down: string
  none: string
}
/** A plot's own effect colours over its upstream's (unset or 'auto' = follow the upstream). */
export type PlotEffectColors = Partial<Record<'up' | 'down' | 'none', string>>
/** A plot that draws fold changes may follow its own palette instead of the global one. */
export interface FcPaletteConfig {
  /** this plot's fold-change palette (unset = the global one, app settings → fcPalette) */
  fcPalette?: PaletteRef
}
/** The palette a plot draws fold changes on: its own, else the global one. */
export const fcPaletteOf = (plot: FcPaletteConfig | undefined, global: PaletteRef): PaletteRef =>
  toPaletteRef(plot?.fcPalette) ?? global
/**
 * The colours a plot draws its effect groups in, most specific first: the plot's own colour for
 * the group; sampled from the plot's own palette, when it has one; the Compare's colour for the
 * group; sampled from the global palette (down its low end, none its middle, up its high end).
 */
export function plotEffectColors(
  own: PlotEffectColors | undefined,
  compare: Pick<CompareConfig, 'effectColors'> | undefined,
  global: PaletteRef = ROLE_DEFAULTS.fcObject,
  plotPalette?: PaletteRef
): EffectColors {
  const own_ = toPaletteRef(plotPalette)
  const sampled = paletteEffectColors(own_ ?? global)
  const pick = (k: 'up' | 'down' | 'none'): string => {
    const c = own?.[k]
    if (c && c !== 'auto') return c
    if (own_) return sampled[k]
    const fromCompare = compare?.effectColors?.[k]
    return fromCompare && fromCompare !== 'auto' ? fromCompare : sampled[k]
  }
  return { up: pick('up'), down: pick('down'), none: pick('none') }
}
/** A Compare's effect colours: its own where set, else sampled from the (global) palette. */
export const effectColorsOf = (
  c: Pick<CompareConfig, 'effectColors'> | undefined,
  global: PaletteRef = ROLE_DEFAULTS.fcObject
): EffectColors => plotEffectColors(undefined, c, global)
/** A Compare's effect names with defaults filled in (blank entries fall back too). */
export const effectLabelsOf = (
  c: Pick<CompareConfig, 'effectLabels'> | undefined
): EffectLabels => ({
  down: c?.effectLabels?.down?.trim() || DEFAULT_EFFECT_LABELS.down,
  up: c?.effectLabels?.up?.trim() || DEFAULT_EFFECT_LABELS.up,
  none: c?.effectLabels?.none?.trim() || DEFAULT_EFFECT_LABELS.none
})

/** Migrate any stored Compare config (incl. legacy veh_norm/direct) to the explicit model.
 *  Pure — safe to call on every read; returns the input unchanged when already migrated. */
export function normalizeCompareConfig(c: CompareConfig): CompareConfig {
  const n = normalizeAnalysis(c)
  // Threshold: configs saved before the asymmetric switch existed could hold hand-typed unequal
  // FC cutoffs. Flag those asymmetric so the switch reflects (and the store preserves) them,
  // instead of silently mirroring the down cutoff off the up one.
  const t = n.threshold
  if (t && t.asymmetric === undefined) {
    const unequal =
      t.type === 'non-linear' ? t.s0Down != null && t.s0Down !== t.s0 : t.fcLow !== -t.fcHigh
    if (unequal) return { ...n, threshold: { ...t, asymmetric: true } }
  }
  return n
}

function normalizeAnalysis(c: CompareConfig): CompareConfig {
  const analysis = c.analysis as string
  // Legacy veh_norm: treatment vs vehicle compound, vehicle matched on everything but dose.
  if (analysis === 'veh_norm') {
    return {
      ...c,
      analysis: 'compare',
      num: c.pairNum ? { cmpd: [c.pairNum] } : {},
      den: c.pairDen ? { cmpd: [c.pairDen] } : {},
      match: VALID_CONDITIONS.filter((k) => k !== 'cmpd' && k !== 'dose')
    }
  }
  // Legacy direct: two levels of one condition, matched like-for-like on every other condition.
  if (analysis === 'direct') {
    const cond = c.condition
    return {
      ...c,
      analysis: 'compare',
      num: c.pairNum ? { [cond]: [c.pairNum] } : {},
      den: c.pairDen ? { [cond]: [c.pairDen] } : {},
      match: VALID_CONDITIONS.filter((k) => k !== cond)
    }
  }
  // Legacy 2-way ANOVA → the ANOVA, its two factors the compared conditions; one saved with the
  // factor fields only has them mirrored into num/den selectors.
  if (analysis === 'two_way_anova') {
    const legacy =
      !(c.num && Object.keys(c.num).length) && c.pairNum && c.pairDen && c.pair2Num && c.pair2Den
    return {
      ...c,
      analysis: 'anova',
      num: legacy ? { [c.condition]: [c.pairNum], [c.condition2]: [c.pair2Num] } : (c.num ?? {}),
      den: legacy ? { [c.condition]: [c.pairDen], [c.condition2]: [c.pair2Den] } : (c.den ?? {}),
      match: c.match ?? [],
      compared: c.compared?.length ? c.compared : [c.condition, c.condition2].filter(Boolean),
      // it ran its numeric conditions as factors: keep them so (a slope is the ANOVA's default)
      asFactor: c.asFactor ?? (c.compared?.length ? c.compared : [c.condition, c.condition2])
    }
  }
  // Already explicit: return unchanged when the new fields exist, else backfill.
  if (c.num && c.den && c.match) return c
  return { ...c, num: c.num ?? {}, den: c.den ?? {}, match: c.match ?? [] }
}

/** Whether a Compare tile's comparison is fully defined (numerator + denominator pinned; for an
 *  ANOVA, a test level and a control for each factor). Drives the tile's ready/blocked state. */
export function isCompareConfigured(config: CompareConfig): boolean {
  const cfg = normalizeCompareConfig(config)
  const pinned = (s: CondSelector): boolean =>
    Object.values(s).some((v) => v != null && v.length > 0)
  if (cfg.analysis === 'compare' || cfg.analysis === 'curve_fit')
    return pinned(cfg.num) && pinned(cfg.den)
  return anovaFactorsOf(cfg, numericConds()).length > 0
}

/** An ANOVA's factors: each compared condition with its test × control level pairs — a numeric
 *  one (`numeric`, the dataset's schema) a slope unless taken as a factor (`asFactor`), on its
 *  scale (slopeScaleOf). None when one has no pair (nothing picked on a side). */
export function anovaFactorsOf(
  cfg: Pick<CompareConfig, 'compared' | 'num' | 'den' | 'asFactor' | 'axisScale'>,
  numeric: NumericConds
): Array<{ condition: ConditionKey; pairs: Pair[]; slope?: AxisScale }> {
  const factors = (cfg.compared ?? []).map((c) => {
    const pairs = crossPairs(cfg.num[c] ?? [], cfg.den[c] ?? [])
    return isNumericCond(c, numeric) && !cfg.asFactor?.includes(c)
      ? { condition: c, pairs, slope: slopeScaleOf(cfg, c) }
      : { condition: c, pairs }
  })
  return factors.length && factors.every((f) => f.pairs.length) ? factors : []
}

/** A slope's axis scale: as the user set it (`axisScale`), else what its picked levels' spacing
 *  shows — linear when it can't tell — as the Curve fit decides it. */
export function slopeScaleOf(
  cfg: Pick<CompareConfig, 'num' | 'den' | 'axisScale'>,
  c: ConditionKey
): AxisScale {
  const levels = [...(cfg.num[c] ?? []), ...(cfg.den[c] ?? [])].map(Number)
  return axisModelFor(c, undefined, cfg.axisScale?.[c], levels).scale
}

/** Contrast forms two sides (FC1/FC2) and scores per-gene divergence between them. */
export interface ContrastConfig {
  /** correlated (OLS prediction band around the trend) vs independent (linear cutoff per axis) */
  relationship: 'correlated' | 'independent'
  /** the statistic's cutoffs: band confidence (correlated), q + |value| floor (linear cutoff) */
  stat?: ContrastStat
  /** how the two sides (FC1/FC2) are formed:
   *   - 'select' (default): ONE upstream input, split into two EXPLICIT cond-value selections
   *     (num → FC1, den → FC2) aligned on the chosen match context — the same interactive selector
   *     window as Compare, so the two sides and their context are declared, never inferred.
   *   - 'pair': two upstream inputs (two Compares → FC-vs-FC, or two Standardizes →
   *     abundance-vs-abundance), joined by uniqID + the matched context. */
  source?: 'select' | 'pair'
  /** 'select' mode: the two sides' cond-value selections (like Compare's num/den). FC1 = rows
   *  matching `num`, FC2 = rows matching `den`. */
  num?: CondSelector
  den?: CondSelector
  /** context dims to align the two sides on (joined with uniqID); unmatched dims are averaged.
   *  Empty = join on uniqID alone (one point per gene). Used by both 'select' and 'pair'. */
  match?: ConditionKey[]
  /** 'pair' mode: which wired inputs are dataset A (y) and B (x), by node id. A tile may have
   *  more than two inputs wired; absent/stale ids fall back to the first two edges. */
  pairA?: string
  pairB?: string
  /** 'select' mode with several inputs wired: which one the two groups are selected from, by
   *  node id; absent/stale falls back to the first edge. */
  selectFrom?: string
  /** 'pair' mode: the slice each UNMATCHED condition is fixed to, per dataset — nothing is pooled
   *  across a condition (see engine PairFix). */
  pairFix?: PairFix
}

/** Effective contrast source, tolerating older saved values (the pre-rename 'split' → 'select'). */
/** The contrast's mode: with one input only intra-dataset (select two groups) is possible; with
 *  two or more the config chooses, defaulting to inter-dataset (pair two of them). */
export function resolveContrastSource(c: ContrastConfig, inputCount: number): 'select' | 'pair' {
  if (inputCount < 2) return 'select'
  return c.source === 'select' ? 'select' : 'pair'
}

/** Whether a 'select'-mode contrast has both sides pinned (so it can run). */
export function isContrastConfigured(c: ContrastConfig): boolean {
  const pinned = (s?: CondSelector): boolean =>
    !!s && Object.values(s).some((v) => v != null && v.length > 0)
  return pinned(c.num) && pinned(c.den)
}

/** Whether an optional top-N cap applies — the explicit switch, or (older configs without one)
 *  a non-zero N. Shared by every plot with a "Cap genes"/"Cap labels" switch. */
export const capOn = (enabled: boolean | undefined, n: number | undefined): boolean =>
  enabled ?? (n ?? 0) > 0

/** How a line is stroked, for the axis decorations that offer a choice. */
export type LineStyle = 'solid' | 'dash' | 'dot'

/** Per-axis overrides for a Plotly plot's x or y axis. Every field is optional — unset keeps the
 *  view's own layout (title text, auto range, theme grid/line colours). */
export interface AxisStyle {
  /** axis title text; blank/unset = the view's own */
  title?: string
  /** title font size (px) */
  titleSize?: number
  /** show the tick labels (default on) */
  tickLabels?: boolean
  /** tick label font size (px) */
  tickSize?: number
  /** fixed range bounds; a missing side falls back to the view's range (or the data extent) */
  min?: number
  max?: number
  /** tick mark placement */
  ticks?: 'outside' | 'inside' | 'none'
  /** spacing between ticks, in the axis's own units (unset = Plotly's automatic spacing). On a
   *  categorical axis (response steps, gene rows) it counts categories: 2 = label every other. */
  interval?: number
  /** show gridlines */
  grid?: boolean
  /** gridline style (default solid) */
  gridStyle?: LineStyle
  /** gridline thickness (px) */
  gridWidth?: number
  /** axis line thickness (px); 0 hides the line */
  lineWidth?: number
  /** the axis line's style (default solid). Plotly draws the axis line solid-only, so anything
   *  else is drawn as a shape instead — see ui/plotAxes. */
  lineStyle?: LineStyle
  /** mirror the axis line (and ticks) on the opposite side — a framed plot */
  mirror?: boolean
  /** the mirrored line's style (default solid). Plotly mirrors the axis line as-is, so anything
   *  else is drawn as a shape instead — see ui/plotAxes. */
  frameStyle?: LineStyle
  /** the mirrored line's thickness (px); unset = the axis line's own */
  frameWidth?: number
  /** draw the zero line */
  zeroline?: boolean
  /** its line style (default solid). Plotly's own zero line is solid-only, so anything else is
   *  drawn as a shape instead — see ui/plotAxes. */
  zerolineStyle?: LineStyle
  /** zero-line thickness (px) */
  zerolineWidth?: number
}
/** A plot's axis overrides, per axis. */
export interface PlotAxes {
  x?: AxisStyle
  y?: AxisStyle
}

/** A plot's legend switch, plot-wide (the point plots keep theirs in `style.legend`): false hides
 *  the legend and the colour scale bars; unset = shown. */
export interface LegendConfig {
  legend?: boolean
}

/** Volcano (compare). The y-axis stat (−log10 p vs q) follows the upstream Compare's threshold
 *  `statType`, so the drawn guide matches the calls — it isn't a per-tile choice. */
export interface VolcanoConfig extends FcPaletteConfig {
  /** cap labels: explicit switch (undefined on older configs → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N most significant genes (applied only while `capEnabled`);
   *  otherwise the placement layer labels as many significant genes as fit. */
  labelTop: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** One point group's marker look on a point plot (volcano / MA / scatter). Every field is
 *  optional: unset falls back to the plot's built-in default for that group (ui/pointStyle.ts). */
export interface GroupStyle {
  /** legend name for this group on this plot; unset/blank = the upstream tile's class name */
  name?: string
  /** marker diameter (px) */
  size?: number
  /** resting marker opacity (0–1) */
  opacity?: number
  /** marker colour (CSS) */
  color?: string
  /** outline thickness around the marker (px); 0 (the default) = no outline */
  outline?: number
  /** outline colour; unset = the theme's text colour */
  outlineColor?: string
  /** whether this group's genes are offered to the collision-managed label layer */
  label?: boolean
  /** whether this group has a legend entry (default on; moot while the legend is hidden) */
  legend?: boolean
  /** how THIS group's points look when selected/hovered, and how they fade when others are.
   *  Unset fields fall back to the plot-wide `PointStyle.highlight`, then to the defaults. */
  highlight?: HighlightStyle
}

/** Look of the emphasised (selected / hovered) points, and of the rest of the cloud while a
 *  selection is active. Used plot-wide (`PointStyle.highlight`) and per group
 *  (`GroupStyle.highlight`, which wins). Unset fields fall back (ui/pointStyle.ts). */
export interface HighlightStyle {
  /** the emphasised marker's diameter (px). Unset = the point's own size plus `bump`, so a plot
   *  whose group sizes change keeps its emphasis proportional until this is set explicitly. */
  size?: number
  /** px added to the marker's own diameter when `size` is unset */
  bump?: number
  /** the emphasised marker's outline width (px); 0 = none. Shown as "outline" in the panel. */
  ring?: number
  /** that outline's colour; unset = the theme's text colour */
  ringColor?: string
  /** opacity of every non-selected point while something is selected (0–1) */
  dim?: number
  /** name the emphasised point in bold at its marker */
  label?: boolean
  /** font size (px) of that name */
  labelSize?: number
}

/** Per-tile styling for the point plots: a look per point group, the highlight look, and the
 *  legend switch. Group keys are the effect classes ('up' | 'down' | 'none') or, for an
 *  independent-contrast scatter, the quadrant keys ('up, up', 'down, —', …). */
export interface PointStyle {
  groups?: Record<string, GroupStyle>
  highlight?: HighlightStyle
  /** show the legend (default on) */
  legend?: boolean
  /** the threshold / reference guide lines' width, px (unset = GUIDE_WIDTH, 0.5) */
  guideWidth?: number
}

/** Heatmap: genes × samples log10 intensity (from Standardize) OR genes × comparisons log2FC
 *  (from Compare) — the tile picks the rendering from its upstream. */
export interface HeatmapConfig extends FcPaletteConfig {
  /** from a two-way ANOVA, outside a group (in one, it follows the group's `show` pick): its
   *  overall rows — the signed 2×2 interaction fold changes (default, the diverging palette) — or
   *  its factors rows (unsigned effect sizes, the palette's upper half from 0) — one at a time, as
   *  they can't share a colour scale */
  fcRows?: 'overall' | 'factors'
  /** from Clean data: the value palette (unset = viridis). From a Compare it draws log₂FC on
   *  `fcPalette` instead. */
  valuePalette?: PaletteRef
  /** cap genes: explicit switch (undefined on older configs → inferred from maxGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N differential genes by |log2FC| (applied only while `capEnabled`). Only
   *  applies to a Compare-fed heatmap; the Standardize-fed intensity heatmap always shows the
   *  full proteome. */
  maxGenes: number
  /** Unused: an intensity heatmap now follows Clean data's log-transform setting. Kept so older
   *  saved workflows still type-check. */
  log10?: boolean
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
  /** a Clean-data heatmap's condition bar (a coloured track per condition along the samples):
   *  shown or hidden; unset = shown with few samples (see heatmapCondBar) */
  condBar?: boolean
  /** a Clean-data heatmap's sample columns: natural by condition (default) or the data's own
   *  order — see SampleOrder; read through sampleOrderOf */
  sampleOrder?: SampleOrder
  /** a fold-change heatmap's clustering linkage; unset = Ward (see HEATMAP_LINKAGES) */
  linkage?: HeatmapLinkage
  /** a fold-change heatmap's leaf order; unset = by mean (see HEATMAP_LEAF_ORDERS) */
  leafOrder?: LeafOrder
  /** A fold-change heatmap's gene clustering look: the tree cut into at most `dendroClades`
   *  clusters (unset = DENDRO_CLADES_DEFAULT), a coloured bar over each (modules), the tree itself,
   *  and the bars' palette (unset = the global categorical one). Modules and tree unset = hidden. */
  dendroClades?: number
  geneModules?: boolean
  geneTree?: boolean
  geneCategorical?: import('../ui/palettes').CategoricalId
  /** …and its condition (comparison column) clustering look, likewise. */
  dendroColClades?: number
  condModules?: boolean
  condTree?: boolean
  condCategorical?: import('../ui/palettes').CategoricalId
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** The condition a by-condition colouring starts from when none is picked yet: the data's first
 *  categorical condition, else its first condition at all. */
export function defaultColorConds(
  active: readonly ConditionKey[],
  numeric: NumericConds
): ConditionKey[] {
  const cats = active.filter((c) => !isNumericCond(c, numeric))
  return (cats.length ? cats : active).slice(0, 1)
}

/** The conditions a cluster colours by: `colorConds` while colorBy is a categorical condition
 *  that it still includes (a later pick of colorBy alone — the tile's switch — supersedes it), else
 *  colorBy alone; none for the cluster colouring. */
export function clusterColorConds(c: ClusterConfig, numeric: NumericConds): ConditionKey[] {
  if (c.colorBy === 'cluster') return []
  const by = c.colorBy as ConditionKey
  // the shade is added to a categorical colour only (the picker shows for those alone)
  return !isNumericCond(by, numeric) && c.colorConds?.includes(by) ? c.colorConds.slice(0, 2) : [by]
}

/** A cluster coloured by two conditions (`colorConds`: a colour and a shade): the scheme its
 *  multi-condition drawing takes (ClusterView's complex build) — the colour by the one, the shade
 *  by the other, no arrows. Null for one condition (colorBy alone) or the cluster colouring. */
export function clusterTwoConds(
  c: ClusterConfig,
  numeric: NumericConds
): {
  color: ConditionKey[]
  shade: ConditionKey
  arrow: 'none'
} | null {
  const picks = clusterColorConds(c, numeric)
  const shade = picks.find((k) => isNumericCond(k, numeric))
  const color = picks.find((k) => k !== shade)
  return picks.length === 2 && shade && color ? { color: [color], shade, arrow: 'none' } : null
}

/** Past this many levels of the primary condition (the one a plot colours by first — see
 *  primaryColorLevels), a Clean-data plot's condition colouring starts off (a heatmap's condition
 *  bar, a bar or QC plot's fill by condition): a categorical palette has ~10 distinct colours, so
 *  more levels would repeat them. A tile that set it either way keeps that. */
export const MAX_COLOR_LEVELS = 10

/** How many distinct values the primary colour condition has in this data — the condition a new
 *  plot colours by (defaultColorConds: the first categorical one, e.g. cell or cmpd). Read off the
 *  samples (the rows when an older result has none); 0 with no condition at all. */
export function primaryColorLevels(
  std: Pick<StandardizeResult, 'activeConditions' | 'samples' | 'rows' | 'numericConditions'>
): number {
  const [c] = defaultColorConds(std.activeConditions, numericOf(std))
  if (!c) return 0
  const seen = new Set<string>()
  for (const s of std.samples ?? std.rows) {
    const v = condValue(s, c)
    if (v != null && v !== '') seen.add(String(v))
  }
  return seen.size
}

/** Whether a Clean-data plot colours by condition when its config doesn't say: while the primary
 *  condition's levels fit the categorical palette (primaryColorLevels). */
export const condColorByDefault = (levels: number): boolean => levels <= MAX_COLOR_LEVELS

/** A sample axis' order options (heatmap, gene bar, QC), with their labels — the settings select
 *  and the tile's switch bar share them. */
export const SAMPLE_ORDERS: readonly SampleOrder[] = ['natural', 'original']
/** What each order means, for the settings select's options. */
export const SAMPLE_ORDER_HINT: Record<SampleOrder, string> = {
  natural: 'natural (by condition, grouped with the fewest breaks)',
  original: 'original (the data’s sample order)'
}
/** A plot's sample order: as set, else natural. */
export const sampleOrderOf = (c: { sampleOrder?: SampleOrder }): SampleOrder =>
  c.sampleOrder === 'original' ? 'original' : 'natural'

/** A Clean-data heatmap's condition bar: as set, else on while the primary condition's levels fit
 *  the palette (condColorByDefault). */
export const heatmapCondBar = (c: HeatmapConfig, levels: number): boolean =>
  c.condBar ?? condColorByDefault(levels)

/** The most clusters a fold-change heatmap's gene or condition tree is cut into (a tree of fewer
 *  rows / columns: one cluster each). */
export const DENDRO_CLADES_DEFAULT = 10

/** A fold-change heatmap's linkages (hierarchical, euclidean distance), for the settings select. */
export type HeatmapLinkage = Extract<Linkage, 'ward' | 'complete'>
export const HEATMAP_LINKAGES: Record<HeatmapLinkage, string> = {
  ward: 'Ward (compact, even-sized clusters)',
  complete: 'complete (farthest pair — tight clusters)'
}
/** …and its leaf orders. */
export const HEATMAP_LEAF_ORDERS: Record<LeafOrder, string> = {
  mean: 'by mean (branches low → high log₂FC)',
  optimal: 'optimal (neighbouring rows most alike)'
}

/** The conditions a bar plot colours by — none when it colours by value. Reads an older config's
 *  single condition key in `colorBy` too. Unset (a new tile) → by condition while the primary
 *  condition's levels fit the palette, else by value (condColorByDefault). Coloured by condition with none picked yet → the default
 *  (defaultColorConds of the data's `active` conditions). */
export function barColorConds(
  c: BarConfig,
  active: readonly ConditionKey[],
  levels: number,
  numeric: NumericConds
): ConditionKey[] {
  const by = c.colorBy ?? (condColorByDefault(levels) ? 'condition' : 'value')
  if (by === 'condition') return (c.colorConds ?? defaultColorConds(active, numeric)).slice(0, 2)
  if (by !== 'value') return [by]
  return []
}

export const heatmapCapOn = (c: HeatmapConfig): boolean => capOn(c.capEnabled, c.maxGenes)

/** Contrast scatter (FC1 vs FC2); labels the top-N most divergent genes. */
export interface ScatterConfig extends FcPaletteConfig {
  /** cap labels: explicit switch (undefined on older configs → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N most divergent genes (applied only while `capEnabled`) */
  labelTop: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
export const labelCapOn = (c: VolcanoConfig | ScatterConfig | PotencyConfig): boolean =>
  capOn(c.capEnabled, c.labelTop)

/** MA plot (compare): mean abundance vs log2FC, with fold-change guide lines. */
export interface MAConfig extends FcPaletteConfig {
  fcLow: number
  fcHigh: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Response curves (compare) over dose or time: every gene drawn, the top-N coloured. */
/** Per-field switch for a plot's quick-access switch bars in its tile: `quick[field] === false`
 *  hides that field's bar (the gear still has it). Unset fields are surfaced. */
export type QuickAccess = Record<string, boolean>
/** Quick access a kind's settings start with, where it isn't simply on: a setting not listed is on.
 *  The user's own choice (`quick`) always wins. Cluster: only the plot type, the colouring and the
 *  territory sit on the tile by default — the rest are tuned once, in the settings window. Heatmap:
 *  of the clustering, only the linkage, leaf order and gene modules. */
export const QUICK_DEFAULTS: Partial<Record<NodeKind, Record<string, boolean>>> = {
  pca: { clusterOn: false, clusterCount: false, display: false },
  // log₂FC heatmap: of its clustering, the linkage, leaf order and gene modules sit on the tile by
  // default; the trees and the condition modules are tuned in the settings window
  heatmap: {
    geneTree: false,
    condModules: false,
    condTree: false
  },
  // the 3-D projection is set once, in the settings window
  response: { projection: false },
  tdr: { projection: false }
}
/** Whether a setting is surfaced in the tile as a quick-access switch bar: the user's choice, else
 *  the kind's default (QUICK_DEFAULTS), else on. */
export const quickOn = (
  cfg: { quick?: QuickAccess } | undefined,
  field: string,
  kind?: NodeKind
): boolean => cfg?.quick?.[field] ?? (kind ? QUICK_DEFAULTS[kind]?.[field] : undefined) ?? true

/** Variance plot (from an ANOVA): how each gene's variation splits among the model's factors
 *  (main effects and interaction) and the residual — its shares of the gene's sum of squares. */
export interface VarianceConfig {
  /** every gene's share per factor as a violin each ('overview', shown as "global"; default), the
   *  selected genes' (else the top genes') share bars ('detail'), or one gene's ('focus') */
  view?: 'overview' | 'detail' | 'focus'
  /** detailed: how many genes when none are selected — the most significant ones */
  topGenes: number
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Interaction plot (from an ANOVA): one gene at a time — its cell means (the model's fit, in
 *  abundance) across one factor's levels, a line per level of the other, its replicates as points
 *  and each mean's standard error as a band or whiskers. Its look is the DR plot's (drLook): the
 *  line, the points and the error, each with its colour ('auto' = one per line), size and opacity. */
export interface InteractionConfig extends Pick<
  DRConfig,
  | 'lineWidth'
  | 'lineColor'
  | 'lineOpacity'
  | 'points'
  | 'pointSize'
  | 'pointColor'
  | 'pointOpacity'
  | 'errors'
  | 'errorStyle'
  | 'errorColor'
  | 'errorOpacity'
> {
  /** the factor along x (a condition key); unset = the model's first factor */
  xFactor?: ConditionKey
  /** the factor drawn as lines (three or more factors; the rest are averaged); unset, or x = the
   *  first factor other than x */
  lineFactor?: ConditionKey
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

export interface DRConfig extends FcPaletteConfig {
  /** the numeric condition along x — the tile's own (one Response plot per numeric condition) */
  axis: ConditionKey
  /** a response surface method curve fit: draw its description 4PL ('curve', default) or the
   *  spline its detection fitted ('spline') */
  model?: 'spline' | 'curve'
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: colour only the top-N most-differential genes (applied only while `capEnabled`;
   *  otherwise all are coloured, up to the renderer's safety cap) */
  topGenes: number
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
  /** one gene at a time (a Contrast-fed DR, or a Compare-fed one focused): the value axis scaled
   *  to the whole result, so genes compare, or to each gene's own values. Default: global from a
   *  Contrast, per gene from a Compare (as the gene bar) — see drYScale. */
  yScale?: 'global' | 'gene'
  /** a Compare-fed DR: every gene at once ('overview', shown as "global"; default), or one gene
   *  at a time with its points (and, for a curve fit, the fitted curve and EC50) — 'focus'. The
   *  focused pager steps through every gene, or only the selected ones while any are selected.
   *  'detail' ("detailed"): the top-N genes by response (at most DR_DETAIL_CAP; picked from the
   *  selected genes while any are selected) without the every-gene background, each drawn in full
   *  as focused. */
  view?: 'overview' | 'detail' | 'focus'
  /** the response lines: width (px; default 2), colour ('auto', the default = one colour per
   *  comparison when focused — the gene's effect group (up / down / none) when it's the only one —
   *  per gene in the global view, per side from a Contrast), opacity (0–1;
   *  default 1). In the global view these style the coloured curves; the faint every-gene
   *  background keeps its own look. */
  lineWidth?: number
  lineColor?: string
  lineOpacity?: number
  /** focused view: the points behind each line (a t-test's replicates, a curve fit's measured
   *  points; from a Contrast, each side's level means on its line) — shown (default), size (px;
   *  default 7), colour ('auto' = the line's), opacity (0–1; default 0.5) */
  points?: boolean
  pointSize?: number
  pointColor?: string
  pointOpacity?: number
  /** focused view: the error — a t-test's (or a Contrast's) fold-change SE, a curve fit's 95%
   *  confidence band — shown (default; hidden by default from a Curve fit), as a shaded band
   *  (default) or whiskers, colour ('auto' = the line's), opacity (0–1; default 0.2 for a band, 1
   *  for whiskers) */
  errors?: boolean
  errorStyle?: 'whisker' | 'band'
  errorColor?: string
  errorOpacity?: number
  /** focused / detailed view, from a Curve fit: a dotted line at each curve's EC50 (the 4PL's
   *  midpoint) — off by default */
  ec50Line?: boolean
}
/** The most genes the DR's detailed view draws in full (each with its points and error). */
export const DR_DETAIL_CAP = 5

/** A DR's line / point / error look with every default filled in ('auto' colours stay 'auto' —
 *  the view resolves them per series). */
export interface DRLook {
  lineWidth: number
  lineColor: string
  lineOpacity: number
  points: boolean
  pointSize: number
  pointColor: string
  pointOpacity: number
  errors: boolean
  errorStyle: 'whisker' | 'band'
  errorColor: string
  errorOpacity: number
  ec50Line: boolean
}
// One resolved look per config object (the store replaces the object on any edit), so a view's
// memo keyed on the look only rebuilds when a setting actually changed — one cache per upstream
// kind, as a Curve fit's defaults differ.
const drLookCache = new WeakMap<object, DRLook>()
const drLookCurveCache = new WeakMap<object, DRLook>()
/** A DR's look; `curveFit` — fed by a Curve fit, whose error (its confidence band) is hidden by
 *  default. */
export function drLook(c: Partial<DRConfig>, curveFit = false): DRLook {
  const cache = curveFit ? drLookCurveCache : drLookCache
  let look = cache.get(c)
  if (!look) cache.set(c, (look = resolveDRLook(c, curveFit)))
  return look
}
/** A one-gene DR's value-axis scale: the setting, else global from a Contrast, per gene from a
 *  Compare. */
export const drYScale = (c: Partial<DRConfig>, fromContrast: boolean): 'global' | 'gene' =>
  c.yScale ?? (fromContrast ? 'global' : 'gene')
function resolveDRLook(c: Partial<DRConfig>, curveFit: boolean): DRLook {
  // A shaded band by default, from a Compare or a Contrast alike.
  const errorStyle = c.errorStyle ?? 'band'
  return {
    lineWidth: c.lineWidth ?? 2,
    lineColor: c.lineColor ?? 'auto',
    lineOpacity: c.lineOpacity ?? 1,
    points: c.points ?? true,
    pointSize: c.pointSize ?? 7,
    pointColor: c.pointColor ?? 'auto',
    pointOpacity: c.pointOpacity ?? 0.5,
    errors: c.errors ?? !curveFit,
    errorStyle,
    errorColor: c.errorColor ?? 'auto',
    errorOpacity: c.errorOpacity ?? (errorStyle === 'band' ? 0.2 : 1),
    ec50Line: c.ec50Line ?? false
  }
}
/** Curve metrics plot (a Curve fit's): one gene's fitted parameter as a bar chart — a surface's per
 *  slice level (graph/metricBars.ts). Genes from the gene picker, the metric from a switch. */
export interface MetricsConfig {
  /** the metric drawn (unset: the potency — graph/metricBars.ts METRIC_IDS) */
  metric?: 'potency' | 'slope' | 'front' | 'back'
  /** a 2-D fit's per-slice values as they are (unset / 'value') or as their difference from the
   *  reference slice's ('delta': the lowest level — dose 0, the vehicle's curve) */
  show?: 'value' | 'delta'
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
}
/** Potency plot (curve-fit Compare, as CurveCurator draws it): each curve's potency (pEC50)
 *  against its curve fold change. */
export interface PotencyConfig extends FcPaletteConfig {
  /** every curve (default), or the called curves only — a flat curve's pEC50 means little */
  show?: 'called' | 'all'
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** cap labels: explicit switch (undefined → inferred from labelTop > 0) */
  capEnabled?: boolean
  /** cap labels: label only the top-N curves by |fold change| (applied only while `capEnabled`) */
  labelTop: number
  /** marker/legend/highlight look; unset fields fall back to the plot's defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
  /** tile orientation (persisted); undefined = portrait default — the potency up the side, the
   *  fold change across (landscape: CurveCurator's layout, the potency across) */
  orient?: PlotOrient
}
/** Response plot: a Curve fit's dose × time surfaces (the response surface method), one gene at a
 *  time, in 2-D or 3-D. 2-D: dose curves with a line per time ('line') or a dose × time heatmap
 *  ('heatmap'). 3-D: the fitted surface ('surface'), or its dose curves as lines along each time
 *  point ('line') — the surface without the surface. */
export interface ResponseConfig extends FcPaletteConfig {
  /** a Curve fit's surface plot: the pair it is for (its fit's — absent: dose × time) */
  pair?: [ConditionKey, ConditionKey]
  /** the value axis fitted to each gene's own values ('gene', default — shown as "adjusted") or
   *  to every gene's in the facet, so paging genes keeps one scale */
  yScale?: 'gene' | 'global'
  /** unset: 3-D for a 'surface' show (configs from before the switch), else 2-D */
  dim?: '2d' | '3d'
  /** what's drawn; one the dimension can't draw (a heatmap in 3-D, a surface in 2-D) falls back
   *  to the dimension's default (see responseShow) */
  show?: 'line' | 'surface' | 'heatmap'
  /** The surface viewed by slices at each time (dose curves; the default) or at each dose (time
   *  curves): the lines a 3-D line view draws, and — with a slices description, whose dose and time
   *  curves are separate fits — the curves its surface and heatmap are built from. Unset on a result
   *  described by the older 'doseSlices': by dose (see responseSlice). */
  slice?: 'time' | 'dose'
  /** 3-D: the camera's projection — orthographic (default; parallel lines stay parallel, so
   *  levels line up across the box) or perspective (the far side drawn smaller) */
  projection?: 'perspective' | 'orthographic'
  /** the lines: width (px; default 2), colour ('auto' = one per slice, low → high, along
   *  `linePalette` — unset: the dose / time levels' palette role, as the lines are per dose / per
   *  time), opacity. Earlier versions stored the palette's name, with `linePaletteReverse` beside
   *  it; both are still read. */
  linePalette?: PaletteRef | string
  linePaletteReverse?: boolean
  lineWidth?: number
  lineColor?: string
  lineOpacity?: number
  /** the level means: shown (default), size in the 2-D and 3-D views each (px; default 7 in
   *  2-D, 3 in 3-D), colour ('auto' = each one's log₂ on the value palette, as the surface),
   *  opacity (default 0.5) */
  points?: boolean
  pointSize?: number
  pointSize3d?: number
  pointColor?: string
  pointOpacity?: number
  /** the 3-D surface's opacity (default 0.85) */
  surfaceOpacity?: number
  /** the surface's curves, traced on it in both directions (a dose curve at each time, a time
   *  curve at each dose): shown (default), width (px; default 1), colour ('auto' = the text
   *  colour), opacity (default 0.6) */
  curves?: boolean
  curveWidth?: number
  curveColor?: string
  curveOpacity?: number
  /** earlier versions' value scale (a Plotly name, or 'effect'); now `fcPalette`, still read */
  colorScale?: string
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
}
export const responseDim = (c: Partial<ResponseConfig>): '2d' | '3d' =>
  c.dim ?? (c.show === 'surface' ? '3d' : '2d')
/** The view drawn: the pick, unless its dimension can't draw it (heatmap 3-D, surface 2-D). */
export function responseShow(c: Partial<ResponseConfig>): 'line' | 'surface' | 'heatmap' {
  const dim = responseDim(c)
  const show = c.show ?? 'line'
  if (dim === '3d' && show === 'heatmap') return 'surface'
  if (dim === '2d' && show === 'surface') return 'line'
  return show
}
/** Why a show can't be picked in a dimension (its tooltip), else undefined. */
/** A Response plot's slice direction: its setting, else by dose for a surface described by the
 *  older 'doseSlices' fit (drawn per dose, as it was), else by time. */
/** The slice switch as the plot names it — by the curves drawn: dose curves (a slice at each time)
 *  or time curves (a slice at each dose). Stored as the slice direction (`slice`). */
export const CURVE_OF_SLICE = { time: 'dose', dose: 'time' } as const
export const SLICE_OF_CURVE = { dose: 'time', time: 'dose' } as const

export function responseSlice(
  cfg: { slice?: 'time' | 'dose' },
  rows: ReadonlyArray<{ rs?: { surface?: { method?: string } } }> | undefined
): 'time' | 'dose' {
  return cfg.slice ?? (rows?.some((r) => r.rs?.surface?.method === 'doseSlices') ? 'dose' : 'time')
}

/** Whether a Response plot's view can be switched between time and dose slices: every line view
 *  (2-D or 3-D) can; a 3-D surface only from a slices description (separate dose and time curves
 *  — a joint model or measured values are the same whichever way they're sliced). Never the 2-D
 *  heatmap: it draws the measured cells, so there are no curves to switch. */
export function responseSliceable(
  dim: '2d' | '3d',
  show: string,
  rows: ReadonlyArray<{ rs?: { axis?: string; surface?: { method?: string } } }> | undefined
): boolean {
  if (show === 'line') return true
  if (show === 'heatmap') return false
  return !!rows?.some((r) => r.rs?.surface && r.rs.surface.method !== 'joint')
}

/** A result's rows' key for a cache: its table when columnar, else its rows array. */
const rowsKey = (holder: { rows: readonly object[] }): object => holderTable(holder) ?? holder.rows

const surfaceRows = new WeakMap<object, Array<{ rs: { surface: { method?: string } } }>>()
/** A Compare's response surfaces (`rs.surface`), one row each — of the rows that have one, the only
 *  rows responseSlice, responseSliceable and a joint-surface check can pass on — read off the nested
 *  column (no row built). Cached per table (or rows). */
export function responseSurfaceRows(cmp: {
  rows: readonly CompareResultRow[]
}): Array<{ rs: { surface: { method?: string } } }> {
  const key = rowsKey(cmp)
  let out = surfaceRows.get(key)
  if (!out) {
    const surface = nestedCol(cmp, 'rs', 'surface')
    out = []
    for (let r = 0; r < rowCount(cmp); r++) {
      const s = surface(r) as { method?: string } | null | undefined
      if (s) out.push({ rs: { surface: s } })
    }
    surfaceRows.set(key, out)
  }
  return out
}

const replicatedCurves = new WeakMap<object, boolean>()
/** curvesReplicated over a Compare's rows, read off the nested columns — only the curve fields it
 *  reads, of the rows with points (no row built). Cached per table (or rows). */
export function curvesReplicatedOf(cmp: { rows: readonly CompareResultRow[] }): boolean {
  const key = rowsKey(cmp)
  let out = replicatedCurves.get(key)
  if (out === undefined) {
    const [x, rep, cy, crep] = ['x', 'rep', 'cy', 'crep'].map((k) => nestedCol(cmp, 'curve', k))
    const kept: Parameters<typeof curvesReplicated>[0][number][] = []
    for (let r = 0; r < rowCount(cmp); r++)
      if (x(r))
        kept.push({
          curve: {
            x: x(r) as number[],
            rep: rep(r) as Array<number | null> | undefined,
            cy: cy(r) as number[] | undefined,
            crep: crep(r) as Array<number | null> | undefined
          }
        })
    out = curvesReplicated(kept)
    replicatedCurves.set(key, out)
  }
  return out
}

export const responseShowWhy = (dim: '2d' | '3d', show: string): string | undefined =>
  dim === '3d' && show === 'heatmap'
    ? 'A heatmap is 2-D — switch the view to 2D'
    : dim === '2d' && show === 'surface'
      ? 'A surface is 3-D — switch the view to 3D'
      : undefined
/** A Response plot's look with every default filled in ('auto' colours stay 'auto'). */
export interface ResponseLook {
  lineWidth: number
  lineColor: string
  lineOpacity: number
  /** the plot's own line palette (undefined = the dose / time levels' role) */
  linePalette: PaletteRef | undefined
  points: boolean
  /** 2-D and 3-D, each; unset → the plot's default (the view picks) */
  pointSize: number | undefined
  pointSize3d: number | undefined
  pointColor: string
  pointOpacity: number
  surfaceOpacity: number
  curves: boolean
  curveWidth: number
  curveColor: string
  curveOpacity: number
  /** the surface / heatmap's own palette (undefined = the global fold-change palette) */
  valuePalette: PaletteRef | undefined
  /** the measured values' error (the Time & Dose-response plot's; see TdrConfig) */
  errors: boolean
  errorStyle: 'whisker' | 'band'
  errorColor: string
  errorOpacity: number
}
// One resolved look per config object (as drLook), so the view's memo rebuilds only on an edit.
const responseLookCache = new WeakMap<object, ResponseLook>()
export function responseLook(c: Partial<TdrConfig>): ResponseLook {
  let look = responseLookCache.get(c)
  if (!look) responseLookCache.set(c, (look = resolveResponseLook(c)))
  return look
}
const resolveResponseLook = (c: Partial<TdrConfig>): ResponseLook => ({
  lineWidth: c.lineWidth ?? 2,
  lineColor: c.lineColor ?? 'auto',
  lineOpacity: c.lineOpacity ?? 1,
  linePalette: toPaletteRef(c.linePalette, c.linePaletteReverse),
  points: c.points ?? true,
  pointSize: c.pointSize,
  pointSize3d: c.pointSize3d,
  pointColor: c.pointColor ?? 'auto',
  pointOpacity: c.pointOpacity ?? 0.5,
  surfaceOpacity: c.surfaceOpacity ?? 0.85,
  curves: c.curves ?? true,
  curveWidth: c.curveWidth ?? 1,
  curveColor: c.curveColor ?? 'auto',
  curveOpacity: c.curveOpacity ?? 0.6,
  // an earlier 'effect' (or a Plotly scale with no counterpart) follows the global palette
  valuePalette: toPaletteRef(c.fcPalette) ?? toPaletteRef(c.colorScale),
  errors: c.errors ?? true,
  errorStyle: c.errorStyle ?? 'band',
  errorColor: c.errorColor ?? 'auto',
  errorOpacity: c.errorOpacity ?? ((c.errorStyle ?? 'band') === 'band' ? 0.2 : 1)
})
/** QC plots (curve-fit QC, after CurveCurator's MAD analysis): each dose's residuals from the
 *  curves' fits, as violins with their outliers — or the curves' metrics against each other. */
/** A QC plot's check: by dose (replicates pooled — CurveCurator's MAD view: a dose off zero
 *  is a sample problem), by sample (dose × replicate — one bad injection), against the fitted value
 *  (constant variance), or normality (a Q–Q plot) — the last two the F-test's assumptions — or the
 *  curves' own metrics, one against another (each curve a dot). */
export type ResidualCheck = 'dose' | 'sample' | 'fitted' | 'normality' | 'metrics'

/** The metrics the QC plot's metrics check can put on an axis: the curve fold change, a curve's
 *  parameters and fit quality (curveMetrics), and its test. */
export const CURVE_QC_METRICS = [
  'log2FC',
  'pEC50',
  'slope',
  'front',
  'back',
  'R2',
  'RMSE',
  'F',
  'pP',
  'F_lof',
  'pP_lof',
  'relevance',
  'q_decoy'
] as const
export type CurveQcMetric = (typeof CURVE_QC_METRICS)[number]
export const CURVE_QC_METRIC_LABEL: Record<CurveQcMetric, string> = {
  log2FC: 'curve log₂FC',
  pEC50: 'pEC50',
  slope: 'slope',
  front: 'front',
  back: 'back',
  R2: 'R²',
  RMSE: 'RMSE',
  F: 'F',
  pP: '−log₁₀ P-value',
  F_lof: 'lack-of-fit F',
  pP_lof: 'lack-of-fit −log₁₀ P',
  relevance: 'relevance',
  q_decoy: 'q (decoy)'
}
/** The metrics check's axes when unset: R² (y) against the curve log₂FC (x) — whether the strong
 *  responses are also well-fitted ones. */
export const CURVE_QC_DEFAULT_X = 'log2FC' satisfies CurveQcMetric
export const CURVE_QC_DEFAULT_Y = 'R2' satisfies CurveQcMetric
/** A metrics-check axis: a metric, or none — the other axis's metric then shown as a distribution
 *  (a histogram of the curves along it). */
export type CurveQcAxis = CurveQcMetric | 'none'
/** The metric pick-list's groups, in order, and each metric's: what it tells of a curve — its
 *  effect, whether it beats flat, the 4PL's parameters, how well the 4PL describes the data. */
const CURVE_QC_GROUPS = ['response', 'significance', 'curve parameters', 'fit quality'] as const
const CURVE_QC_GROUP: Record<CurveQcMetric, (typeof CURVE_QC_GROUPS)[number]> = {
  log2FC: 'response',
  F: 'significance',
  pP: 'significance',
  relevance: 'significance',
  q_decoy: 'significance',
  pEC50: 'curve parameters',
  slope: 'curve parameters',
  front: 'curve parameters',
  back: 'curve parameters',
  R2: 'fit quality',
  RMSE: 'fit quality',
  F_lof: 'fit quality',
  pP_lof: 'fit quality'
}
/** The metric pick-list for one axis, grouped (CURVE_QC_GROUP): none first while the other axis
 *  has a metric (both none would show nothing), then each group's metrics — the other axis's own
 *  pick marked (highlighted, its tooltip saying where). */
export function curveQcAxisOptions(
  other: CurveQcAxis,
  otherAxis: 'x' | 'y'
): { value: CurveQcAxis; label: string; group?: string; marked?: string }[] {
  return [
    ...(other !== 'none' ? [{ value: 'none' as const, label: 'none (freq)' }] : []),
    ...CURVE_QC_GROUPS.flatMap((g) =>
      CURVE_QC_METRICS.filter((m) => CURVE_QC_GROUP[m] === g).map((m) => ({
        value: m,
        label: CURVE_QC_METRIC_LABEL[m],
        group: g,
        ...(m === other ? { marked: `Picked on the ${otherAxis} axis` } : null)
      }))
    )
  ]
}

export interface CurveMadConfig {
  /** the residual axis: 'range' spans every residual, outliers included; 'fit' (default) is
   *  symmetric about zero and holds 99.9% of the residuals, so a few extremes don't flatten them */
  yScale?: 'fit' | 'range'
  /** each dose's residuals as a violin (quartile box, outlier dots) or every residual as a
   *  dot (default; quartile box over them) */
  show?: 'violin' | 'dot'
  /** what the residuals are checked against (see ResidualCheck); unset = 'dose' */
  check?: ResidualCheck
  /** the metrics check's x and y (unset = R² against curve log₂FC — CURVE_QC_DEFAULT_X / _Y); one
   *  may be 'none' — the other's
   *  distribution */
  metricX?: CurveQcAxis
  metricY?: CurveQcAxis
  /** cap points: the dot views draw at most `maxPoints` residuals (every outlier kept, the rest
   *  sampled evenly — thinPoints); unset = on, at RESIDUAL_DOT_CAP, which is also the most it
   *  takes (a larger stored value is read as it). Off draws them all (slow past ~20k). Boxes, medians and trend lines always use every residual. */
  capEnabled?: boolean
  maxPoints?: number
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** marker/legend look of the control and dosed samples; unset fields use the defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
/** Bubble grid (compare) over dose or time, one gene per row. */
export interface BubbleConfig extends FcPaletteConfig {
  axis: ConditionKey
  /** the up / down / none colours, this plot's own; unset (or 'auto') = the upstream Compare's */
  effectColors?: PlotEffectColors
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N by |log2FC| (applied only while `capEnabled`; otherwise all, up to the
   *  renderer's safety cap) */
  topGenes: number
  /** what ranks the top genes: their log₂FC ('fc', default) or the significance column the
   *  upstream Compare calls by ('sig' — its P or Q value) */
  rank?: 'fc' | 'sig'
  /** that score over the dose/time levels: its peak ('peak', default) or its total */
  over?: 'peak' | 'total'
  /** what a bubble's size shows: |log₂FC| ('fc', default) or −log₁₀ of the Compare's P or Q */
  sizeBy?: 'fc' | 'sig'
  /** what its colour shows: log₂FC on the FC palette ('fc', default), or −log₁₀ P/Q on `sigPalette` */
  colorBy?: 'fc' | 'sig'
  /** the palette −log₁₀ P/Q is coloured on (unset = Purples, BUBBLE_SIG_PALETTE) */
  sigPalette?: PaletteRef
  /** what its outline's width shows: nothing ('none', default — no outline), |log₂FC| or −log₁₀ P/Q */
  outlineBy?: 'none' | 'fc' | 'sig'
  /** the outline's colour (unset or 'auto' = a darker shade of each bubble's own colour) */
  outlineColor?: string
  /** a ∗ at the centre of each bubble significant at its level */
  asterisk?: boolean
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Dumbbell (contrast): FC1↔FC2 per gene, top-N by |FCdiff|. */
export interface DumbbellConfig {
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N significant genes by |FCdiff| (applied only while `capEnabled`; otherwise
   *  all significant, up to the renderer's safety cap) */
  topGenes: number
  /** gene order: by the first side's value, the second side's, or |FCdiff| (unset = 'diff') */
  order?: 'fc1' | 'fc2' | 'diff'
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
export const geneCapOn = (c: BubbleConfig | DumbbellConfig | DRConfig): boolean =>
  capOn(c.capEnabled, c.topGenes)

/** Two-condition Response plot (compare; dose × time, or any pair of numeric conditions — `pair`):
 *  one gene's measured log₂FC over the two, drawn as the Response plot draws a surface — 2-D lines
 *  per level of the second or a heatmap, 3-D lines (per level of either, `slice`) or a surface —
 *  with the same settings. */
export interface TdrConfig extends ResponseConfig {
  /** the line views' error — each level's fold change SE, as the Dose/time-response plot's
   *  focused view draws it: shown (default), as a shaded band (default) or
   *  whiskers, its colour ('auto' = the line's) and opacity (default 0.2 band, 1 whiskers) */
  errors?: boolean
  errorStyle?: 'whisker' | 'band'
  errorColor?: string
  errorOpacity?: number
  /** earlier versions' x / y axis overrides (a 2-D dose plot); no longer applied */
  axes?: PlotAxes
  /** the two numeric conditions it's over — the first along x, the second one line (slice) per
   *  level; the tile's own (one plot per pair). Unset (configs from before): dose × time. Its
   *  `slice` names them by slot: 'time' = a line per level of the second, 'dose' = of the first. */
  pair?: [ConditionKey, ConditionKey]
}

/** A Time & Dose-response (tdr) plot's two numeric conditions (see TdrConfig.pair). */
export const tdrPair = (c: Partial<TdrConfig> | null | undefined): [ConditionKey, ConditionKey] =>
  c?.pair ?? ['dose', 'time']

/** Gene bar (standardize): each selected gene's value across every condition. */
export interface BarConfig {
  /** its categorical palette (unset = the global one, app settings → categorical) */
  categorical?: import('../ui/palettes').CategoricalId
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
  /** the value axis scaled to each gene's own values — its min to its max (default) — or to the
   *  whole dataset's, so paging genes keeps one scale */
  yScale?: 'global' | 'gene'
  /** the conditions along the axis: natural by condition (default) or the data's own order */
  sampleOrder?: SampleOrder
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** each replicate drawn as a dot over its bar (off by default) */
  replicates?: boolean
  /** replicate dot size (px; default 6) and opacity (0–1; default 0.6) */
  repSize?: number
  repOpacity?: number
  /** replicate dot colour: 'auto' (default) = its bar's group colour (without the numeric
   *  condition's shade), else a fixed colour */
  repColor?: string
  /** replicate dots spread sideways across the bar (default) or in one column over its centre */
  repJitter?: boolean
  /** the error bars: standard deviation (default), standard error of the mean, or 95% CI */
  error?: 'sd' | 'sem' | 'ci95'
  /** error bar line width (px; default 1.4) */
  errorWidth?: number
  /** error bar colour: 'auto' (default) = its bar's group colour (without the numeric condition's
   *  shade), else a fixed colour */
  errorColor?: string
  /** bar fill: by value or by condition (`colorConds`); unset = by condition with few samples, by
   *  value with many. An older config may hold a single condition key here — read it through
   *  barColorConds. */
  colorBy?: 'value' | 'condition' | ConditionKey
  /** colour by condition: up to two — one categorical (the colour) and one numeric, dose or time
   *  (the shade, light = low → dark = high) */
  colorConds?: ConditionKey[]
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Enrichment (compare): over-representation of GO / KEGG / COG / MSigDB / Reactome terms in the
 *  significant gene set, drawn as a dot or bar plot. Reads the annotations fetched in the
 *  interactive import. */
export interface EnrichConfig extends FcPaletteConfig {
  /** the up / down / none colours, this plot's own; unset (or 'auto') = the upstream Compare's */
  effectColors?: PlotEffectColors
  /** 'ora' = over-representation (hypergeometric); 'gsea' reserved (ranked, not yet computed). */
  method: 'ora' | 'gsea'
  /** which annotation term set to test */
  source: EnrichSource
  /** plot style ('ridge' is GSEA-only: per-set log₂FC density ridges) */
  style: 'dot' | 'bar' | 'ridge'
  /** how many top terms to show */
  topTerms: number
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** STRING network (compare): PPI network among the top differential genes, fetched from STRING-DB.
 *  Species comes from the interactive-import annotation fetch (NCBI taxon); a non-zero `species`
 *  here overrides it. Nodes = genes coloured by log₂FC, sized by degree; edges = STRING confidence. */
export interface StringConfig extends FcPaletteConfig {
  /** the up / down / none colours, this plot's own; unset (or 'auto') = the upstream Compare's */
  effectColors?: PlotEffectColors
  /** STRING confidence cutoff bucket (maps to required_score 150/400/700/900); unset = auto, the
   *  highest level at which the query genes still have a network (medium with interactors on) */
  confidence?: 'low' | 'medium' | 'high' | 'highest'
  /** cap on the number of genes (strongest |log₂FC|) sent to STRING */
  maxGenes: number
  /** also include first-shell interactors of the query set (proteins that directly connect to a
   *  differential gene above the confidence threshold). They count toward `maxGenes` like any
   *  other node. */
  addInteractors?: boolean
  /** manual NCBI taxon override; 0/undefined = use the species from the annotation fetch */
  species?: number
  /** the query genes' node outline width, px (unset = STRING_OUTLINE) */
  queryOutline?: number
  /** the query genes' node outline colour (unset or AUTO = black) */
  queryOutlineColor?: string
  /** the first-shell interactors' node outline width, px (unset = STRING_OUTLINE) */
  interactorOutline?: number
  /** the interactors' node outline colour (unset or AUTO = the plot background) */
  interactorOutlineColor?: string
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
}

/** A STRING node's default outline width, px — query genes and interactors alike. */
export const STRING_OUTLINE = 0.5

/** Sample QC plot (standardize): a per-sample distribution of one quality metric, drawn as
 *  a violin, box, or bar. */
export interface QcConfig {
  /** its categorical palette (unset = the global one, app settings → categorical) */
  categorical?: import('../ui/palettes').CategoricalId
  metric: 'intensity' | 'cv' | 'proteins'
  plot: 'violin' | 'box' | 'bar'
  /** # proteins: the count axis global — from zero (default) — or by range, fitted to the counts
   *  so small differences between samples show */
  yScale?: 'global' | 'range'
  /** the samples (or CV's condition groups) along the axis: natural by condition (default) or the
   *  data's own order */
  sampleOrder?: SampleOrder
  /** the fill: one colour for every sample or by condition (`colorConds`); unset = by condition
   *  with few samples, one colour with many (see qcColorBy) */
  colorBy?: 'single' | 'condition'
  /** the single fill colour (default the QC steel blue) */
  color?: string
  /** colour by condition: up to two — one categorical (the colour) and one numeric, dose or time
   *  (the shade, light = low → dark = high), as the gene bar does */
  colorConds?: ConditionKey[]
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** A QC plot's fill: as set, else by condition while the primary condition's levels fit the
 *  palette, one colour past that (condColorByDefault). */
export const qcColorBy = (c: QcConfig, levels: number): 'single' | 'condition' =>
  c.colorBy ?? (condColorByDefault(levels) ? 'condition' : 'single')

/** The conditions a QC plot colours by — none when it uses its single colour; none picked yet (a
 *  new tile) → the default (defaultColorConds of the data's `active` conditions). */
export const qcColorConds = (
  c: QcConfig,
  active: readonly ConditionKey[],
  levels: number,
  numeric: NumericConds
): ConditionKey[] =>
  qcColorBy(c, levels) === 'condition'
    ? (c.colorConds ?? defaultColorConds(active, numeric)).slice(0, 2)
    : []

/** Sample correlation matrix (standardize): all-samples × all-samples Pearson r heatmap. */
export interface CorrConfig {
  /** cluster samples by correlation profile so replicate groups block on the diagonal */
  cluster: boolean
  /** the correlation palette (unset = Greens) */
  palette?: PaletteRef
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Data-table tile (plotting): shows the upstream step's results table interactively in the
 *  dashboard. The upstream step already computes the table; this node just opts a tile in. */
export interface TableConfig {
  /** initial view for tables that offer a Long ⇆ Matrix toggle (standardize/compare/contrast);
   *  absent = matrix. */
  view?: 'long' | 'matrix'
  /** the gene column's display cap in characters (longer names cut with "…", in full on hover);
   *  unset = TABLE_GENE_MAX */
  geneMaxLen?: number
  /** the same for the uniqID column; unset = TABLE_GENE_MAX */
  idMaxLen?: number
  /** colour the value cells (default on) */
  colored?: boolean
  /** the cells' palette (unset: viridis for Clean data's abundance, RdBu reversed for a Compare's
   *  or Contrast's signed values) */
  palette?: PaletteRef
}
/** The table's default display cap for its uniqID and gene columns (TableConfig.idMaxLen /
 *  geneMaxLen). */
export const TABLE_GENE_MAX = 20

/** One plot inside a group tile: a full plot spec with a stable subcard id. The `kind`
 *  is always a plotting op (never `plotGroup` — groups don't nest). */
/** A canvas frame: a labelled, shaded area drawn around some tiles (Group on the canvas), which
 *  moves them together. Purely visual — it doesn't change the wiring or what any step does. Its
 *  box is derived from its members' positions, so it follows them as they move. */
export interface CanvasFrame {
  id: string
  label: string
  /** what's directly inside it: step node ids and nested frame ids (each in at most one frame) */
  members: string[]
  /** form mode only: its steps folded away under the header */
  folded?: boolean
}

export interface PlotChild {
  id: string
  kind: NodeKind
  config: NodeConfig
  /** its own run state — each plot in a group runs (and goes stale) on its own; its result is
   *  stored under plotResultKey(group, child) */
  status?: StepStatus
  error?: string
}

/** Where a plot's run result is kept in the store's `results`: its own id, or — for a plot inside
 *  a group tile — the group's id and the child's. */
export const plotResultKey = (nodeId: string, childId?: string): string =>
  childId ? `${nodeId}/${childId}` : nodeId

/** A group tile (plotting): folds several plots that share ONE upstream into one node,
 *  shown as stacked subcards. Holds no result of its own — each child renders live from
 *  the group's single upstream, exactly as a standalone plot would. */
export interface PlotGroupConfig {
  children: PlotChild[]
  /** canvas only: the subcard stack folded away (display state, saved with the workflow) */
  collapsed?: boolean
}

/** The cluster settings its run computes under: the embedding's, and — colouring by a computed
 *  clustering — the clustering's. Any change to these needs another run; the rest only redraw. */
export interface ClusterRun {
  method: ClusterConfig['method']
  scale: ClusterConfig['scale']
  missing: ClusterConfig['missing']
  center: ClusterConfig['center']
  topVar: ClusterConfig['topVar']
  transform: ClusterConfig['transform']
  replicates: ClusterConfig['replicates']
  /** set only while colouring by cluster: what the groups were computed from */
  clustering?: { on: 'coords' | 'features'; count: 'fixed' | 'conditions' | 'auto'; k?: number }
}

/** A cluster config's run settings (see ClusterRun). */
export const clusterRunOf = (c: ClusterConfig): ClusterRun => {
  const count = c.clusterCount ?? 'fixed'
  return {
    method: c.method,
    scale: c.scale,
    missing: c.missing,
    center: c.center,
    topVar: c.topVar,
    transform: c.transform,
    replicates: c.replicates,
    ...(c.colorBy === 'cluster'
      ? {
          clustering: {
            on: c.clusterOn ?? 'coords',
            count,
            ...(count === 'fixed' ? { k: c.clusterK ?? 3 } : null)
          }
        }
      : null)
  }
}

/** Whether a cluster result was computed under these settings — or a run is needed. Colouring by
 *  a condition reads any run's embedding; colouring by cluster needs the same clustering. */
export function clusterRunMatches(c: ClusterConfig, ran: ClusterRun): boolean {
  const want = clusterRunOf(c)
  const embed = (r: ClusterRun): string =>
    JSON.stringify([r.method, r.scale, r.missing, r.center, r.topVar, r.transform, r.replicates])
  if (embed(want) !== embed(ran)) return false
  return !want.clustering || JSON.stringify(want.clustering) === JSON.stringify(ran.clustering)
}

/** Sample cluster/embedding (standardize): method + coloring condition. */
export interface ClusterConfig {
  /** its categorical palette (unset = the global one, app settings → categorical) */
  categorical?: import('../ui/palettes').CategoricalId
  method: 'pca' | 'umap' | 'tsne'
  /** A condition, or `'cluster'` to colour by a grouping computed from the data itself. */
  colorBy: ClusterColorBy
  /** simple legend, coloured by condition: up to two — one categorical (the colour) and one
   *  numeric, dose or time (the shade, light = low → dark = high), as QC and the gene bar do.
   *  Unset = `colorBy` alone; read only while it includes `colorBy` (see clusterColorConds). */
  colorConds?: ConditionKey[]
  /** `colorBy: 'cluster'` only — what the grouping is computed from. 'coords' clusters the embedded
   *  x/y, so colours always match the visual grouping; 'features' clusters the high-dimensional
   *  matrix, so the grouping is the real structure and is the same under PCA/UMAP/t-SNE. */
  clusterOn?: 'coords' | 'features'
  /** `colorBy: 'cluster'` only — how the group count is chosen: `clusterK`, one per distinct
   *  condition, or the largest gap in the dendrogram. */
  clusterCount?: 'fixed' | 'conditions' | 'auto'
  /** `clusterCount: 'fixed'` only — the number of groups. */
  clusterK?: number
  /** What marks the data: 'replicate' plots every replicate; 'centroid' collapses each
   *  condition's replicates to a single centroid marker. 'territory' is the older combined choice
   *  (centroid + outline) — still read, never written; see clusterLook. */
  display: 'replicate' | 'centroid' | 'territory'
  /** The region each condition's replicates occupy, drawn under the markers (with either
   *  `display`): 'hull' is the convex hull of the replicates, claiming only where measurements
   *  actually landed; 'gaussian' is a ~95% covariance ellipse, smoother and comparable across
   *  conditions but extrapolated; 'none' draws none. A condition with too few (or coincident)
   *  replicates to bound gets no outline. Unset on configs from before it existed — see
   *  clusterLook. */
  outline?: 'hull' | 'gaussian' | 'none'
  /** The older outline shape, read only while `display` is the legacy 'territory'. Kept apart from
   *  `outline` because it could linger set while unused (a shape picked, then display switched
   *  back), and reading it as an outline would draw one on a plot that never showed it. */
  territory?: 'hull' | 'gaussian'
  /** Which plot the tile draws.
   *   - 'pc' (default) — the embedding scatter.
   *   - 'scree' — variance explained per component: how many components the dataset actually
   *     carries, and so whether the 2-D scatter is a fair summary.
   *   - 'loadings' — the most influential features as vectors in the same component plane, showing
   *     WHICH measurements drive the separation rather than only that it exists.
   *  All three are PCA-only choices: UMAP/t-SNE have neither component variances nor feature axes
   *  to project onto, so the control isn't offered for them. */
  plot?: 'pc' | 'scree' | 'loadings'
  /** `plot: 'loadings'` only — how many features to draw, longest vector first. Defaults to 10;
   *  more than a handful turns the plot into a thicket of labels. */
  loadings?: number
  /** 'simple' colours by a single condition (colorBy). 'complex' drives marker aesthetics
   *  from every varying condition at once — colour by the qualitative condition(s), shade
   *  by a quantitative one, and connect a dose/time series with arrows. */
  legend?: 'simple' | 'complex'
  /** complex legend: the conditions colour is by, in order — the first picks a hue family, the
   *  rest spread within it (a single numeric one is a sequential ramp). Unset/empty = automatic
   *  (see planAesthetics). */
  schemeColor?: ConditionKey[]
  /** complex legend: the numeric condition shaded light→dark, 'none', or unset = automatic. Only a
   *  numeric condition can be ordered, so any other is ignored. */
  schemeShade?: ConditionKey | 'none'
  /** complex legend: the numeric condition connected low→high by arrows, 'none', or unset =
   *  automatic — numeric only, as shade. */
  schemeArrow?: ConditionKey | 'none'
  /** markers: replicate dots' size (px; default 8) and opacity (0–1; default 0.9), centroids'
   *  size (default 13) and opacity (default 0.95), and their outline — width (px; unset = 0 on
   *  replicates, 1.5 on centroids) and colour ('auto' = the panel's) */
  markerSize?: number
  markerOpacity?: number
  centroidSize?: number
  centroidOpacity?: number
  outlineWidth?: number
  outlineColor?: string
  /** complex legend's arrow trails: drawn (default), their line width (px; default 2) and opacity
   *  (0–1; default 0.85), the arrowheads' size (default 1), and whether the markers stay visible
   *  under them (default off: the trail stands in for them) */
  arrows?: boolean
  trailWidth?: number
  trailOpacity?: number
  arrowSize?: number
  markersUnderArrows?: boolean
  /** Per-gene scaling before embedding. 'unit' z-scores each gene to unit variance
   *  (correlation PCA — every gene weighted equally); 'none' only mean-centers, letting
   *  high-variance genes dominate (covariance PCA — matches Spectronaut). Defaults to 'unit'. */
  scale?: 'unit' | 'none'
  /** Missing-value policy. 'impute' fills gaps with the gene mean (keeps every gene); 'complete'
   *  drops any gene missing in any sample (Spectronaut-style, no imputation) — imputing instead when that
   *  leaves too few genes (MIN_COMPLETE_FEATURES). Defaults to 'complete'. */
  missing?: 'impute' | 'complete'
  /** Per-sample normalization. 'median' removes each sample's offset; 'zscore' also removes its
   *  scale (per-sample standardization, like Pearson); 'quantile' forces a common distribution;
   *  'none' leaves the log2 values as-is. Defaults to 'median'. */
  center?: 'median' | 'zscore' | 'quantile' | 'none'
  /** Feature selection: embed only the N most-variable genes (0 / undefined = all). Restricting to
   *  the most variable proteins stops p ≫ n dilution from flattening PC1. */
  topVar?: number
  /** Log transform: 'auto' (heuristic), 'log2'/'log10' (force), 'none' (linear). Defaults to
   *  'auto'. */
  transform?: 'auto' | 'log2' | 'log10' | 'none'
  /** Replicate handling: 'individual' embeds every replicate; 'mean' averages to condition means
   *  first (cuts noise, lifts a real group axis). Defaults to 'individual'. */
  replicates?: 'individual' | 'mean'
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
  /** the embedding's axes: 'standard' (default) Plotly's full axes; 'minimal' only two short
   *  segments at the bottom-left corner, each with its axis title — no ticks or numbers */
  axisMode?: 'standard' | 'minimal'
}

/** A cluster plot's marker and arrow-trail look with every default filled in (see ClusterConfig). */
export interface ClusterStyle {
  markerSize: number
  markerOpacity: number
  centroidSize: number
  centroidOpacity: number
  /** undefined = the default, DEFAULT_OUTLINE (0.5 px) */
  outlineWidth?: number
  outlineColor: string
  arrows: boolean
  trailWidth: number
  trailOpacity: number
  arrowSize: number
  markersUnderArrows: boolean
}
/** The settings ClusterStyle is made of, persisted with the tile. */
export const CLUSTER_STYLE_FIELDS = [
  'markerSize',
  'markerOpacity',
  'centroidSize',
  'centroidOpacity',
  'outlineWidth',
  'outlineColor',
  'arrows',
  'trailWidth',
  'trailOpacity',
  'arrowSize',
  'markersUnderArrows'
] as const
// One resolved look per config object (the store replaces it on any edit), so the view's memo
// keyed on it only rebuilds when a setting changed.
const clusterStyleCache = new WeakMap<object, ClusterStyle>()
export function clusterStyle(c: Partial<ClusterConfig>): ClusterStyle {
  let st = clusterStyleCache.get(c)
  if (!st)
    clusterStyleCache.set(
      c,
      (st = {
        markerSize: c.markerSize ?? 8,
        markerOpacity: c.markerOpacity ?? 0.9,
        centroidSize: c.centroidSize ?? 13,
        centroidOpacity: c.centroidOpacity ?? 0.95,
        outlineWidth: c.outlineWidth,
        outlineColor: c.outlineColor ?? 'auto',
        arrows: c.arrows ?? true,
        trailWidth: c.trailWidth ?? 2,
        trailOpacity: c.trailOpacity ?? 0.85,
        arrowSize: c.arrowSize ?? 1,
        markersUnderArrows: c.markersUnderArrows ?? false
      })
    )
  return st
}

export type NodeConfig =
  | LoadConfig
  | StandardizeConfig
  | MergeConfig
  | SubsetConfig
  | CompareConfig
  | ContrastConfig
  | VolcanoConfig
  | HeatmapConfig
  | ScatterConfig
  | MAConfig
  | DRConfig
  | PotencyConfig
  | MetricsConfig
  | VarianceConfig
  | InteractionConfig
  | CurveMadConfig
  | ResponseConfig
  | BubbleConfig
  | DumbbellConfig
  | ClusterConfig
  | TdrConfig
  | BarConfig
  | EnrichConfig
  | StringConfig
  | QcConfig
  | CorrConfig
  | TableConfig
  | PlotGroupConfig

/** A Curve fit tile's config: a CompareConfig locked to curve fitting. */
export type CurveFitConfig = CompareConfig & { analysis: 'curve_fit' }

/** Steps whose result is a comparison table (result kind 'compare'): a Compare, or a Curve fit. */
export const isComparisonKind = (k: NodeKind | undefined): boolean =>
  k === 'compare' || k === 'curveFit'

/**
 * A Compare saved in curve-fit mode (before Curve fit was its own tile) as a Curve fit tile: same
 * id, config and wiring, so its parked result and downstream plots carry over. Anything else is
 * returned unchanged.
 */
export function migrateCurveCompare<T extends { kind: NodeKind; config: NodeConfig }>(data: T): T {
  if (data.kind !== 'compare' || (data.config as CompareConfig).analysis !== 'curve_fit')
    return data
  return { ...data, kind: 'curveFit' }
}

/** Data carried on a materialized step node (kept light — heavy results live in the store).
 *  The category is intentionally NOT stored: it is always `categoryOf(kind)`. */
export interface NodeData {
  /** the specific operation — the node's intrinsic type */
  kind: NodeKind
  config: NodeConfig
  status: StepStatus
  error?: string
  /** a non-fatal note from the last run (e.g. an optional input that wasn't found); cleared by
   *  the next status change */
  note?: string
  /** optional user-given name for the tile; falls back to the kind's type label when unset.
   *  Category (processing/plotting) and type (kind label) are intrinsic; this is the only
   *  user-facing label the user controls. */
  name?: string
  [key: string]: unknown
}

/** Data for a transient placeholder tile: created on drop, before its op is chosen.
 *  It has no `kind` yet, so no invalid `kind`/category combination can ever exist. */
export interface PlaceholderData {
  /** valid next ops offered to the user (already filtered by `canConnect`) */
  ops: NodeKind[]
  /** upstream node this placeholder tentatively connects from (absent for a free "New step") */
  source?: string
  [key: string]: unknown
}

/** A React Flow node is either a real step (`'step'`) or a pending placeholder. */
export type StepNode = Node<NodeData, 'step'>
export type PlaceholderNode = Node<PlaceholderData, 'placeholder'>
export type GraphNode = StepNode | PlaceholderNode

/** Narrow a graph node to a materialized step (has a concrete `kind`). */
export function isStep(n: GraphNode): n is StepNode {
  return n.type === 'step'
}

// ── computed results (kept out of React Flow node.data) ─────────────────────────

export type NodeResult =
  | { kind: 'standardize'; std: StandardizeResult }
  | {
      kind: 'compare'
      cmp: VehNormResult
      displayMap: Record<string, string>
      /** uniqID → annotation columns (GO / KEGG / COG …), carried from Clean data for enrichment */
      annotationMap: Record<string, Record<string, string>>
      /** pathway name → KEGG category, carried from Standardize for grouping enrichment terms */
      keggCategories: Record<string, string>
      /** the custom conditions declared numeric, carried from Clean data (its schema, with dose and
       *  time: numericOfResult). Absent on results from before declarations = none. */
      numericConditions?: CustomConditionKey[]
    }
  | {
      kind: 'contrast'
      ctr: ContrastResult
      displayMap: Record<string, string>
      /** the declared numeric custom conditions of every input it read (numericOfResult) */
      numericConditions?: CustomConditionKey[]
    }
  // ── a plot's run: what it needs to be viewed (see graph/plotRun.ts) ──
  /** a plot drawn straight from its upstream: the run checked it can be (no data of its own) */
  | { kind: 'plot' }
  /** enrichment, every method × term source, per facet (facetKey): every tested term — the tile
   *  shows its top N, the export writes them all */
  | { kind: 'enrich'; facets: Record<string, Record<string, EnrichData>> }
  /** STRING, every confidence × gene cap × interactor setting, per facet (facetKey) — see StringAll */
  | { kind: 'string'; species: number; caps: number[]; facets: Record<string, StringAll> }
  /** a cluster plot's sample embedding (in the worker), with the settings it was computed under
   *  (`ran`, see clusterRunOf) — its view settings (colour by a condition, plot, territory, look)
   *  draw from it without another run */
  | { kind: 'cluster'; cluster: ClusterData; ran: ClusterRun }

/** The numeric conditions of a data result's dataset — its condition schema (dose and time, plus
 *  the custom ones declared numeric at import), as Clean data recorded it and Compare / Contrast
 *  carried it on. Anything else (no result, a plot's own run) has dose and time only. */
export function numericOfResult(r: NodeResult | undefined): NumericConds {
  if (r?.kind === 'standardize') return numericOf(r.std)
  if (r?.kind === 'compare' || r?.kind === 'contrast') return numericConds(r.numericConditions)
  return numericConds()
}

/** The declared numeric custom conditions of several results at once (a Contrast's inputs). */
export const numericUnion = (rs: ReadonlyArray<NodeResult | undefined>): CustomConditionKey[] => [
  ...new Set(
    rs.flatMap((r) =>
      r?.kind === 'standardize'
        ? (r.std.numericConditions ?? [])
        : r?.kind === 'compare' || r?.kind === 'contrast'
          ? (r.numericConditions ?? [])
          : []
    )
  )
]

/** A step's data result — what a downstream step or plot reads (not a plot's own run result). */
export type DataResult = Extract<NodeResult, { kind: 'standardize' | 'compare' | 'contrast' }>
export const isDataResult = (r: NodeResult | undefined): r is DataResult =>
  r?.kind === 'standardize' || r?.kind === 'compare' || r?.kind === 'contrast'

// ── dashboard layout persistence (structural mirror of react-grid-layout's item) ──

/** One tile's grid rectangle. Kept structural (not importing the grid lib) so the
 *  store/persistence layer stays decoupled from the dashboard's grid implementation. */
export interface PanelLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
}

/** A gene reference: its feature uniqID plus the display label captured when it was added, so chips
 *  can render app-wide without a per-node displayMap lookup. */
export interface FavGene {
  id: string
  label: string
}

/** A named, user-defined collection of genes — a saved gene selection the user can switch between. */
export interface GeneSet {
  id: string
  name: string
  genes: FavGene[]
  /** marker colour for this set's genes on the point plots (volcano / MA / scatter) while the
   *  selection IS this set; unset = the points keep their effect colours */
  color?: string
  /** when true, this set's genes are MASKED — forced non-significant across every comparison /
   *  contrast result in the project (e.g. to drop inherently-variable genes). */
  hidden?: boolean
}

/** User overrides for a derived analysis group, keyed by the group's root node id. */
export interface GroupMeta {
  label?: string
  hidden?: boolean
  /** results-page tab position (lower = earlier). Unset groups sort after ordered ones, in the
   *  derived (node) order. Written when the user drag-reorders the tabs. */
  order?: number
}
