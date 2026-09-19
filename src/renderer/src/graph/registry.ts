/** Static metadata for node operations, grouped under high-level categories. */
import { DEFAULT_THRESHOLD } from '../engine'
import { isStep } from './types'
import type {
  BarConfig,
  BubbleConfig,
  CompareConfig,
  ContrastConfig,
  DRConfig,
  DumbbellConfig,
  EnrichConfig,
  StringConfig,
  HeatmapConfig,
  LoadConfig,
  MAConfig,
  NodeCategory,
  NodeConfig,
  NodeKind,
  NodeResult,
  GraphNode,
  ClusterConfig,
  CorrConfig,
  PlotGroupConfig,
  QcConfig,
  ScatterConfig,
  StandardizeConfig,
  TableConfig,
  TdrConfig,
  VolcanoConfig
} from './types'

export interface NodeSpec {
  kind: NodeKind
  label: string
  /** one-line gloss shown under the label in the new-step picker */
  subtitle?: string
  category: NodeCategory
  /** upstream operations this op accepts an input from (empty = source node) */
  acceptsFrom: NodeKind[]
  /** whether the op performs compute via a Run action (vs. loading files / just viewing) */
  hasRun: boolean
  defaultConfig: () => NodeConfig
}

export const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  load: {
    kind: 'load',
    label: 'Load data',
    category: 'data',
    acceptsFrom: [],
    hasRun: false,
    defaultConfig: (): LoadConfig => ({
      mode: 'interactive',
      data: null,
      samplesheet: null,
      db: null,
      matrix: null
    })
  },
  standardize: {
    kind: 'standardize',
    label: 'Clean data',
    category: 'processing',
    acceptsFrom: ['load'],
    hasRun: true,
    defaultConfig: (): StandardizeConfig => ({
      activeConditions: null,
      minSamplePct: 0
    })
  },
  compare: {
    kind: 'compare',
    label: 'Compare',
    subtitle: 'fold change of A | B',
    category: 'processing',
    acceptsFrom: ['standardize'],
    hasRun: true,
    defaultConfig: (): CompareConfig => ({
      analysis: 'compare',
      method: 'ttest',
      transform: true,
      // Fresh tile: nothing declared — the user opens "Configure comparison" to define it.
      num: {},
      den: {},
      match: [],
      condition: 'cmpd',
      pairNum: '',
      pairDen: '',
      condition2: 'dose',
      pair2Num: '',
      pair2Den: '',
      threshold: { ...DEFAULT_THRESHOLD, statType: 'pP' }
    })
  },
  contrast: {
    kind: 'contrast',
    label: 'Contrast',
    subtitle: 'side-by-side A vs B',
    category: 'processing',
    // One Compare (split by a condition), or two same-kind inputs (Compare or Standardize) joined
    // as FC1/FC2 in 'pair' mode.
    acceptsFrom: ['compare', 'standardize'],
    hasRun: true,
    defaultConfig: (): ContrastConfig => ({
      relationship: 'correlated',
      source: 'select',
      num: {},
      den: {},
      match: []
    })
  },
  volcano: {
    kind: 'volcano',
    label: 'Volcano',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): VolcanoConfig => ({ capEnabled: false, labelTop: 20 })
  },
  heatmap: {
    kind: 'heatmap',
    label: 'Heatmap',
    category: 'plotting',
    // Standardize → intensity heatmap; Compare → log2FC heatmap (same tile, upstream decides).
    acceptsFrom: ['standardize', 'compare'],
    hasRun: false,
    defaultConfig: (): HeatmapConfig => ({ capEnabled: false, maxGenes: 50, log10: true })
  },
  scatter: {
    kind: 'scatter',
    label: 'Scatter',
    category: 'plotting',
    // Contrast → FC1 vs FC2. Compare → log10 intensity of the two compared groups
    // (mean1 vs mean2), e.g. the basal clpP-vs-WT abundances from a direct comparison.
    acceptsFrom: ['contrast', 'compare'],
    hasRun: false,
    defaultConfig: (): ScatterConfig => ({ capEnabled: false, labelTop: 20 })
  },
  ma: {
    kind: 'ma',
    label: 'MA',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): MAConfig => ({ fcLow: -1, fcHigh: 1 })
  },
  dr: {
    kind: 'dr',
    label: 'Dose/time-response',
    category: 'plotting',
    // From a Compare: every gene's response curve. From a Contrast: the hovered gene's response on
    // BOTH contrasted sides (FC1 vs FC2), for comparing profiles between two datasets/contrasts.
    acceptsFrom: ['compare', 'contrast'],
    hasRun: false,
    defaultConfig: (): DRConfig => ({ axis: 'dose', capEnabled: true, topGenes: 1 })
  },
  bubble: {
    kind: 'bubble',
    label: 'Bubble',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): BubbleConfig => ({ axis: 'dose', capEnabled: true, topGenes: 1 })
  },
  dumbbell: {
    kind: 'dumbbell',
    label: 'Dumbbell',
    category: 'plotting',
    acceptsFrom: ['contrast'],
    hasRun: false,
    defaultConfig: (): DumbbellConfig => ({ capEnabled: true, topGenes: 20 })
  },
  tdr: {
    kind: 'tdr',
    label: 'Time & Dose-response',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): TdrConfig => ({})
  },
  geneBar: {
    kind: 'geneBar',
    label: 'Bar',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: false,
    defaultConfig: (): BarConfig => ({})
  },
  pca: {
    kind: 'pca',
    label: 'Cluster',
    category: 'plotting',
    // Sample-level embedding of the clean intensities only; a fold-change "responsome" embedding
    // (Compare-fed) reads differently enough that it isn't offered here.
    acceptsFrom: ['standardize'],
    hasRun: false,
    // Defaults chosen to match a standard tool's PCA (e.g. Spectronaut): covariance (no per-gene
    // scaling), complete cases only (no imputation), log2, individual replicates, no per-sample
    // normalization.
    defaultConfig: (): ClusterConfig => ({
      method: 'pca',
      colorBy: 'cmpd',
      display: 'centroid',
      legend: 'simple',
      scale: 'none',
      missing: 'complete',
      center: 'none',
      topVar: 0,
      transform: 'auto',
      replicates: 'individual'
    })
  },
  enrich: {
    kind: 'enrich',
    label: 'Enrichment',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): EnrichConfig => ({
      method: 'ora',
      source: 'go',
      style: 'dot',
      topTerms: 15
    })
  },
  string: {
    kind: 'string',
    label: 'STRING network',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): StringConfig => ({
      confidence: 'medium',
      maxGenes: 40,
      addInteractors: false
    })
  },
  qc: {
    kind: 'qc',
    label: 'QC',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: false,
    defaultConfig: (): QcConfig => ({ metric: 'intensity', plot: 'box' })
  },
  corr: {
    kind: 'corr',
    label: 'Correlation',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: false,
    defaultConfig: (): CorrConfig => ({ cluster: true })
  },
  table: {
    kind: 'table',
    label: 'Data table',
    category: 'plotting',
    // Shows the upstream step's results table; any processing step can feed it.
    acceptsFrom: ['standardize', 'compare', 'contrast'],
    hasRun: false,
    defaultConfig: (): TableConfig => ({})
  },
  plotGroup: {
    kind: 'plotGroup',
    label: 'Plot group',
    category: 'plotting',
    // Union of every plotting op's inputs, so a group can wire from any of them; all its
    // children must be compatible with the single upstream it actually binds to.
    acceptsFrom: ['standardize', 'compare', 'contrast'],
    hasRun: false,
    defaultConfig: (): PlotGroupConfig => ({ children: [] })
  }
}

