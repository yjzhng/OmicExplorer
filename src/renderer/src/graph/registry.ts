/** Static metadata for node operations, grouped under high-level categories. */
import { DEFAULT_THRESHOLD } from '../engine'
import { clusterRunMatches, CURVECURATOR_THRESHOLD, isStep } from './types'
import type {
  BarConfig,
  BubbleConfig,
  CompareConfig,
  ContrastConfig,
  CurveFitConfig,
  DRConfig,
  DumbbellConfig,
  EnrichConfig,
  StringConfig,
  HeatmapConfig,
  LoadConfig,
  MAConfig,
  MergeConfig,
  SubsetConfig,
  NodeCategory,
  NodeConfig,
  NodeKind,
  NodeResult,
  GraphNode,
  ClusterConfig,
  CorrConfig,
  PlotGroupConfig,
  PotencyConfig,
  CurveMadConfig,
  ResponseConfig,
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
  /** whether the op has a Run action: a step computes its data; a plot computes what it needs to
   *  be viewed (graph/plotRun.ts) — green on the canvas then means ready to view */
  hasRun: boolean
  /** a runnable op's config change: whether it makes the result stale (it must run again). Unset =
   *  every change does (the steps). Plots set it — their view settings never do, only a setting
   *  outside what the run computed. */
  staleOn?: (next: NodeConfig, prev: NodeConfig, result: NodeResult | undefined) => boolean
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
  merge: {
    kind: 'merge',
    label: 'Merge',
    subtitle: 'pool datasets into one',
    category: 'processing',
    // Chaining works without listing 'merge' here: outputKindOf resolves a Merge to the
    // standardize result it emits.
    acceptsFrom: ['standardize'],
    hasRun: true,
    defaultConfig: (): MergeConfig => ({})
  },
  subset: {
    kind: 'subset',
    label: 'Subset',
    subtitle: 'keep chosen conditions',
    category: 'processing',
    // Like Merge, it emits a Clean-data result (see outputKindOf), so it chains off either.
    acceptsFrom: ['standardize'],
    hasRun: true,
    defaultConfig: (): SubsetConfig => ({ keep: {} })
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
      // The P-value route, on the hyperbolic boundary (as switching back to P-value picks).
      threshold: { ...DEFAULT_THRESHOLD, type: 'non-linear', statType: 'pP' }
    })
  },
  curveFit: {
    kind: 'curveFit',
    label: 'Curve fit',
    subtitle: 'dose / time curves',
    category: 'processing',
    acceptsFrom: ['standardize'],
    hasRun: true,
    defaultConfig: (): CurveFitConfig => ({
      analysis: 'curve_fit',
      method: 'ttest',
      curveAxis: 'dose',
      // Fresh tile: nothing declared — the user opens "Configure curve fit" to pick the
      // treatments and the control.
      num: {},
      den: {},
      match: [],
      condition: 'cmpd',
      pairNum: '',
      pairDen: '',
      condition2: 'dose',
      pair2Num: '',
      pair2Den: '',
      threshold: { ...DEFAULT_THRESHOLD, ...CURVECURATOR_THRESHOLD }
    })
  },
  contrast: {
    kind: 'contrast',
    label: 'Contrast',
    subtitle: 'side-by-side A vs B',
    category: 'processing',
    // One Compare (split by a condition), or two same-kind inputs (Compare or Standardize) joined
    // as FC1/FC2 in 'pair' mode.
    acceptsFrom: ['compare', 'curveFit', 'standardize'],
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
    acceptsFrom: ['compare', 'curveFit'],
    hasRun: true,
    defaultConfig: (): VolcanoConfig => ({ capEnabled: false, labelTop: 20 })
  },
  heatmap: {
    kind: 'heatmap',
    label: 'Heatmap',
    category: 'plotting',
    // Standardize → intensity heatmap; Compare / Curve fit → log2FC heatmap (same tile, upstream
    // decides).
    acceptsFrom: ['standardize', 'compare', 'curveFit'],
    hasRun: true,
    defaultConfig: (): HeatmapConfig => ({ capEnabled: false, maxGenes: 50 })
  },
  scatter: {
    kind: 'scatter',
    label: 'Scatter',
    category: 'plotting',
    // Contrast → FC1 vs FC2. Compare → log10 intensity of the two compared groups
    // (mean1 vs mean2), e.g. the basal clpP-vs-WT abundances from a direct comparison.
    acceptsFrom: ['contrast', 'compare'],
    hasRun: true,
    defaultConfig: (): ScatterConfig => ({ capEnabled: false, labelTop: 20 })
  },
  ma: {
    kind: 'ma',
    label: 'MA',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: true,
    defaultConfig: (): MAConfig => ({ fcLow: -1, fcHigh: 1 })
  },
  dr: {
    kind: 'dr',
    label: 'Dose/time-response',
    category: 'plotting',
    // From a Compare: every gene's response over the levels; from a Curve fit: its fitted curves.
    // From a Contrast: the hovered gene's response on
    // BOTH contrasted sides (FC1 vs FC2), for comparing profiles between two datasets/contrasts.
    acceptsFrom: ['compare', 'curveFit', 'contrast'],
    hasRun: true,
    defaultConfig: (): DRConfig => ({ axis: 'dose', capEnabled: true, topGenes: 10 })
  },
  potency: {
    kind: 'potency',
    label: 'Potency',
    category: 'plotting',
    // A curve fit's pEC50 against its curve fold change (CurveCurator's potency plot).
    acceptsFrom: ['curveFit'],
    hasRun: true,
    defaultConfig: (): PotencyConfig => ({ show: 'all', capEnabled: false, labelTop: 20 })
  },
  curveMad: {
    kind: 'curveMad',
    // Shown under the same name as Clean data's QC plot (qc): each tile only appears for its own
    // input, so the two never sit side by side.
    label: 'QC',
    category: 'plotting',
    // A curve fit's QC: its residuals from the fits (CurveCurator's MAD analysis), and the curves'
    // metrics against each other.
    acceptsFrom: ['curveFit'],
    hasRun: true,
    defaultConfig: (): CurveMadConfig => ({})
  },
  response: {
    kind: 'response',
    // Shown under the same name as the Compare's dose × time plot (tdr): each tile only appears
    // for its own input, so the two never sit side by side.
    label: 'Dose & Time response',
    category: 'plotting',
    // A Curve fit's dose × time surfaces (the response surface method), one gene at a time.
    acceptsFrom: ['curveFit'],
    hasRun: true,
    defaultConfig: (): ResponseConfig => ({ show: 'line' })
  },
  bubble: {
    kind: 'bubble',
    label: 'Bubble',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: true,
    defaultConfig: (): BubbleConfig => ({ axis: 'dose', capEnabled: true, topGenes: 20 })
  },
  dumbbell: {
    kind: 'dumbbell',
    label: 'Dumbbell',
    category: 'plotting',
    acceptsFrom: ['contrast'],
    hasRun: true,
    defaultConfig: (): DumbbellConfig => ({ capEnabled: true, topGenes: 20 })
  },
  tdr: {
    kind: 'tdr',
    // The same name as the Curve fit's (response) — see there.
    label: 'Dose & Time response',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: true,
    defaultConfig: (): TdrConfig => ({})
  },
  geneBar: {
    kind: 'geneBar',
    label: 'Bar',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: true,
    // Colour left unset: by condition with few samples, by value with many (barColorConds).
    defaultConfig: (): BarConfig => ({})
  },
  pca: {
    kind: 'pca',
    label: 'Cluster',
    category: 'plotting',
    // Sample-level embedding of the clean intensities only; a fold-change "responsome" embedding
    // (Compare-fed) reads differently enough that it isn't offered here.
    acceptsFrom: ['standardize'],
    hasRun: true,
    // Defaults chosen to match a standard tool's PCA (e.g. Spectronaut): covariance (no per-gene
    // scaling), complete cases only (no imputation), log2, individual replicates, no per-sample
    // normalization. `display: 'replicate'` shows every data point — the raw scatter is what a PCA
    // is usually read from; the centroid + territory view is a summary to switch up to.
    defaultConfig: (): ClusterConfig => ({
      method: 'pca',
      colorBy: 'cmpd',
      display: 'replicate',
      territory: 'hull',
      plot: 'pc',
      loadings: 10,
      clusterOn: 'coords',
      clusterCount: 'fixed',
      clusterK: 3,
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
    acceptsFrom: ['compare', 'curveFit'],
    hasRun: true,
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
    acceptsFrom: ['compare', 'curveFit'],
    hasRun: true,
    // No confidence: auto — the highest level that still draws a network.
    defaultConfig: (): StringConfig => ({
      maxGenes: 40,
      addInteractors: false
    })
  },
  qc: {
    kind: 'qc',
    label: 'QC',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: true,
    // Colour left unset: by condition with few samples, one colour with many (qcColorBy).
    defaultConfig: (): QcConfig => ({ metric: 'intensity', plot: 'box' })
  },
  corr: {
    kind: 'corr',
    label: 'Correlation',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: true,
    defaultConfig: (): CorrConfig => ({ cluster: true })
  },
  table: {
    kind: 'table',
    label: 'Data table',
    category: 'plotting',
    // Shows the upstream step's results table; any processing step can feed it.
    acceptsFrom: ['standardize', 'compare', 'curveFit', 'contrast'],
    hasRun: true,
    defaultConfig: (): TableConfig => ({})
  },
  plotGroup: {
    kind: 'plotGroup',
    label: 'Plot',
    category: 'plotting',
    // Union of every plotting op's inputs, so a group can wire from any of them; all its
    // children must be compatible with the single upstream it actually binds to.
    acceptsFrom: ['standardize', 'compare', 'curveFit', 'contrast'],
    hasRun: true,
    defaultConfig: (): PlotGroupConfig => ({ children: [] })
  }
}

// A plot's run computes what EVERY setting its tile offers needs (all enrichment methods and term
// sources, all STRING levels / caps / interactor modes …), so changing a setting only re-renders —
// its view settings never make the result stale. The exceptions are settings outside what the run
// covered, below.
for (const spec of Object.values(NODE_SPECS))
  if (spec.category === 'plotting' && !spec.staleOn) spec.staleOn = () => false
// Cluster: the embedding's settings (and, colouring by cluster, the clustering's) need another
// run; colour by a condition, the plot, territory and look only redraw (clusterRunMatches).
NODE_SPECS.pca.staleOn = (next, _prev, result) =>
  result?.kind !== 'cluster' || !clusterRunMatches(next as ClusterConfig, result.ran)
// STRING: a species override reads another organism; a gene cap the run didn't cover (a custom one
// typed in the gear) needs its query read.
NODE_SPECS.string.staleOn = (next, prev, result) => {
  const n = next as StringConfig
  const p = prev as StringConfig
  if ((n.species ?? 0) !== (p.species ?? 0)) return true
  const cap = n.maxGenes > 0 ? n.maxGenes : 40
  return result?.kind === 'string' && !result.caps.includes(cap)
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
    ops: ['standardize', 'merge', 'subset', 'compare', 'curveFit', 'contrast']
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
      'potency',
      'curveMad',
      'response',
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
  { label: 'Global', kinds: ['qc', 'curveMad', 'heatmap', 'corr', 'pca', 'geneBar'] },
  { label: 'Differential', kinds: ['volcano', 'ma'] },
  { label: 'Conditions', kinds: ['bubble', 'dr', 'response', 'potency', 'tdr'] },
  { label: 'Contrast', kinds: ['scatter', 'dumbbell'] },
  { label: 'Function', kinds: ['enrich', 'string'] }
]
export const ALL_OPS: NodeKind[] = [
  'load',
  'standardize',
  'merge',
  'subset',
  'compare',
  'curveFit',
  'contrast',
  'volcano',
  'heatmap',
  'scatter',
  'ma',
  'dr',
  'potency',
  'curveMad',
  'response',
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
  'potency',
  'curveMad',
  'response',
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
/** The plots whose run computes something of their own (graph/plotRun.ts): enrichment's term
 *  tests, STRING's network read and the cluster's embedding. Every other plot draws live from its
 *  upstream's result — its run only marks it ready, so there's nothing for a Re-run to redo. */
export const plotComputes = (kind: NodeKind): boolean =>
  kind === 'enrich' || kind === 'string' || kind === 'pca'
/** Whether a done plot tile — one plot, or a group of them — has nothing to re-run: none of its
 *  plots computes anything of its own (plotComputes), so a re-run would finish at once and change
 *  nothing. Such a tile offers no Re-run; a fresh result comes from re-running the step it reads. */
export function nothingToRerun(data: {
  kind: NodeKind
  config: NodeConfig
  status?: string
}): boolean {
  if (data.status !== 'done') return false
  if (data.kind === 'plotGroup')
    return (data.config as PlotGroupConfig).children.every((c) => !plotComputes(c.kind))
  return categoryOf(data.kind) === 'plotting' && !plotComputes(data.kind)
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

/** A tile name leads downloaded plot/table filenames (see PanelTile), so it's filtered to
 *  file-name-safe characters as it's typed. Shared so every rename field — the canvas tile and the
 *  form workflow's step header — filters identically; `renameNode` re-applies it as a backstop. */
export const safeTileName = (v: string): string => v.replace(/[^A-Za-z0-9 ._-]+/g, '')

/** What to call a step: the user's own name if it has one, else its type label. The single rule
 *  behind every surface that shows a step — canvas tile, form section, results tab, paged nav — so
 *  renaming a tile reads the same everywhere. */
export function stepTitle(node: {
  data: { kind: NodeKind; name?: string; config: NodeConfig }
}): string {
  return node.data.name?.trim() || plotLabel(node.data.kind, node.data.config)
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
  const walk = (id: string | undefined): AxisAvail => {
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
      // A Merge pools several inputs and its conditions are their union, so an unrun one has to
      // branch rather than follow whichever edge happens to be first.
      if (n && isStep(n) && n.data.kind === 'merge') {
        const ups = g.edges.filter((e) => e.target === id).map((e) => e.source)
        return ups.reduce<AxisAvail>(
          (acc, u) => {
            const a = walk(u)
            return { dose: acc.dose || a.dose, time: acc.time || a.time }
          },
          { dose: false, time: false }
        )
      }
      id = g.edges.find((e) => e.target === id)?.source
    }
    return { dose: false, time: false }
  }
  return walk(upstreamId)
}
/** The node kind an op's OUTPUT behaves as, for wiring. Merge pools Clean data into one more
 *  Clean-data result (and Subset filters one down to another), so anything that accepts
 *  `standardize` accepts either — expressing that here rather than adding them to a dozen
 *  `acceptsFrom` lists means a tile added later can't accidentally omit them. */
const OUTPUT_KIND: Partial<Record<NodeKind, NodeKind>> = {
  merge: 'standardize',
  subset: 'standardize'
}
export function outputKindOf(op: NodeKind): NodeKind {
  return OUTPUT_KIND[op] ?? op
}
/** True if an edge from `source` op into `target` op is allowed. */
export function canConnect(source: NodeKind, target: NodeKind): boolean {
  return NODE_SPECS[target].acceptsFrom.includes(outputKindOf(source))
}
/** Nodes that accept TWO upstream inputs; every other node accepts one. `contrast` pools two
 *  comparisons; `compare` pools two datasets so conditions can be drawn from either (joined by
 *  uniqID — see combineStandardize). */
/** Nodes that accept several upstream inputs; every other node accepts one. Contrast can take
 *  any number (the selector picks the two datasets to contrast); Compare and Curve fit pool two. */
export function maxInputsFor(kind: NodeKind): number {
  return kind === 'contrast' || kind === 'merge'
    ? Infinity
    : kind === 'compare' || kind === 'curveFit'
      ? 2
      : 1
}
/** True if any op accepts `op` as an input (i.e. the node can be a source). */
export function hasSourceHandle(op: NodeKind): boolean {
  return ALL_OPS.some((k) => NODE_SPECS[k].acceptsFrom.includes(outputKindOf(op)))
}
