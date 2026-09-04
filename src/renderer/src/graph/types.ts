/** Types for the composable pipeline graph. */
import type { Node } from '@xyflow/react'

import type {
  CondSelector,
  ConditionKey,
  ContrastResult,
  FieldRule,
  FilterSpec,
  InteractiveRole,
  InteractiveSampleCond,
  MatrixPreset,
  StandardizeResult,
  ThresholdConfig,
  VehNormResult
} from '../engine'
import { VALID_CONDITIONS } from '../engine'

/** High-level node category — derived from the op, never stored (see `categoryOf`). */
export type NodeCategory = 'data' | 'processing' | 'plotting'
/** The specific operation a node performs (its intrinsic, canonical type). */
export type NodeKind =
  | 'load'
  | 'standardize'
  | 'compare'
  | 'contrast'
  | 'volcano'
  | 'heatmap'
  | 'scatter'
  | 'ma'
  | 'dr'
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

/** Focus genes a plot applies. `goi` = genes of interest (per-gene plots / emphasis),
 *  `panel` = a wider relevant-gene set. Both hold uniqIDs. `mode` decides where a plot
 *  gets its sets: `none` (ignore), `inherit` (the Standardize ancestor's sets), or
 *  `custom` (this plot's own `goi`/`panel`). */
export interface FocusConfig {
  mode: 'none' | 'inherit' | 'custom'
  goi: string[]
  panel: string[]
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

/** Interactive import: the user's column classification + per-sample conditions, from which the
 *  three standard files are generated (see engine buildStandardInputs). */
export interface InteractiveImport {
  /** all matrix column headers */
  columns: string[]
  /** header → role (id / sample / label / meta / filter / ignore) */
  roles: Record<string, InteractiveRole>
  /** sample header → assigned conditions */
  conditions: Record<string, InteractiveSampleCond>
  /** filter-column header → row-filter spec (Filtering step); absent = no row filtering */
  filters?: Record<string, FilterSpec>
  /** condition field → learned name-region rule (Conditions step); persisted so reopening the
   *  wizard restores the highlighted regions, mirroring how column roles are remembered */
  rules?: Record<string, FieldRule>
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
  /** master focus-gene sets (uniqIDs) that downstream plots can inherit */
  goi: string[]
  panel: string[]
  /** clean-up: drop genes identified (non-null) in fewer than this % of samples.
   *  0 = keep everything. */
  minSamplePct: number
  /** apply the % threshold per strain (kept if it clears in any one strain) instead of across all
   *  samples pooled. */
  minSamplePctPerStrain?: boolean
}

export interface CompareConfig {
  /** which comparison analysis to run — a config choice, not a distinct node kind.
   *  'compare' is the explicit numerator/denominator model; 'two_way_anova' keeps its own factors. */
  analysis: 'compare' | 'two_way_anova'
  method: 'ttest'
  transform: boolean
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
}

/** Migrate any stored Compare config (incl. legacy veh_norm/direct) to the explicit model.
 *  Pure — safe to call on every read; returns the input unchanged when already migrated. */
export function normalizeCompareConfig(c: CompareConfig): CompareConfig {
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
  const pinned = (s: CondSelector): boolean => Object.values(s).some((v) => v != null && v.length > 0)
  if (cfg.analysis === 'compare') return pinned(cfg.num) && pinned(cfg.den)
  return !!(cfg.pairNum && cfg.pairDen && cfg.pair2Num && cfg.pair2Den)
}

/** Contrast pools its upstream comparison rows, then splits them by two levels of one
 *  condition (omicViz's `type: contrast` entry = condition + [[num, den]] pairs). */
export interface ContrastConfig {
  relationship: 'correlated' | 'independent'
  /** how the two sides (FC1/FC2) are formed:
   *   - 'split' (default): pool the single upstream Compare and split it by two levels of one
   *     condition (the classic omicViz contrast).
   *   - 'pair': two upstream inputs (two Compares → FC-vs-FC, or two Standardizes →
   *     abundance-vs-abundance), joined by uniqID + the matched context. */
  source?: 'split' | 'pair'
  /** the condition contrasted over (the contrast axis) — 'split' mode only */
  condition: ConditionKey
  /** its two levels: numerator → FC1, denominator → FC2 — 'split' mode only */
  pairNum: string
  pairDen: string
  /** 'pair' mode: context dims to align the two inputs on (joined with uniqID); unmatched dims are
   *  averaged. Empty = join on uniqID alone (one point per gene). */
  match?: ConditionKey[]
}

export interface VolcanoConfig {
  statType: 'pP' | 'pQ'
  labelTop: number
  /** focus genes highlighted over a greyed background */
  focus: FocusConfig
}

/** Heatmap: genes × samples log10 intensity (from Standardize) OR genes × comparisons log2FC
 *  (from Compare) — the tile picks the rendering from its upstream. */
export interface HeatmapConfig {
  maxGenes: number
  /** log10 intensities — only applies to a Standardize-fed heatmap (ignored for log2FC). */
  log10: boolean
  /** when focus genes resolve, show exactly those rows instead of top-by-variance */
  focus: FocusConfig
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
}

/** Contrast scatter (FC1 vs FC2); labels the top-N most divergent genes. */
export interface ScatterConfig {
  labelTop: number
}

/** MA plot (compare): mean abundance vs log2FC, with fold-change guide lines. */
export interface MAConfig {
  fcLow: number
  fcHigh: number
  /** focus genes highlighted over a greyed background */
  focus: FocusConfig
}

/** Response curves / bubble grid (compare) over dose or time, top-N genes. */
export interface DRConfig {
  axis: 'dose' | 'time'
  topGenes: number
  /** when focus genes resolve, colour exactly those curves instead of top-N */
  focus: FocusConfig
}
export interface BubbleConfig {
  axis: 'dose' | 'time'
  topGenes: number
  /** when focus genes resolve, show exactly those genes instead of top-N */
  focus: FocusConfig
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
}

/** Dumbbell (contrast): FC1↔FC2 per gene, top-N by |FCdiff|. */
export interface DumbbellConfig {
  topGenes: number
  /** when focus genes resolve, show exactly those genes instead of top-N */
  focus: FocusConfig
  /** tile orientation (persisted); undefined = portrait default */
  orient?: PlotOrient
}

/** TDR (compare, dose×time): per-gene time-series dose-response, one gene per figure.
 *  Renders the resolved focus genes (goi first). */
export interface TdrConfig {
  focus: FocusConfig
}

/** Gene bar (standardize): one focus gene's value across every condition. */
export interface BarConfig {
  focus: FocusConfig
  /** tile orientation (persisted); undefined = landscape default */
  orient?: PlotOrient
}

/** Enrichment (compare): over-representation of GO terms / KEGG pathways in the significant
 *  gene set, drawn as a dot or bar plot. Reads the annotations fetched in the interactive import. */
export interface EnrichConfig {
  /** 'ora' = over-representation (hypergeometric); 'gsea' reserved (ranked, not yet computed). */
  method: 'ora' | 'gsea'
  /** which annotation term set to test */
  source: 'go' | 'kegg'
  /** plot style ('ridge' is GSEA-only: per-set log₂FC density ridges) */
  style: 'dot' | 'bar' | 'ridge'
  /** how many top terms to show */
  topTerms: number
}

/** STRING network (compare): PPI network among the top differential genes, fetched from STRING-DB.
 *  Species comes from the interactive-import annotation fetch (NCBI taxon); a non-zero `species`
 *  here overrides it. Nodes = genes coloured by log₂FC, sized by degree; edges = STRING confidence. */
export interface StringConfig {
  /** STRING confidence cutoff bucket (maps to required_score 150/400/700/900) */
  confidence: 'low' | 'medium' | 'high' | 'highest'
  /** cap on the number of genes (strongest |log₂FC|) sent to STRING */
  maxGenes: number
  /** also include first-shell interactors of the query set (proteins that directly connect to a
   *  differential gene above the confidence threshold), up to maxGenes of them. */
  addInteractors?: boolean
  /** manual NCBI taxon override; 0/undefined = use the species from the annotation fetch */
  species?: number
}

/** Sample QC plot (standardize): a per-sample distribution of one quality metric, drawn as
 *  a violin, box, or bar. */
export interface QcConfig {
  metric: 'intensity' | 'cv' | 'proteins'
  plot: 'violin' | 'box' | 'bar'
}

/** Sample correlation matrix (standardize): all-samples × all-samples Pearson r heatmap. */
export interface CorrConfig {
  /** cluster samples by correlation profile so replicate groups block on the diagonal */
  cluster: boolean
}

/** Data-table tile (plotting): shows the upstream step's results table interactively in the
 *  dashboard. The upstream step already computes the table; this node just opts a tile in. */
export interface TableConfig {
  /** initial view for tables that offer a Long ⇆ Matrix toggle (standardize/compare). */
  view?: 'long' | 'matrix'
}

/** One plot inside a group tile: a full plot spec with a stable subcard id. The `kind`
 *  is always a plotting op (never `plotGroup` — groups don't nest). */
export interface PlotChild {
  id: string
  kind: NodeKind
  config: NodeConfig
}

/** A group tile (plotting): folds several plots that share ONE upstream into one node,
 *  shown as stacked subcards. Holds no result of its own — each child renders live from
 *  the group's single upstream, exactly as a standalone plot would. */
export interface PlotGroupConfig {
  children: PlotChild[]
}

/** Sample cluster/embedding (standardize): method + coloring condition. */
export interface ClusterConfig {
  method: 'pca' | 'umap' | 'tsne'
  colorBy: ConditionKey
  /** 'replicate' plots every replicate; 'centroid' collapses each condition's
   *  replicates to a centroid + spread territory (falling back to the point when
   *  a condition has a single replicate). */
  display: 'replicate' | 'centroid'
  /** 'simple' colours by a single condition (colorBy). 'complex' drives marker aesthetics
   *  from every varying condition at once — colour by the qualitative condition(s), shade
   *  by a quantitative one, and connect a dose/time series with arrows. */
  legend?: 'simple' | 'complex'
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
}

export type NodeConfig =
  | LoadConfig
  | StandardizeConfig
  | CompareConfig
  | ContrastConfig
  | VolcanoConfig
  | HeatmapConfig
  | ScatterConfig
  | MAConfig
  | DRConfig
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
      /** uniqID → annotation columns (GO / keggPathway), carried from Standardize for enrichment */
      annotationMap: Record<string, Record<string, string>>
      /** pathway name → KEGG category, carried from Standardize for grouping enrichment terms */
      keggCategories: Record<string, string>
    }
  | { kind: 'contrast'; ctr: ContrastResult; displayMap: Record<string, string> }

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
