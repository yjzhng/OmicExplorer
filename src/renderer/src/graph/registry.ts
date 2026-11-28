/** Static metadata for node operations, grouped under high-level categories. */
import {
  contextOf,
  customCond,
  numericConds,
  type ConditionKey,
  type SampleFilter
} from '../engine'
import { CONTRACT_PRODUCER, type PlotMenuEntry } from '../nodes/contract'
import { SPECS } from '../nodes/specs'
import { AxisAvail, axisAvailFromResult, DEFAULT_AXES, multiLevelAxes } from './models/axisAvail'
import type {
  GraphNode,
  NodeCategory,
  NodeConfig,
  NodeKind,
  NodeResult,
  PlotGroupConfig,
  StepNode
} from './types'
import type { LoadConfig, SubsetConfig } from './config/load'
import type { QuickAccess } from './config/plotStyle'
import type { StandardizeConfig } from './config/standardize'
import { isStep } from './types'
import { loadNumericConditions } from './config/load'

export type { NodeSpec } from '../nodes/contract'
export { responseLabel } from '../nodes/kit/variants'

/** Every kind's node contract, by kind (nodes/<kind>/spec.ts, gathered in nodes/specs.ts). */
export const NODE_SPECS = SPECS

/** The kinds `kind` takes an input from: the canonical producer of each data contract it accepts
 *  (a Merge's or Subset's output wires as Clean data's — see outputKindOf). */
export const acceptsFromOf = (kind: NodeKind): NodeKind[] =>
  NODE_SPECS[kind].input.accepts.map((c) => CONTRACT_PRODUCER[c])

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
      'enrichMap',
      'setCompare',
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
  { label: 'Function', kinds: ['enrich', 'enrichMap', 'string'] },
  { label: 'Overlap', kinds: ['setCompare'] }
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
  'enrichMap',
  'setCompare',
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
export const PLOT_CONFIG_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>(
  ALL_OPS.filter((k) => !!NODE_SPECS[k].plot?.configurable)
)

export function categoryOf(op: NodeKind): NodeCategory {
  return NODE_SPECS[op].category
}
/** The plots whose run computes something of their own (graph/run/plotRun.ts): enrichment's term
 *  tests, STRING's network read and the cluster's embedding. Every other plot draws live from its
 *  upstream's result — its run only marks it ready, so there's nothing for a Re-run to redo. */
export const plotComputes = (kind: NodeKind): boolean => !!NODE_SPECS[kind].plot?.computes
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

/** Display label for a plotting tile. Like NODE_SPECS[kind].label, but a Response plot names the
 *  numeric conditions it's over (`dr`: its axis — "Dose response"; `tdr`: its pair — "Dose & Time
 *  response"), so the per-condition variants read distinctly wherever a tile is labelled — group
 *  subcards, the canvas group tile, and result panels. */
export function plotLabel(kind: NodeKind, config?: unknown): string {
  return NODE_SPECS[kind].plot?.variants?.label(config) ?? NODE_SPECS[kind].label
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
export type { PlotMenuEntry } from '../nodes/contract'
/** Fan one plotting kind out into its menu entries over the data's numeric conditions (`axes`, in
 *  order): `dr` → one per condition ("Dose response", "Time response", "Temp response"), `tdr` →
 *  one per pair, the earlier along x ("Dose & Time response", "Dose & Temp response", …); all else
 *  is 1:1. Each is its own tile, so several can be on view at once. */
export function plotEntriesFor(
  kind: NodeKind,
  axes: readonly ConditionKey[] = DEFAULT_AXES
): PlotMenuEntry[] {
  const variants = NODE_SPECS[kind].plot?.variants
  return variants ? variants.entries(kind, axes) : [{ kind, label: NODE_SPECS[kind].label }]
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
  const variants = NODE_SPECS[kind].plot?.variants
  return variants
    ? entryKey({ kind, label: variants.label(config), override: variants.override(config) })
    : kind
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
/** What a step's output wires as: the canonical producer of its data contract (a Merge's or a
 *  Subset's output is Clean data's — `abundance`); a plot (no output) is itself. */
export function outputKindOf(op: NodeKind): NodeKind {
  const out = NODE_SPECS[op].output
  return out ? CONTRACT_PRODUCER[out] : op
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
  const out = NODE_SPECS[source].output
  return out != null && NODE_SPECS[target].input.accepts.includes(out)
}
/** Nodes that accept TWO upstream inputs; every other node accepts one. `contrast` pools two
 *  comparisons; `compare` pools two datasets so conditions can be drawn from either (joined by
 *  uniqID — see combineStandardize). */
/** Nodes that accept several upstream inputs; every other node accepts one. Contrast can take
 *  any number (the selector picks the two datasets to contrast); Compare and Curve fit pool two. */
export function maxInputsFor(kind: NodeKind): number {
  return NODE_SPECS[kind].input.max ?? 1
}
/** True if any op accepts `op` as an input (i.e. the node can be a source). */
export function hasSourceHandle(op: NodeKind): boolean {
  return ALL_OPS.some((k) => canConnect(op, k))
}

/** The quick-access switches a kind starts with off, where it isn't simply on (its spec's
 *  `plot.quick`): a setting not listed is on. The user's own choice (`quick`) always wins. */
export const QUICK_DEFAULTS: Partial<Record<NodeKind, Record<string, boolean>>> =
  Object.fromEntries(
    ALL_OPS.flatMap((k) => (NODE_SPECS[k].plot?.quick ? [[k, NODE_SPECS[k].plot!.quick!]] : []))
  )
/** Whether a setting is surfaced in the tile as a quick-access switch bar: the user's choice, else
 *  the kind's default (QUICK_DEFAULTS), else on. */
export const quickOn = (
  cfg: { quick?: QuickAccess } | undefined,
  field: string,
  kind?: NodeKind
): boolean => cfg?.quick?.[field] ?? (kind ? QUICK_DEFAULTS[kind]?.[field] : undefined) ?? true
