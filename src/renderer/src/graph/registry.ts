/** Static metadata for node operations, grouped under high-level categories. */
import { DEFAULT_THRESHOLD } from '../engine'
import type {
  BarConfig,
  BubbleConfig,
  CompareConfig,
  ContrastConfig,
  DRConfig,
  DumbbellConfig,
  FocusConfig,
  HeatmapConfig,
  LoadConfig,
  MAConfig,
  NodeCategory,
  NodeConfig,
  NodeKind,
  ClusterConfig,
  CorrConfig,
  PlotGroupConfig,
  QcConfig,
  ScatterConfig,
  StandardizeConfig,
  TdrConfig,
  VolcanoConfig
} from './types'

/** Fresh default focus config (own arrays, so nodes never alias one list). */
const mkFocus = (): FocusConfig => ({ mode: 'inherit', goi: [], panel: [] })

export interface NodeSpec {
  kind: NodeKind
  label: string
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
    label: 'Standardize',
    category: 'processing',
    acceptsFrom: ['load'],
    hasRun: true,
    defaultConfig: (): StandardizeConfig => ({
      activeConditions: null,
      goi: [],
      panel: [],
      minSamplePct: 0
    })
  },
  compare: {
    kind: 'compare',
    label: 'Compare',
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
    category: 'processing',
    acceptsFrom: ['compare'],
    hasRun: true,
    defaultConfig: (): ContrastConfig => ({
      relationship: 'correlated',
      condition: 'cmpd',
      pairNum: '',
      pairDen: ''
    })
  },
  volcano: {
    kind: 'volcano',
    label: 'Volcano',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): VolcanoConfig => ({ statType: 'pP', labelTop: 0, focus: mkFocus() })
  },
  heatmap: {
    kind: 'heatmap',
    label: 'Heatmap',
    category: 'plotting',
    // Standardize → intensity heatmap; Compare → log2FC heatmap (same tile, upstream decides).
    acceptsFrom: ['standardize', 'compare'],
    hasRun: false,
    defaultConfig: (): HeatmapConfig => ({ maxGenes: 0, log10: true, focus: mkFocus() })
  },
  scatter: {
    kind: 'scatter',
    label: 'Scatter',
    category: 'plotting',
    // Contrast → FC1 vs FC2. Compare → log10 intensity of the two compared groups
    // (mean1 vs mean2), e.g. the basal clpP-vs-WT abundances from a direct comparison.
    acceptsFrom: ['contrast', 'compare'],
    hasRun: false,
    defaultConfig: (): ScatterConfig => ({ labelTop: 0 })
  },
  ma: {
    kind: 'ma',
    label: 'MA',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): MAConfig => ({ fcLow: -1, fcHigh: 1, focus: mkFocus() })
  },
  dr: {
    kind: 'dr',
    label: 'Dose/time-response',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): DRConfig => ({ axis: 'dose', topGenes: 10, focus: mkFocus() })
  },
  bubble: {
    kind: 'bubble',
    label: 'Bubble',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): BubbleConfig => ({ axis: 'dose', topGenes: 20, focus: mkFocus() })
  },
  dumbbell: {
    kind: 'dumbbell',
    label: 'Dumbbell',
    category: 'plotting',
    acceptsFrom: ['contrast'],
    hasRun: false,
    defaultConfig: (): DumbbellConfig => ({ topGenes: 0, focus: mkFocus() })
  },
  tdr: {
    kind: 'tdr',
    label: 'TDR',
    category: 'plotting',
    acceptsFrom: ['compare'],
    hasRun: false,
    defaultConfig: (): TdrConfig => ({ focus: mkFocus() })
  },
  geneBar: {
    kind: 'geneBar',
    label: 'Bar',
    category: 'plotting',
    acceptsFrom: ['standardize'],
    hasRun: false,
    defaultConfig: (): BarConfig => ({ focus: mkFocus() })
  },
  pca: {
    kind: 'pca',
    label: 'Cluster',
    category: 'plotting',
    acceptsFrom: ['standardize', 'compare'],
    hasRun: false,
    defaultConfig: (): ClusterConfig => ({ method: 'pca', colorBy: 'cmpd', display: 'centroid' })
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
    label: 'Plotting',
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
      'qc',
      'corr'
    ]
  }
}

/** Categories offered in the add-node toolbar. */
export const ADDABLE_CATEGORIES: NodeCategory[] = ['data', 'processing', 'plotting']
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
  'qc',
  'corr',
  // `plotGroup` is intentionally omitted from CATEGORIES.plotting.ops (never offered in the
  // picker or the Operation dropdown) but must be in ALL_OPS so canConnect/lookup resolve it.
  'plotGroup'
]

export function categoryOf(op: NodeKind): NodeCategory {
  return NODE_SPECS[op].category
}
export function accentOf(category: NodeCategory): string {
  return CATEGORIES[category].accent
}
/** True if an edge from `source` op into `target` op is allowed. */
export function canConnect(source: NodeKind, target: NodeKind): boolean {
  return NODE_SPECS[target].acceptsFrom.includes(source)
}
/** True if any op accepts `op` as an input (i.e. the node can be a source). */
export function hasSourceHandle(op: NodeKind): boolean {
  return ALL_OPS.some((k) => NODE_SPECS[k].acceptsFrom.includes(op))
}
