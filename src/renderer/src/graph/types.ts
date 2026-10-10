/** Types for the composable pipeline graph. */
import type { Node } from '@xyflow/react'

import type {
  CondSelector,
  ClusterColorBy,
  ConditionKey,
  ContrastResult,
  ContrastStat,
  EnrichData,
  EnrichSource,
  FilterSpec,
  ImputeMethod,
  InteractiveRole,
  PairFix,
  InteractiveSampleCond,
  MatrixPreset,
  StandardizeResult,
  ThresholdConfig,
  VehNormResult
} from '../engine'
import { VALID_CONDITIONS } from '../engine'
import type { StringAll } from '../ui/stringModel'
import { EFFECT_COLOR } from '../ui/theme'
export type { StringAll }

/** High-level node category — derived from the op, never stored (see `categoryOf`). */
export type NodeCategory = 'data' | 'processing' | 'plotting'
/** The specific operation a node performs (its intrinsic, canonical type). */
export type NodeKind =
  | 'load'
  | 'standardize'
  | 'merge'
  | 'compare'
  | 'contrast'
  | 'volcano'
  | 'heatmap'
  | 'scatter'
  | 'ma'
  | 'dr'
  | 'potency'
  | 'curveMad'
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
  /** interactive mode: the import spec built across the 4-step wizard. */
  interactive?: InteractiveImport
}

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
   *  a samplesheet column of the same name, and a `@name` condition key downstream. Always
   *  categorical — see the engine's CustomConditionKey. */
  customConditions?: string[]
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
  /** which comparison analysis to run — a config choice, not a distinct node kind.
   *  'compare' is the explicit numerator/denominator model; 'two_way_anova' keeps its own factors;
   *  'curve_fit' is the num/den model with one dose–response curve per numerator group. */
  analysis: 'compare' | 'two_way_anova' | 'curve_fit'
  method: 'ttest'
  /** curve_fit only: the numeric condition the curve runs over (absent = dose) */
  curveAxis?: ConditionKey
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
  /** two_way_anova only: the two factors and their numerator/denominator levels */
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

/** Dose units a dataset's doses can be in, with their size in molar. */
export const DOSE_UNITS = { M: 1, mM: 1e-3, µM: 1e-6, nM: 1e-9, pM: 1e-12 } as const
export type DoseUnit = keyof typeof DOSE_UNITS
/** Time units a dataset's time points can be in. */
export const TIME_UNITS = ['s', 'min', 'h', 'd', 'wk'] as const
export type TimeUnit = (typeof TIME_UNITS)[number]

/** Arbitrary units: a numeric condition's values carry no physical unit (a dose then has no molar
 *  scale, so a curve's EC50 gets no pEC50 in molar). Picked explicitly at import, like a unit. */
export const AU = 'a.u.'
export type ArbitraryUnit = typeof AU

/** The units of the numeric conditions, as picked at import. Absent = not picked yet (the import
 *  asks for one before it goes on; an older project shows it unitless, like a.u.). */
export interface CondUnits {
  dose?: DoseUnit | ArbitraryUnit
  time?: TimeUnit | ArbitraryUnit
}

/** The units the data feeding `id` was imported with: walks upstream (through every input of a
 *  Merge) to the Load tile(s); the first one to name a unit wins it. */
export function condUnitsFor(
  g: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
  id: string | undefined
): CondUnits {
  const out: CondUnits = {}
  const seen = new Set<string>()
  const queue = id ? [id] : []
  while (queue.length && !(out.dose && out.time)) {
    const cur = queue.shift()!
    if (seen.has(cur)) continue
    seen.add(cur)
    const n = g.nodes.find((x) => x.id === cur)
    if (n && isStep(n) && n.data.kind === 'load') {
      const u = (n.data.config as LoadConfig).units
      out.dose ??= u?.dose
      out.time ??= u?.time
      continue
    }
    for (const e of g.edges) if (e.target === cur) queue.push(e.source)
  }
  return out
}

/** A numeric axis's title with its unit: `dose (nM)`, or just `dose` when none is set. */
export function axisTitle(axis: string, units: CondUnits): string {
  const u = axis === 'dose' ? units.dose : axis === 'time' ? units.time : undefined
  return u ? `${axis} (${u})` : axis
}