export interface CategorySpec {
  category: NodeCategory
  label: string
  accent: string
  /** operations available in this category (first is the default when adding) */
  ops: NodeKind[]
}

export const CATEGORIES: Record<NodeCategory, CategorySpec> = {
  data: { category: 'data', label: 'Data', accent: '#6ea8fe', ops: ['load'] },
  processing: {
    category: 'processing',
    label: 'Processing',
    accent: '#8a7fe0',
    ops: ['standardize', 'compare', 'contrast']
  },
  plotting: {
    category: 'plotting',
    label: 'Visualisation',
    accent: '#e0678f',
    ops: [
      'volcano',
      'heatmap',
      'scatter',
      'ma',
      'dr',
      'bubble',
      'dumbbell',
      'tdr',
      'geneBar',
      'pca',
      'enrich',
      'string',
      'qc',
      'corr',
      'table'
    ]
  }
}

/** Categories offered in the add-node toolbar. */
export const ADDABLE_CATEGORIES: NodeCategory[] = ['data', 'processing', 'plotting']

/** Sub-sections for the visualisation (plotting) ops, grouped by what each shows. Single source of
 *  truth for BOTH the add-plot menu (NodeConfigPanel) and the new-step picker (TilePicker), so the
 *  two stay in sync. Any plotting kind not listed falls into a trailing "Other" section. */
