/** Static metadata for node operations, grouped under high-level categories. */
import {
  condLabel,
  contextOf,
  ctxNum,
  customCond,
  DEFAULT_THRESHOLD,
  numericConds,
  type ConditionKey,
  type ContextRow,
  type SampleFilter
} from '../engine'
import {
  clusterRunMatches,
  CURVECURATOR_THRESHOLD,
  isStep,
  loadNumericConditions,
  numericOfResult,
  tdrPair
} from './types'
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
  StepNode,
  NodeCategory,
  NodeConfig,
  NodeKind,
  NodeResult,
  GraphNode,
  ClusterConfig,
  CorrConfig,
  PlotGroupConfig,
  PotencyConfig,
  MetricsConfig,
  VarianceConfig,
  InteractionConfig,
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
    // Load data (an import to read), or Clean data (a Merge, a Subset of one): a second Clean data
    // runs its clean-up, normalisation and imputation on the table it's given
    acceptsFrom: ['load', 'standardize'],
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
    // Like Merge, it emits a Clean-data result (see outputKindOf), so it chains off either. Off Load
    // data it filters the raw import instead, before Clean data cleans it (see wiredKindOf).
    acceptsFrom: ['load', 'standardize'],
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
  metrics: {
    kind: 'metrics',
    label: 'Curve metrics',
    category: 'plotting',
    // A curve fit's parameters per gene as bar charts (a surface's per slice level).
    acceptsFrom: ['curveFit'],
    hasRun: true,
    defaultConfig: (): MetricsConfig => ({})
  },
  variance: {
    kind: 'variance',
    label: 'Variance',
    category: 'plotting',
    // An ANOVA's per-gene shares of variation, per factor (its model, kept with the result).
    acceptsFrom: ['compare'],
    hasRun: true,
    defaultConfig: (): VarianceConfig => ({ topGenes: 20 })
  },
  interaction: {
    kind: 'interaction',
    label: 'Interaction',
    category: 'plotting',
    // An ANOVA's per-gene cell means across one factor, a line per level of another (others averaged).
    acceptsFrom: ['compare'],
    hasRun: true,
    defaultConfig: (): InteractionConfig => ({})
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
      'metrics',
      'variance',
      'interaction',
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
  { label: 'Factors', kinds: ['variance', 'interaction'] },
  { label: 'Conditions', kinds: ['bubble', 'dr', 'response', 'potency', 'metrics', 'tdr'] },
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
  'metrics',
  'variance',
  'interaction',
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
  'metrics',
  'variance',
  'interaction',
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
/** A numeric condition as a Response plot's title names it: capitalised (`Dose`, `Temperature`). */
const condTitle = (c: ConditionKey): string => {
  const l = condLabel(c)
  return l.charAt(0).toUpperCase() + l.slice(1)
}
/** A Response plot's name from the numeric conditions it's over: "Dose response",
 *  "Dose & Time response". */
export const responseLabel = (conds: readonly ConditionKey[]): string =>
  `${conds.map(condTitle).join(' & ')} response`

/** Display label for a plotting tile. Like NODE_SPECS[kind].label, but a Response plot names the
 *  numeric conditions it's over (`dr`: its axis — "Dose response"; `tdr`: its pair — "Dose & Time
 *  response"), so the per-condition variants read distinctly wherever a tile is labelled — group
 *  subcards, the canvas group tile, and result panels. */
export function plotLabel(kind: NodeKind, config?: unknown): string {
  if (kind === 'dr') {
    const axis = (config as { axis?: ConditionKey } | null | undefined)?.axis
    return responseLabel([axis ?? 'dose'])
  }
  if (kind === 'tdr') return responseLabel(tdrPair(config as TdrConfig | undefined))
  if (kind === 'response')
    return responseLabel((config as ResponseConfig | undefined)?.pair ?? ['dose', 'time'])
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
 *  meaningful config variant appears as several — the Response plots are offered one per numeric
 *  condition (`dr`, seeding its `axis`) and one per pair of them (`tdr`, seeding its `pair`) via
 *  `override`. Shared by the new-step TilePicker and the add-plot menu (NodeConfigPanel) so the two
 *  stay in sync. */
export interface PlotMenuEntry {
  kind: NodeKind
  label: string
  override?: Record<string, unknown>
}
/** The numeric conditions assumed where the data isn't known (no upstream, Settings' defaults). */
export const DEFAULT_AXES: ConditionKey[] = ['dose', 'time']
/** Fan one plotting kind out into its menu entries over the data's numeric conditions (`axes`, in
 *  order): `dr` → one per condition ("Dose response", "Time response", "Temp response"), `tdr` →
 *  one per pair, the earlier along x ("Dose & Time response", "Dose & Temp response", …); all else
 *  is 1:1. Each is its own tile, so several can be on view at once. */
export function plotEntriesFor(
  kind: NodeKind,
  axes: readonly ConditionKey[] = DEFAULT_AXES
): PlotMenuEntry[] {
  if (kind === 'dr')
    return axes.map((a) => ({ kind, label: responseLabel([a]), override: { axis: a } }))
  if (kind === 'tdr' || kind === 'response')
    return axes.flatMap((a, i) =>
      axes.slice(i + 1).map((b) => ({
        kind,
        label: responseLabel([a, b]),
        override: { pair: [a, b] }
      }))
    )
  return [{ kind, label: NODE_SPECS[kind].label }]
}
/** A stable key per entry (kind + any override), so React keys and "already added" checks are
 *  unambiguous when one kind yields several entries. A pair joins with `&`. */
export function entryKey(e: PlotMenuEntry): string {
  return e.override
    ? `${e.kind}:${Object.entries(e.override)
        .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('&') : v}`)
        .join(',')}`
    : e.kind
}
/** The entry key a tile of `kind` with `config` answers to — its variant read from its config, so a
 *  tile saved before its kind had variants (a tdr with no pair) matches the entry it now is. */
export function tileEntryKey(kind: NodeKind, config: unknown): string {
  const label = plotLabel(kind, config)
  if (kind === 'dr')
    return entryKey({ kind, label, override: { axis: (config as DRConfig)?.axis ?? 'dose' } })
  if (kind === 'tdr')
    return entryKey({ kind, label, override: { pair: tdrPair(config as TdrConfig) } })
  if (kind === 'response')
    return entryKey({
      kind,
      label,
      override: { pair: (config as ResponseConfig)?.pair ?? ['dose', 'time'] }
    })
  return kind
}

/** Which numeric conditions the upstream data actually carries, in the schema's order (dose, time,
 *  then the declared custom ones) — the Response plots are offered one per condition and one per
 *  pair of them. */
export type AxisAvail = ConditionKey[]
/** Derive it from the plot's upstream result: a Standardize's `activeConditions` is authoritative;
 *  Compare/Contrast are read from their rows. Unknown upstream (not yet run) ⇒ dose and time, so we
 *  never hide an option we can't rule out. */
export function axisAvailFromResult(r: NodeResult | undefined): AxisAvail {
  if (!r) return DEFAULT_AXES
  const hit = availByResult.get(r)
  if (hit) return [...hit]
  const avail = scanAxisAvail(r)
  availByResult.set(r, avail)
  return [...avail]
}
/** A result's response axes, scanned once: a result is never changed once made (a re-run makes a
 *  new one), and the scan walks every row — on a million-row Contrast, ~0.4 s. It runs inside
 *  store selectors (useUpstreamFacts), which re-run on every store change, once per tile asking. */
const availByResult = new WeakMap<NodeResult, AxisAvail>()
/** A Compare's or a Contrast's context tuples (one per distinct condition context), else null. */
const contextRowsOf = (r: NodeResult): readonly ContextRow[] | null =>
  r.kind === 'compare' ? contextOf(r.cmp).rows : r.kind === 'contrast' ? contextOf(r.ctr).rows : null
function scanAxisAvail(r: NodeResult): AxisAvail {
  const numeric = numericOfResult(r)
  if (r.kind === 'standardize') {
    const ac = r.std.activeConditions ?? []
    return [...numeric].filter((c) => ac.includes(c))
  }
  // the context tuples (contextOf) carry every condition value the rows do — no row built
  const rows = contextRowsOf(r)
  if (!rows) return DEFAULT_AXES
  return [...numeric].filter((c) => rows.some((x) => ctxNum(x, c) != null))
}
/**
 * The numeric conditions this result actually varies over: at least TWO distinct levels.
 *
 * A single-dose experiment (one concentration plus its vehicle, say) has `dose` as a condition but
 * no dose *series*, so a dose–response curve or a bubble plot over it has nothing to show — one
 * point per gene, and a category axis with a single level. Kept apart from `axisAvailFromResult`,
 * which answers the different question of which conditions are present at all (plots read it to
 * label and facet, and a one-level condition still belongs there).
 *
 * Unknown when the rows aren't in hand (not run yet, or a kind without per-level rows): every
 * available axis is returned, so a plot is never blocked on a guess.
 */
const multiByResult = new WeakMap<NodeResult, AxisAvail>()
export function multiLevelAxes(r: NodeResult | undefined): AxisAvail {
  if (!r) return DEFAULT_AXES
  const hit = multiByResult.get(r)
  if (hit) return [...hit]
  const rows = contextRowsOf(r)
  const avail = axisAvailFromResult(r)
  const found = !rows
    ? avail
    : avail.filter((c) => {
        const seen = new Set<number>()
        for (const x of rows) {
          const v = ctxNum(x, c)
          if (v != null) seen.add(v)
          if (seen.size > 1) return true
        }
        return false
      })
  multiByResult.set(r, found)
  return [...found]
}

/** The axes a plot over one numeric condition (Bubble) can switch between, and the one it draws:
 *  of the conditions present, those with a series (multiLevelAxes) — all present ones when none
 *  has — and its chosen axis when that's among them, else the first. So a saved axis the data
 *  doesn't vary over (a default dose on time-only data) never blanks the plot. */
export function seriesAxes(
  want: ConditionKey | undefined,
  present: readonly ConditionKey[],
  r: NodeResult | undefined
): { axes: ConditionKey[]; axis: ConditionKey | undefined } {
  const multi = r ? multiLevelAxes(r) : present
  const series = present.filter((c) => multi.includes(c))
  const axes = series.length ? series : [...present]
  return { axes, axis: want != null && axes.includes(want) ? want : axes[0] }
}

/** The axes a Curve fit's rows were fitted over (a surface's pair aside), scanned once per result
 *  as axisAvailFromResult is. */
const fittedByResult = new WeakMap<NodeResult, ConditionKey[]>()
function fittedAxes(r: NodeResult): ConditionKey[] {
  if (r.kind !== 'compare') return []
  let hit = fittedByResult.get(r)
  if (!hit) {
    const found = new Set<ConditionKey>()
    // each context's axis (`along`: a curve's, else a response fit's) — no row built
    for (const x of contextOf(r.cmp).rows) {
      const a = x.along === 'surface' ? undefined : x.along
      if (a != null) found.add(a as ConditionKey)
    }
    hit = [...found]
    fittedByResult.set(r, hit)
  }
  return hit
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
  if (!upstreamId) return DEFAULT_AXES
  const seen = new Set<string>()
  const walk = (id: string | undefined): AxisAvail => {
    while (id && !seen.has(id)) {
      seen.add(id)
      const r = g.results[id]
      if (r) {
        const axes = axisAvailFromResult(r)
        // A Contrast of Curve fits: its rows are the curves' summaries (no level of their axis),
        // so the axes its inputs fit over count too — its Response plot draws their curves.
        if (r.kind !== 'contrast') return axes
        const at = id
        const fitted = g.edges
          .filter((e) => e.target === at)
          .flatMap((e) => {
            const up = g.results[e.source]
            return up ? fittedAxes(up) : []
          })
        return orderAxes([...new Set([...axes, ...fitted])])
      }
      const n = g.nodes.find((x) => x.id === id)
      if (n && isStep(n) && n.data.kind === 'standardize') {
        const ac = (n.data.config as StandardizeConfig).activeConditions
        if (!ac) return []
        // the Load data it cleans declares which of its custom conditions are numeric
        const load = loadAbove(g, id)?.load
        const numeric = load
          ? numericConds(loadNumericConditions(load.data.config as LoadConfig).map(customCond))
          : numericConds()
        return [...numeric].filter((c) => ac.includes(c))
      }
      // A Merge pools several inputs and its conditions are their union, so an unrun one has to
      // branch rather than follow whichever edge happens to be first.
      if (n && isStep(n) && n.data.kind === 'merge') {
        const ups = g.edges.filter((e) => e.target === id).map((e) => e.source)
        const found = new Set(ups.flatMap((u) => walk(u)))
        return orderAxes([...found])
      }
      id = g.edges.find((e) => e.target === id)?.source
    }
    return []
  }
  return walk(upstreamId)
}
/** Numeric conditions in the schema's order: dose, time, then the custom ones as first seen. */
const orderAxes = (cs: ConditionKey[]): ConditionKey[] => [
  ...DEFAULT_AXES.filter((c) => cs.includes(c)),
  ...cs.filter((c) => !DEFAULT_AXES.includes(c))
]
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
/** What a step's output wires as in this graph: outputKindOf its kind — except a Subset fed (through
 *  any Subsets) by Load data. That one filters the raw import, so its output is still Load data,
 *  which only Clean data takes. Undefined for a node that isn't a step. */
export function wiredKindOf(
  g: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
  id: string
): NodeKind | undefined {
  const seen = new Set<string>()
  let cur: string | undefined = id
  let first: NodeKind | undefined
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = g.nodes.find((x) => x.id === cur)
    if (!n || !isStep(n)) return first
    const kind = n.data.kind
    first ??= kind
    // the first step that isn't a Subset: Load data passes through as Load data
    if (kind !== 'subset') return kind === 'load' ? 'load' : outputKindOf(first)
    const at: string = cur
    cur = g.edges.find((e) => e.target === at)?.source
  }
  return first && outputKindOf(first)
}
/** Whether step `id` has a run of its own in this graph: its spec's hasRun — but a Subset off Load
 *  data hasn't (wiredKindOf): Clean data applies its filter as it reads the import, so, like Load
 *  data, it's ready once the import is configured and an edit to it stales what's below. */
export function runsIn(
  g: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
  id: string
): boolean {
  const n = g.nodes.find((x) => x.id === id)
  if (!n || !isStep(n) || !NODE_SPECS[n.data.kind].hasRun) return false
  return !(n.data.kind === 'subset' && wiredKindOf(g, id) === 'load')
}

/** The Load data step `id` reads (its input, or the one above any Subsets in between) and the
 *  filters of those Subsets (conditions, replicates, samples left out) — what a Clean data step
 *  cleans. Undefined when no Load data is there. */
export function loadAbove(
  g: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
  id: string
): { load: StepNode; keep: SampleFilter[] } | undefined {
  const keep: SampleFilter[] = []
  const seen = new Set<string>([id])
  let cur = g.edges.find((e) => e.target === id)?.source
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const at: string = cur
    const n = g.nodes.find((x) => x.id === at)
    if (!n || !isStep(n)) return undefined
    if (n.data.kind === 'load') return { load: n, keep }
    if (n.data.kind !== 'subset') return undefined
    const c = n.data.config as SubsetConfig
    keep.push({ keep: c.keep ?? {}, reps: c.reps, drop: c.drop })
    cur = g.edges.find((e) => e.target === at)?.source
  }
  return undefined
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