/** A curve fit's axis unit and, over dose, its molar scale (for pEC50): the imported dose unit,
 *  else a legacy Compare-level one; none (a.u.) = no molar scale. Time or a custom axis has no
 *  molar scale — scale 1, with its unit (if any) for the EC50's label only. */
export function curveDoseUnit(
  cfg: CompareConfig | undefined,
  units: CondUnits
): { unit?: string; scale: number; molar?: boolean } {
  if (!cfg || cfg.analysis !== 'curve_fit') return { scale: 1 }
  const axis = cfg.curveAxis ?? 'dose'
  if (axis === 'time') return { unit: units.time, scale: 1 }
  if (axis !== 'dose') return { scale: 1 }
  const unit = units.dose ?? cfg.doseUnit
  if (unit === AU) return { unit, scale: 1 }
  return unit ? { unit, scale: DOSE_UNITS[unit], molar: true } : { scale: 1 }
}

/** CurveCurator's default significance (its example config): α = 0.05, |curve log₂FC| ≥ 0.45, on
 *  raw p. */
const CURVECURATOR_THRESHOLD: Partial<ThresholdConfig> = {
  type: 'curvecurator',
  statType: 'pP',
  statMin: -Math.log10(0.05),
  fcHigh: 0.45,
  fcLow: -0.45
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
/** The colours a plot draws its effect groups in: its own where set, else the Compare's. */
export function plotEffectColors(
  own: PlotEffectColors | undefined,
  compare: Pick<CompareConfig, 'effectColors'> | undefined
): EffectColors {
  const base = effectColorsOf(compare)
  const pick = (k: 'up' | 'down' | 'none'): string => {
    const c = own?.[k]
    return c && c !== 'auto' ? c : base[k]
  }
  return { up: pick('up'), down: pick('down'), none: pick('none') }
}
/** A Compare's effect colours with the shared defaults filled in (EFFECT_COLOR). */
export const effectColorsOf = (
  c: Pick<CompareConfig, 'effectColors'> | undefined
): EffectColors => ({
  up: c?.effectColors?.up || EFFECT_COLOR.up,
  down: c?.effectColors?.down || EFFECT_COLOR.down,
  none: c?.effectColors?.none || EFFECT_COLOR.none
})
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
  // Legacy two-way (factor fields only) → mirror the two factors into num/den selectors so the
  // dialog can show them; the two-way run path still reads the factor fields.
  if (
    analysis === 'two_way_anova' &&
    !(c.num && Object.keys(c.num).length) &&
    c.pairNum &&
    c.pairDen &&
    c.pair2Num &&
    c.pair2Den
  ) {
    return {
      ...c,
      num: { [c.condition]: [c.pairNum], [c.condition2]: [c.pair2Num] },
      den: { [c.condition]: [c.pairDen], [c.condition2]: [c.pair2Den] },
      match: c.match ?? []
    }
  }
  // Already explicit (or two-way): return unchanged when the new fields exist, else backfill.
  if (c.num && c.den && c.match) return c
  return { ...c, num: c.num ?? {}, den: c.den ?? {}, match: c.match ?? [] }
}

/** Whether a Compare tile's comparison is fully defined (numerator + denominator pinned, or both
 *  factor pairs for a legacy two-way). Drives the tile's ready/blocked state. */