export const PLOT_SECTIONS: { label: string; kinds: NodeKind[] }[] = [
  { label: 'Data', kinds: ['table'] },
  { label: 'Global', kinds: ['qc', 'heatmap', 'corr', 'pca', 'geneBar'] },
  { label: 'Differential', kinds: ['volcano', 'ma'] },
  { label: 'Conditions', kinds: ['bubble', 'dr', 'tdr'] },
  { label: 'Contrast', kinds: ['scatter', 'dumbbell'] },
  { label: 'Function', kinds: ['enrich', 'string'] }
]
export const ALL_OPS: NodeKind[] = [
  'load',
  'standardize',
  'compare',
  'contrast',
  'volcano',
  'heatmap',
  'scatter',
  'ma',
  'dr',
  'bubble',
  'dumbbell',
  'tdr',
  'geneBar',
  'pca',
  'enrich',
  'string',
  'qc',
  'corr',
  'table',
  // `plotGroup` is intentionally omitted from CATEGORIES.plotting.ops (never offered in the
  // picker or the Operation dropdown) but must be in ALL_OPS so canConnect/lookup resolve it.
  'plotGroup'
]

/** The plotting ops NodeConfigPanel's PlotConfig has a panel for (the rest render nothing) —
 *  the Results tile shows its config gear only for these. */
export const PLOT_CONFIG_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'volcano',
  'heatmap',
  'scatter',
  'dumbbell',
  'ma',
  'dr',
  'bubble',
  'tdr',
  'geneBar',
  'pca',
  'enrich',
  'string',
  'qc',
  'corr',
  'table'
])

export function categoryOf(op: NodeKind): NodeCategory {
  return NODE_SPECS[op].category
}
export function accentOf(category: NodeCategory): string {
  return CATEGORIES[category].accent
}
/** Display label for a plotting tile. Like NODE_SPECS[kind].label, but a `dr` tile shows its axis
 *  (Dose- vs Time-response) so the two dr variants read distinctly wherever a tile is labelled —
 *  group subcards, the canvas group tile, and result panels. */
export function plotLabel(kind: NodeKind, config?: unknown): string {
  if (kind === 'dr') {
    const axis = (config as { axis?: unknown } | null | undefined)?.axis
    return axis === 'time' ? 'Time-response' : 'Dose-response'
  }
  return NODE_SPECS[kind].label
}

/** One selectable entry in a plot picker. Usually one per plotting kind, but a kind with a
 *  meaningful config variant appears as several — the `dr` plot is offered as separate
 *  Dose-response and Time-response entries, each seeding its `axis` via `override`. Shared by the
 *  new-step TilePicker and the add-plot menu (NodeConfigPanel) so the two stay in sync. */
