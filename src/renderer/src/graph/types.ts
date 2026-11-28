/** Types for the composable pipeline graph. */
import type { Node } from '@xyflow/react'
import {
  type ClusterData,
  type ContrastResult,
  type CustomConditionKey,
  type EnrichData,
  numericConds,
  type NumericConds,
  numericOf,
  type StandardizeResult,
  type VehNormResult
} from '../engine'
import type { StringAll } from '../ui/plot/stringModel'
import type { LoadConfig, SubsetConfig } from './config/load'
import type { StandardizeConfig } from './config/standardize'
import type { CompareConfig } from './config/compare'
import type { ContrastConfig } from './config/contrast'
import type { MAConfig, ScatterConfig, VolcanoConfig } from './config/pointPlots'
import type { HeatmapConfig } from './config/heatmap'
import type { DRConfig, MetricsConfig, PotencyConfig } from './config/dr'
import type { InteractionConfig, VarianceConfig } from './config/anovaPlots'
import type { CorrConfig, CurveMadConfig, QcConfig } from './config/qc'
import type { ResponseConfig, TdrConfig } from './config/response'
import type { BarConfig, BubbleConfig, DumbbellConfig, TableConfig } from './config/genePlots'
import type { ClusterConfig, ClusterRun } from './config/cluster'
import type { EnrichConfig, EnrichMapConfig, SetCompareConfig, StringConfig } from './config/enrich'

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
  | 'enrichMap'
  | 'setCompare'
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

/** Each kind's config type — the one place a kind is tied to its config (nodes/<kind>/spec.ts
 *  returns it from defaultConfig). A kind missing here fails the type check. */
export interface NodeConfigMap {
  load: LoadConfig
  standardize: StandardizeConfig
  merge: MergeConfig
  subset: SubsetConfig
  compare: CompareConfig
  curveFit: CompareConfig
  contrast: ContrastConfig
  volcano: VolcanoConfig
  heatmap: HeatmapConfig
  scatter: ScatterConfig
  ma: MAConfig
  dr: DRConfig
  potency: PotencyConfig
  metrics: MetricsConfig
  variance: VarianceConfig
  interaction: InteractionConfig
  curveMad: CurveMadConfig
  response: ResponseConfig
  bubble: BubbleConfig
  dumbbell: DumbbellConfig
  pca: ClusterConfig
  tdr: TdrConfig
  geneBar: BarConfig
  enrich: EnrichConfig
  enrichMap: EnrichMapConfig
  setCompare: SetCompareConfig
  string: StringConfig
  qc: QcConfig
  corr: CorrConfig
  table: TableConfig
  plotGroup: PlotGroupConfig
}
export type NodeConfig = NodeConfigMap[NodeKind]

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
  // ── a plot's run: what it needs to be viewed (see graph/run/plotRun.ts) ──
  /** a plot drawn straight from its upstream: the run checked it can be (no data of its own) */
  | { kind: 'plot' }
  /** enrichment, every method × term source, per facet (facetKey): every tested term — the tile
   *  shows its top N, the export writes them all */
  | {
      kind: 'enrich'
      facets: Record<string, Record<string, EnrichData>>
      /** the enrichment map's GO nesting: each tested GO term's ancestors among the tested GO
       *  terms (main/goHierarchy); unset for an enrichment plot's run, or when GO isn't tested */
      goAncestors?: Record<string, string[]>
      /** why there's no nesting when GO was tested (the ontology couldn't be fetched) */
      goError?: string
    }
  /** a set comparison's sets: a Clean data upstream's measured genes per sample (`quantity`), a
   *  Compare's significant genes per facet (`calls`), and — when it compares terms — the
   *  enrichment run over those facets (`enrich`, as an enrichment plot's `facets`) */
  | {
      kind: 'sets'
      quantity?: import('../engine').MeasuredSets
      calls?: import('../engine').CallGroup[]
      enrich?: Record<string, Record<string, EnrichData>>
    }
  /** STRING, every confidence × gene cap × interactor setting, per facet (facetKey) — see StringAll */
  | { kind: 'string'; species: number; caps: number[]; facets: Record<string, StringAll> }
  /** a cluster plot's sample embedding (in the worker), with the settings it was computed under
   *  (`ran`, see clusterRunOf) — its view settings (colour by a condition, plot, territory, look)
   *  draw from it without another run */
  | { kind: 'cluster'; cluster: ClusterData; ran: ClusterRun }
  /** a correlation plot's sample-pair matrix under every metric (in the worker) — the metric,
   *  clustering and sample order on the tile arrange it without another run */
  | { kind: 'corr'; corr: import('../engine').SampleCorrAll }
  /** a heatmap's clustering (nodes/heatmap/run.ts, in the worker). From Clean data: the `n` gene
   *  rows' cluster groups (each as its genes' uniqIDs), on the scale it clustered on — the sample
   *  order and the look draw from them without another run. From a Compare: the built fold-change
   *  heatmap per row set, under the clustering settings `key` names (heatmap/runKey.ts). Neither
   *  when the worker failed: the tile clusters */
  | {
      kind: 'heatmap'
      std?: { scale: import('../engine').ValueScale; n: number; groups: string[][] }
      fc?: {
        key: string
        overall: import('../engine').FcHeatmapData
        /** a two-way ANOVA's factors rows */
        factors?: import('../engine').FcHeatmapData
      }
    }

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