export function isCompareConfigured(config: CompareConfig): boolean {
  const cfg = normalizeCompareConfig(config)
  const pinned = (s: CondSelector): boolean =>
    Object.values(s).some((v) => v != null && v.length > 0)
  if (cfg.analysis === 'compare' || cfg.analysis === 'curve_fit')
    return pinned(cfg.num) && pinned(cfg.den)
  return !!(cfg.pairNum && cfg.pairDen && cfg.pair2Num && cfg.pair2Den)
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

/** Volcano (compare). The y-axis stat (−log10 p vs q) follows the upstream Compare's threshold
 *  `statType`, so the drawn guide matches the calls — it isn't a per-tile choice. */
export interface VolcanoConfig {
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
}

/** Heatmap: genes × samples log10 intensity (from Standardize) OR genes × comparisons log2FC
 *  (from Compare) — the tile picks the rendering from its upstream. */
export interface HeatmapConfig {
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
   *  shown (default) or hidden */
  condBar?: boolean
  /** which settings the tile surfaces as quick-access switch bars (unset = all) */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** The conditions a bar plot colours by — none when it colours by value. Reads an older config's
 *  single condition key in `colorBy` too. */
export function barColorConds(c: BarConfig): ConditionKey[] {
  if (c.colorBy === 'condition') return (c.colorConds ?? []).slice(0, 2)
  if (c.colorBy && c.colorBy !== 'value') return [c.colorBy]
  return []
}

export const heatmapCapOn = (c: HeatmapConfig): boolean => capOn(c.capEnabled, c.maxGenes)

/** Contrast scatter (FC1 vs FC2); labels the top-N most divergent genes. */
export interface ScatterConfig {
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
export interface MAConfig {
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
 *  territory sit on the tile by default — the rest are tuned once, in the settings window. */
export const QUICK_DEFAULTS: Partial<Record<NodeKind, Record<string, boolean>>> = {
  pca: { legend: false, clusterOn: false, clusterCount: false, display: false }
}
/** Whether a setting is surfaced in the tile as a quick-access switch bar: the user's choice, else
 *  the kind's default (QUICK_DEFAULTS), else on. */
export const quickOn = (
  cfg: { quick?: QuickAccess } | undefined,
  field: string,
  kind?: NodeKind
): boolean => cfg?.quick?.[field] ?? (kind ? QUICK_DEFAULTS[kind]?.[field] : undefined) ?? true

export interface DRConfig {
  axis: 'dose' | 'time'
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
   *  focused pager steps through every gene, or only the selected ones while any are selected. */
  view?: 'overview' | 'focus'
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
   *  default 7), colour ('auto' = the line's), opacity (0–1; default 0.7) */
  points?: boolean
  pointSize?: number
  pointColor?: string
  pointOpacity?: number
  /** focused view: the error — a t-test's (or a Contrast's) fold-change SE, a curve fit's 95%
   *  confidence band — shown (default), as a shaded band (default) or whiskers, colour ('auto' =
   *  the line's), opacity (0–1; default 0.2 for a band, 1 for whiskers) */
  errors?: boolean
  errorStyle?: 'whisker' | 'band'
  errorColor?: string
  errorOpacity?: number
}
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
}
// One resolved look per config object (the store replaces the object on any edit), so a view's
// memo keyed on the look only rebuilds when a setting actually changed.
const drLookCache = new WeakMap<object, DRLook>()
export function drLook(c: Partial<DRConfig>): DRLook {
  let look = drLookCache.get(c)
  if (!look) drLookCache.set(c, (look = resolveDRLook(c)))
  return look
}
/** A one-gene DR's value-axis scale: the setting, else global from a Contrast, per gene from a
 *  Compare. */
export const drYScale = (c: Partial<DRConfig>, fromContrast: boolean): 'global' | 'gene' =>
  c.yScale ?? (fromContrast ? 'global' : 'gene')
function resolveDRLook(c: Partial<DRConfig>): DRLook {
  // A shaded band by default, from a Compare or a Contrast alike.
  const errorStyle = c.errorStyle ?? 'band'
  return {
    lineWidth: c.lineWidth ?? 2,
    lineColor: c.lineColor ?? 'auto',
    lineOpacity: c.lineOpacity ?? 1,
    points: c.points ?? true,
    pointSize: c.pointSize ?? 7,
    pointColor: c.pointColor ?? 'auto',
    pointOpacity: c.pointOpacity ?? 0.7,
    errors: c.errors ?? true,
    errorStyle,
    errorColor: c.errorColor ?? 'auto',
    errorOpacity: c.errorOpacity ?? (errorStyle === 'band' ? 0.2 : 1)
  }
}
/** Potency plot (curve-fit Compare, as CurveCurator draws it): each curve's potency (pEC50)
 *  against its curve fold change. */
export interface PotencyConfig {
  /** the called curves only (default) — a flat curve's pEC50 means nothing — or every curve */
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
}
/** Residual plots (curve-fit QC, after CurveCurator's MAD analysis): each dose's residuals from
 *  the curves' fits, as violins with their outliers. */
export interface CurveMadConfig {
  /** marker/legend look of the control and dosed samples; unset fields use the defaults */
  style?: PointStyle
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
/** Bubble grid (compare) over dose or time, one gene per row. */
export interface BubbleConfig {
  axis: 'dose' | 'time'
  /** the up / down / none colours, this plot's own; unset (or 'auto') = the upstream Compare's */
  effectColors?: PlotEffectColors
  /** cap genes: explicit switch (undefined on older configs → inferred from topGenes > 0) */
  capEnabled?: boolean
  /** cap genes: top-N by |log2FC| (applied only while `capEnabled`; otherwise all, up to the
   *  renderer's safety cap) */
  topGenes: number
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
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}
export const geneCapOn = (c: BubbleConfig | DumbbellConfig | DRConfig): boolean =>
  capOn(c.capEnabled, c.topGenes)

/** TDR (compare, dose×time): per-gene time-series dose-response, one gene per figure.
 *  Renders the selected genes (linked gene selection). */
export interface TdrConfig {
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Gene bar (standardize): each selected gene's value across every condition. */
export interface BarConfig {
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
  /** the value axis scaled to each gene's own values — its min to its max (default) — or to the
   *  whole dataset's, so paging genes keeps one scale */
  yScale?: 'global' | 'gene'
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
  /** bar fill: by value (default) or by condition (`colorConds`). An older config may hold a
   *  single condition key here — read it through barColorConds. */
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
export interface EnrichConfig {
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
export interface StringConfig {
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
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
}

/** Sample QC plot (standardize): a per-sample distribution of one quality metric, drawn as
 *  a violin, box, or bar. */
export interface QcConfig {
  metric: 'intensity' | 'cv' | 'proteins'
  plot: 'violin' | 'box' | 'bar'
  /** # proteins: the count axis global — from zero (default) — or by range, fitted to the counts
   *  so small differences between samples show */
  yScale?: 'global' | 'range'
  /** the fill: one colour for every sample (default) or by condition (`colorConds`) */
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

/** The conditions a QC plot colours by — none when it uses its single colour. */
export const qcColorConds = (c: QcConfig): ConditionKey[] =>
  c.colorBy === 'condition' ? (c.colorConds ?? []).slice(0, 2) : []

/** Sample correlation matrix (standardize): all-samples × all-samples Pearson r heatmap. */
export interface CorrConfig {
  /** cluster samples by correlation profile so replicate groups block on the diagonal */
  cluster: boolean
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Data-table tile (plotting): shows the upstream step's results table interactively in the
 *  dashboard. The upstream step already computes the table; this node just opts a tile in. */
export interface TableConfig {
  /** initial view for tables that offer a Long ⇆ Matrix toggle (standardize/compare/contrast);
   *  absent = matrix. */
  view?: 'long' | 'matrix'
}

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

/** Sample cluster/embedding (standardize): method + coloring condition. */
export interface ClusterConfig {
  method: 'pca' | 'umap' | 'tsne'
  /** A condition, or `'cluster'` to colour by a grouping computed from the data itself. */
  colorBy: ClusterColorBy
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
   *  drops any gene missing in any sample (Spectronaut-style, no imputation). Defaults to 'impute'. */
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
}

/** A cluster plot's marker and arrow-trail look with every default filled in (see ClusterConfig). */
export interface ClusterStyle {
  markerSize: number
  markerOpacity: number
  centroidSize: number
  centroidOpacity: number
  /** undefined = the mark's own default (0 on replicates, 1.5 on centroids) */
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
  | CompareConfig
  | ContrastConfig
  | VolcanoConfig
  | HeatmapConfig
  | ScatterConfig
  | MAConfig
  | DRConfig
  | PotencyConfig
  | CurveMadConfig
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
    }
  | { kind: 'contrast'; ctr: ContrastResult; displayMap: Record<string, string> }
  // ── a plot's run: what it needs to be viewed (see graph/plotRun.ts) ──
  /** a plot drawn straight from its upstream: the run checked it can be (no data of its own) */
  | { kind: 'plot' }
  /** enrichment, every method × term source, per facet (facetKey): every tested term — the tile
   *  shows its top N, the export writes them all */
  | { kind: 'enrich'; facets: Record<string, Record<string, EnrichData>> }
  /** STRING, every confidence × gene cap × interactor setting, per facet (facetKey) — see StringAll */
  | { kind: 'string'; species: number; caps: number[]; facets: Record<string, StringAll> }

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