export interface PlotMenuEntry {
  kind: NodeKind
  label: string
  override?: Record<string, unknown>
}
/** Fan one plotting kind out into its menu entries: `dr` splits into dose/time, all else is 1:1. */
export function plotEntriesFor(kind: NodeKind): PlotMenuEntry[] {
  return kind === 'dr'
    ? [
        { kind: 'dr', label: 'Dose-response', override: { axis: 'dose' } },
        { kind: 'dr', label: 'Time-response', override: { axis: 'time' } }
      ]
    : [{ kind, label: NODE_SPECS[kind].label }]
}
/** A stable key per entry (kind + any override), so React keys and "already added" checks are
 *  unambiguous when one kind yields several entries. */
export function entryKey(e: PlotMenuEntry): string {
  return e.override
    ? `${e.kind}:${Object.entries(e.override)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')}`
    : e.kind
}

/** Which response axes the upstream data actually carries — for gating dose/time plot options. */
export type AxisAvail = { dose: boolean; time: boolean }
/** Derive it from the plot's upstream result: a Standardize's `activeConditions` is authoritative;
 *  Compare/Contrast are read from their rows. Unknown upstream (not yet run) ⇒ allow both, so we
 *  never hide an option we can't rule out. */
export function axisAvailFromResult(r: NodeResult | undefined): AxisAvail {
  if (!r) return { dose: true, time: true }
  if (r.kind === 'standardize') {
    const ac = r.std.activeConditions ?? []
    return { dose: ac.includes('dose'), time: ac.includes('time') }
  }
  const rows = r.kind === 'compare' ? r.cmp.rows : r.kind === 'contrast' ? r.ctr.rows : null
  if (!rows) return { dose: true, time: true }
  return { dose: rows.some((x) => x.dose != null), time: rows.some((x) => x.time != null) }
}
/** The graph slice `axisAvailFor` walks: nodes, edges, and whatever results exist. */
export interface AxisGraph {
  nodes: GraphNode[]
  edges: { source: string; target: string }[]
  results: Record<string, NodeResult>
}
/** Response-axis availability for a plot fed by `upstreamId`, robust to a stale upstream: a run
 *  result is authoritative; without one (invalidated by an upstream edit, or never run) walk up
 *  the chain to the Clean data tile and use its declared `activeConditions`. When that's
 *  auto-detect (null) and nothing has run, NOTHING is known — offer neither response axis rather
 *  than options the data may not support (a stale menu would otherwise contradict the pipeline's
 *  "needs re-run" state). No upstream at all (unwired) ⇒ allow both. */
export function axisAvailFor(g: AxisGraph, upstreamId: string | undefined): AxisAvail {
  if (!upstreamId) return { dose: true, time: true }
  const seen = new Set<string>()
  let id: string | undefined = upstreamId
  while (id && !seen.has(id)) {
    seen.add(id)
    const r = g.results[id]
    if (r) return axisAvailFromResult(r)
    const n = g.nodes.find((x) => x.id === id)
    if (n && isStep(n) && n.data.kind === 'standardize') {
      const ac = (n.data.config as StandardizeConfig).activeConditions
      if (ac) return { dose: ac.includes('dose'), time: ac.includes('time') }
      return { dose: false, time: false }
    }
    id = g.edges.find((e) => e.target === id)?.source
  }
  return { dose: false, time: false }
}
/** True if an edge from `source` op into `target` op is allowed. */
export function canConnect(source: NodeKind, target: NodeKind): boolean {
  return NODE_SPECS[target].acceptsFrom.includes(source)
}
/** Nodes that accept TWO upstream inputs; every other node accepts one. `contrast` pools two
 *  comparisons; `compare` pools two datasets so conditions can be drawn from either (joined by
 *  uniqID — see combineStandardize). */
/** Nodes that accept several upstream inputs; every other node accepts one. Contrast can take
 *  any number (the selector picks the two datasets to contrast); Compare pools two. */
export function maxInputsFor(kind: NodeKind): number {
  return kind === 'contrast' ? Infinity : kind === 'compare' ? 2 : 1
}
/** True if any op accepts `op` as an input (i.e. the node can be a source). */
export function hasSourceHandle(op: NodeKind): boolean {
  return ALL_OPS.some((k) => NODE_SPECS[k].acceptsFrom.includes(op))
}
