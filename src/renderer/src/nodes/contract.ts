/**
 * The node contract: what every kind of step or plot declares about itself.
 *
 * Each kind lives in its own folder under `nodes/` (nodes/volcano/, nodes/compare/ …):
 *
 *  - `spec.ts`     — this contract: its label and category, the DATA it takes and gives (below), its
 *                    default config, when a config change makes its result stale, what its upstream
 *                    must carry (`requirement`), and for a plot its tile/menu facts;
 *  - `Settings.tsx` — its settings panel (registered in nodes/settings.ts);
 *  - `View.tsx`    — its results body (registered in nodes/views.ts);
 *  - `run.ts`      — how it computes (registered in nodes/runs.ts), where it has a run of its own.
 *
 * The shared code (canvas, settings window, results page, store) looks a kind up in these
 * registries instead of branching on it. Each registry is a `Record<NodeKind, …>`, so a kind added
 * to `NodeKind` without an entry fails the type check rather than failing silently at run time.
 *
 * ## Data contracts
 *
 * A node declares the TYPE of data it consumes and produces, not which other kinds it can follow:
 *
 * | contract     | what it is                                                | produced by                |
 * |--------------|-----------------------------------------------------------|----------------------------|
 * | `import`     | a configured import, not yet cleaned (no result of its own) | Load data (and a Subset off it) |
 * | `abundance`  | samples × features, with the samples' conditions           | Clean data, Merge, Subset  |
 * | `comparison` | per feature × comparison × context: effect, p, q, call     | Compare                    |
 * | `curves`     | a comparison table whose rows are fitted curves            | Curve fit                  |
 * | `contrast`   | per feature × context: FC1, FC2, the divergence call       | Contrast                   |
 *
 * An edge is allowed when the source's `output` is one of the target's `input.accepts`; what the
 * data must ALSO carry (a numeric axis, an ANOVA's terms, annotations) is the target's
 * `requirement`, checked against the upstream's facts (`UpstreamFacts`).
 */
import type { ConditionKey } from '../engine'
import type {
  CompareConfig,
  NodeCategory,
  NodeConfig,
  NodeConfigMap,
  NodeKind,
  NodeResult
} from '../graph/types'

/** The kinds of data that flow along an edge (see the table above). */
export type DataContract = 'import' | 'abundance' | 'comparison' | 'curves' | 'contrast'

/** The result a node of each contract hands downstream (`import` has none: Clean data reads the
 *  Load step's configured files). */
export interface ContractData {
  import: never
  abundance: Extract<NodeResult, { kind: 'standardize' }>
  comparison: Extract<NodeResult, { kind: 'compare' }>
  curves: Extract<NodeResult, { kind: 'compare' }>
  contrast: Extract<NodeResult, { kind: 'contrast' }>
}

/** The kind that canonically produces each contract — what a message names ("Needs a Compare or
 *  Curve fit upstream") and what `outputKindOf` returns for a step (a Merge's output wires as Clean
 *  data). */
export const CONTRACT_PRODUCER: Record<DataContract, NodeKind> = {
  import: 'load',
  abundance: 'standardize',
  comparison: 'compare',
  curves: 'curveFit',
  contrast: 'contrast'
}

/** What is known about a tile's upstream: its kind, its result (if run), and the response axes. */
export interface UpstreamFacts {
  kind?: NodeKind
  result?: NodeResult
  axes: ConditionKey[]
  /** the upstream is a Curve fit: one fitted curve per gene, no group means and no per-dose rows */
  curve?: boolean
  /** a Curve fit's method: 'spline' = the response surface method (no CurveCurator 4PL / decoys),
   *  and whether it fits surfaces (one row per gene × compound, no single axis) — over which pair */
  detection?: '4pl' | 'spline'
  surface?: boolean
  surfacePair?: [ConditionKey, ConditionKey]
  /** a Curve fit over one axis: that axis (its curves' — the rows carry no level of it) */
  curveAxis?: ConditionKey
  /** a Compare's analysis, from its config — so an ANOVA's plot list is right before it has
   *  run (or after its analysis changed, before the re-run) */
  analysis?: CompareConfig['analysis']
}

/** One selectable entry in a plot picker (see graph/registry.ts plotEntriesFor). */
export interface PlotMenuEntry {
  kind: NodeKind
  label: string
  override?: Record<string, unknown>
}

/** A plot that comes in variants by its config (the Response plots: one per numeric condition, or
 *  per pair of them) — how it is labelled, offered and recognised. */
export interface PlotVariants {
  /** the tile's label for this config ("Dose response") */
  label(config: unknown): string
  /** its menu entries over the data's numeric conditions */
  entries(kind: NodeKind, axes: readonly ConditionKey[]): PlotMenuEntry[]
  /** the override a tile with this config answers to (its entry key) */
  override(config: unknown): Record<string, unknown>
}

/** A plot's facts beyond the data contract. */
export interface PlotFacts {
  /** its settings window has a panel (the Results tile shows its gear) */
  configurable?: boolean
  /** it takes the plot-wide legend switch: the Legend section (every plot with a legend).
   *  'groups': a point plot, whose groups' own entries are switched in its Points section */
  legend?: boolean | 'groups'
  /** it takes the shared Axes section (a Plotly plot with axes) */
  axes?: boolean
  /** its run computes something of its own (enrichment's tests, STRING's network, the cluster's
   *  embedding); every other plot draws live from its upstream, its run only marking it ready */
  computes?: boolean
  /** the quick-access switches it starts with off (a setting not listed starts on) */
  quick?: Record<string, boolean>
  /** a plot offered in variants by config (Response plots) */
  variants?: PlotVariants
  /** the canvas tile's one-line description (default: "Genes × samples. Select to view.") */
  tileHint?: string | ((config: unknown) => string)
}

export interface NodeSpec<K extends NodeKind = NodeKind> {
  kind: K
  label: string
  /** one-line gloss shown under the label in the new-step picker */
  subtitle?: string
  category: NodeCategory
  /** the data it reads; `max` inputs (default 1 — Contrast and Merge take any number, Compare and
   *  Curve fit two) */
  input: { accepts: readonly DataContract[]; max?: number }
  /** the data it hands downstream; null for a plot (a sink) */
  output: DataContract | null
  /** whether the op has a Run action: a step computes its data; a plot computes what it needs to
   *  be viewed (graph/plotRun.ts) — green on the canvas then means ready to view */
  hasRun: boolean
  /** a runnable op's config change: whether it makes the result stale (it must run again). Unset =
   *  every change does (the steps). Plots never do unless they say so (defineSpec) — their view
   *  settings never do, only a setting outside what the run computed. */
  staleOn?: (next: NodeConfig, prev: NodeConfig, result: NodeResult | undefined) => boolean
  defaultConfig: () => NodeConfigMap[K]
  /** what the upstream DATA must carry for the tile to mean anything, beyond its contract: null
   *  when met, else the reason (see graph/requirements.ts) */
  requirement?(u: UpstreamFacts, config: unknown): string | null
  /** a plot's facts (plots only) */
  plot?: PlotFacts
}

/** Declare a kind's spec. A plot's settings never make its result stale unless it says so (a
 *  plot's run covers every setting its tile offers — see graph/plotRun.ts). */
export function defineSpec<K extends NodeKind>(spec: NodeSpec<K>): NodeSpec<K> {
  if (spec.category === 'plotting' && !spec.staleOn) spec.staleOn = () => false
  return spec
}
