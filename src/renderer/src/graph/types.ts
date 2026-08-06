/** Types for the composable pipeline graph. */
import type { Node } from '@xyflow/react'

import type {
  ConditionKey,
  ContrastResult,
  StandardizeResult,
  ThresholdConfig,
  VehNormResult
} from '../engine'

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
export interface LoadConfig {
  data: string | null
  samplesheet: string | null
  db: string | null
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
}

export interface CompareConfig {
  /** which comparison analysis to run — a config choice, not a distinct node kind */
  analysis: 'veh_norm' | 'direct' | 'two_way_anova'
  method: 'ttest'
  transform: boolean
  /** primary comparison condition (veh_norm is always 'cmpd'); its numerator/denominator levels */
  condition: ConditionKey
  pairNum: string
  pairDen: string
  /** two_way_anova only: the second factor and its numerator/denominator levels */
  condition2: ConditionKey
  pair2Num: string
  pair2Den: string
  threshold: ThresholdConfig
}

/** Contrast pools its upstream comparison rows, then splits them by two levels of one
 *  condition (omicViz's `type: contrast` entry = condition + [[num, den]] pairs). */
export interface ContrastConfig {
  relationship: 'correlated' | 'independent'
  /** the condition contrasted over (the contrast axis) */
  condition: ConditionKey
  /** its two levels: numerator → FC1, denominator → FC2 */
  pairNum: string
  pairDen: string
}

export interface VolcanoConfig {
  statType: 'pP' | 'pQ'
  labelTop: number
  /** focus genes highlighted over a greyed background */
  focus: FocusConfig
}

export interface HeatmapConfig {
  maxGenes: number
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
  | PlotGroupConfig

/** Data carried on a materialized step node (kept light — heavy results live in the store).
 *  The category is intentionally NOT stored: it is always `categoryOf(kind)`. */
export interface NodeData {
  /** the specific operation — the node's intrinsic type */
  kind: NodeKind
  config: NodeConfig
  status: StepStatus
  error?: string
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
  | { kind: 'compare'; cmp: VehNormResult; displayMap: Record<string, string> }
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

/** User overrides for a derived analysis group, keyed by the group's root node id. */
export interface GroupMeta {
  label?: string
  hidden?: boolean
}
