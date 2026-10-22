/**
 * Tile requirements beyond the upstream KIND (which `acceptsFrom`/`canConnect` already gate):
 * what the upstream DATA must carry for the tile to mean anything. One table drives three
 * consumers so they can't disagree:
 *   - creation lists (drop picker, Select plots menu) hide an entry whose requirement is unmet;
 *   - the canvas status dot is green only when the upstream has a result AND every requirement
 *     holds — flipping back to grey (with the reason) when a re-run stops satisfying it;
 *   - the results panel shows the same reason instead of an empty chart.
 * A requirement returns null when satisfied, else a short reason. Facts a requirement needs that
 * only exist after a run (annotations, species) count as satisfied while unknown — they can't be
 * ruled out before running; response axes always resolve (declared conditions), so they're enforced
 * even through a stale upstream (see axisAvailFor).
 */
import { firstRow } from '../engine/lazyRows'
import {
  condLabel,
  contextOf,
  enrichSourcesPresent,
  ENRICH_FALLBACK,
  ENRICH_SOURCE_LABEL,
  resolveEnrichSource,
  someNested,
  type ConditionKey
} from '../engine'
import {
  axisAvailFor,
  axisAvailFromResult,
  canConnect,
  DEFAULT_AXES,
  multiLevelAxes,
  plotEntriesFor,
  wiredKindOf,
  NODE_SPECS,
  type AxisAvail,
  type AxisGraph,
  type PlotMenuEntry
} from './registry'
import {
  isDataResult,
  isStep,
  type CompareConfig,
  type EnrichConfig,
  type GraphNode,
  type NodeKind,
  type NodeResult,
  type StringConfig,
  type TdrConfig,
  tdrPair
} from './types'

/** What is known about a tile's upstream: its kind, its result (if run), and the response axes. */
export interface UpstreamFacts {
  kind?: NodeKind
  result?: NodeResult
  axes: AxisAvail
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
/** No upstream wired: nothing can be ruled out. */
export const UNWIRED: UpstreamFacts = { axes: DEFAULT_AXES }

type Requirement = (u: UpstreamFacts, config: unknown) => string | null

const needAxis = (u: UpstreamFacts, axis: ConditionKey): string | null =>
  u.axes.includes(axis) ? null : `Needs a numeric ${condLabel(axis)} condition in the data`

/** The upstream's conditions with a series (two levels or more): unknown before it has run, so
 *  then every numeric condition it has (custom ones too), never blocking on a guess. */
const seriesIn = (u: UpstreamFacts): readonly ConditionKey[] =>
  u.result ? multiLevelAxes(u.result) : u.axes

/** Over one level there is no response to draw: a curve or a bubble row needs a series. */
const needSeries = (u: UpstreamFacts, axis: ConditionKey): string | null =>
  needAxis(u, axis) ??
  (seriesIn(u).includes(axis)
    ? null
    : `Only one ${condLabel(axis)} level here — needs at least two to show a response`)

/** The most common taxon among the fetched annotations (0 = none). */
export function dominantTaxon(ann: Record<string, Record<string, string>>): number {
  const tally = new Map<number, number>()
  for (const rec of Object.values(ann)) {
    const t = parseInt((rec.taxon ?? '').trim(), 10)
    if (Number.isFinite(t) && t > 0) tally.set(t, (tally.get(t) ?? 0) + 1)
  }
  let best = 0
  let bestN = 0
  for (const [t, n] of tally) if (n > bestN) [best, bestN] = [t, n]
  return best
}

// Which plots take a Curve fit is their `acceptsFrom` (a fitted curve has no per-dose rows or group
// means, so MA, Scatter, Bubble and Time & Dose-response don't; Potency and the residual plots take
// nothing else).
/** The residual plots are CurveCurator's QC of its 4PL fits. */
const CC_ONLY =
  'Needs the CurveCurator method’s curves — set the Curve fit’s model to 4PL, over dose or time'
/** Dose × time surfaces are drawn by the Response plot, not as single curves. */
const SURFACES =
  'A dose × time surface isn’t one curve — show it in a Dose & Time response plot (or fit curves over one axis)'

/** An ANOVA upstream: by its Compare's analysis when known (before it has run, too), else by its
 *  result (its rows carry their F-tests). */
const anova = (u: UpstreamFacts): boolean =>
  u.analysis != null
    ? u.analysis === 'anova'
    : u.result?.kind === 'compare' && someNested(u.result.cmp, 'ftest', 'F', (on) => on)
const NO_GROUP_MEANS =
  'An ANOVA has no two-group means to plot — show its results in a volcano, heatmap or table'
/** The factors plots read an ANOVA's model (its terms, per-gene shares and cell means). */
const needsAnova = (u: UpstreamFacts): string | null => {
  const known = u.analysis != null || u.result?.kind === 'compare'
  if (known && !anova(u) && !(u.result?.kind === 'compare' && u.result.cmp.anova))
    return 'Needs an ANOVA — set the Compare’s analysis to ANOVA'
  if (u.result?.kind === 'compare' && !u.result.cmp.anova && anova(u))
    return 'Re-run the Compare — its ANOVA ran before this plot existed'
  return null
}

const REQUIREMENTS: Partial<Record<NodeKind, Requirement>> = {
  ma: (u) => (anova(u) ? NO_GROUP_MEANS : null),
  scatter: (u) => (anova(u) ? NO_GROUP_MEANS : null),
  variance: needsAnova,
  interaction: needsAnova,
  dr: (u, cfg) => {
    if (u.surface) return SURFACES
    const axis = (cfg as { axis?: ConditionKey })?.axis ?? 'dose'
    // a Curve fit draws its own curves: over its axis only
    if (u.curve && u.curveAxis)
      return u.curveAxis === axis
        ? null
        : `The Curve fit runs over ${condLabel(u.curveAxis)} — add its ${condLabel(u.curveAxis)} response instead`
    // A curve fit's rows are whole curves over the axis (no per-level rows), each naming it.
    if (
      u.result?.kind === 'compare' &&
      contextOf(u.result.cmp).rows.some((c) => c.along === axis)
    )
      return null
    return needSeries(u, axis)
  },
  curveMad: (u) => (u.detection === 'spline' || u.surface ? CC_ONLY : null),
  response: (u, cfg) => {
    const want = (cfg as { pair?: [ConditionKey, ConditionKey] })?.pair ?? ['dose', 'time']
    const name = `${condLabel(want[0])} × ${condLabel(want[1])}`
    if (!u.surface) return `Needs ${name} surfaces — a Curve fit over ${name}`
    const has = u.surfacePair ?? ['dose', 'time']
    return has[0] === want[0] && has[1] === want[1]
      ? null
      : `The Curve fit runs over ${condLabel(has[0])} × ${condLabel(has[1])}, not ${name}`
  },
  tdr: (u, cfg) => {
    const [a, b] = tdrPair(cfg as TdrConfig | undefined)
    if (!u.axes.includes(a) || !u.axes.includes(b))
      return `Needs both ${condLabel(a)} and ${condLabel(b)} as numeric conditions in the data`
    return needSeries(u, a) ?? needSeries(u, b)
  },
  // The plot draws over any condition with a series, its saved axis only when that's one of them
  // (seriesAxes): so any such condition will do, whichever axis it was saved with.
  bubble: (u) => {
    if (!u.axes.length) return 'Needs a numeric condition in the data'
    return seriesIn(u).some((c) => u.axes.includes(c))
      ? null
      : 'Only one level of each condition here — needs at least two to show a response'
  },
  // Met by ANY term set the genes carry, not just the saved one: the plot falls back through
  // ENRICH_FALLBACK to one they have (resolveEnrichSource), so only no annotations at all blocks it.
  enrich: (u, cfg) => {
    if (u.result?.kind !== 'compare') return null // unknown until run
    const present = enrichSourcesPresent(u.result.annotationMap ?? {}, u.result.keggCategories)
    if (resolveEnrichSource((cfg as EnrichConfig)?.source, present)) return null
    const names = ENRICH_FALLBACK.map((s) => ENRICH_SOURCE_LABEL[s]).join(', ')
    return `No enrichment annotations on these genes (${names}) — fetch them in the interactive import (Metadata step), then re-run Clean data and the Compare / Curve fit.`
  },
  string: (u, cfg) => {
    if (u.result?.kind !== 'compare') return null
    const species = (cfg as StringConfig)?.species
    if (species && species > 0) return null
    return dominantTaxon(u.result.annotationMap ?? {}) > 0
      ? null
      : 'No species detected — fetch annotations in the interactive import (Metadata step), which reads the organism, then re-run Standardize and the Compare / Curve fit.'
  }
}

/** Why `kind` (with `config`) can't be fed by this upstream — null when it can. Kind mismatch
 *  first (a stale wiring from an older project), then the data requirement. */
export function unmetRequirement(kind: NodeKind, config: unknown, u: UpstreamFacts): string | null {
  if (u.kind && !canConnect(u.kind, kind)) {
    const ok = NODE_SPECS[kind].acceptsFrom.map((k) => NODE_SPECS[k].label).join(' or ')
    return `Needs a ${ok} upstream`
  }
  return REQUIREMENTS[kind]?.(u, config) ?? null
}

/** Resolve the facts for a plot fed by `upstreamId` (stale-aware for the axes). */
export function upstreamFacts(g: AxisGraph, upstreamId: string | undefined): UpstreamFacts {
  if (!upstreamId) return UNWIRED
  const n = g.nodes.find((x) => x.id === upstreamId)
  const curve = isCurveFit(n)
  const cfg = curve && n && isStep(n) ? (n.data.config as CompareConfig) : undefined
  const spline = cfg?.detection === 'spline'
  const analysis =
    n && isStep(n) && n.data.kind === 'compare'
      ? (n.data.config as CompareConfig).analysis
      : undefined
  return {
    // as wired: a Subset off Load data is still Load data (wiredKindOf)
    kind: n && isStep(n) ? wiredKindOf(g, upstreamId) : undefined,
    result: g.results[upstreamId],
    axes: axisAvailFor(g, upstreamId),
    curve,
    ...(cfg
      ? {
          detection: spline ? 'spline' : '4pl',
          surface: !!cfg.surface,
          ...(cfg.surface && cfg.surfacePair ? { surfacePair: cfg.surfacePair } : null),
          ...(cfg.surface ? null : { curveAxis: curveAxisOf(g.results[upstreamId], cfg) })
        }
      : null),
    ...(analysis ? { analysis } : null)
  }
}

/** Facts from a result alone (no graph walk) — for the results panel, where the result is in hand. */
export function factsOf(result: NodeResult | undefined): UpstreamFacts {
  // A curve fit's rows all carry their curve, so the first row tells; its result is a comparison
  // table like a Compare's, but it came from a Curve fit tile.
  const first = result?.kind === 'compare' ? firstRow(result.cmp) : undefined
  const curve = first?.curve != null || first?.rs != null
  return {
    kind: curve ? 'curveFit' : isDataResult(result) ? result.kind : undefined,
    result,
    axes: axisAvailFromResult(result),
    curve,
    ...(first?.rs
      ? {
          detection: first.rs.detector === '4pl' ? ('4pl' as const) : ('spline' as const),
          surface: first.rs.axis === 'surface',
          ...(first.rs.pair ? { surfacePair: first.rs.pair } : null)
        }
      : null),
    ...(curve && first && (first.curve?.axis ?? first.rs?.axis) !== 'surface'
      ? {
          curveAxis: (first.curve?.axis ?? first.rs?.axis) as ConditionKey
        }
      : null)
  }
}

/** A one-axis Curve fit's axis: its result's curves' (what was run), else its config's. */
export function curveAxisOf(
  result: NodeResult | undefined,
  cfg: Pick<CompareConfig, 'curveAxis'>
): ConditionKey {
  const first = result?.kind === 'compare' ? firstRow(result.cmp) : undefined
  const ran = first?.curve?.axis ?? first?.rs?.axis
  return ran && ran !== 'surface' ? ran : (cfg.curveAxis ?? 'dose')
}

/** Whether a node is a Curve fit (by its kind, so known before it has run). */
export function isCurveFit(n: GraphNode | undefined): boolean {
  return !!n && isStep(n) && n.data.kind === 'curveFit'
}

/** A plotting kind's menu entries for this upstream: the Response plots over its numeric
 *  conditions (plotEntriesFor) — a Curve fit's surface plot over the pair it fits (its rows carry
 *  no levels to read one from), dose × time while that's unknown. */
export function entriesFor(kind: NodeKind, u: UpstreamFacts): PlotMenuEntry[] {
  if (kind === 'response') return plotEntriesFor('response', u.surfacePair ?? DEFAULT_AXES)
  // a Curve fit's curves are over its one axis (its rows hold no levels of it to read)
  if (kind === 'dr' && u.curve && !u.surface && u.curveAxis)
    return plotEntriesFor('dr', [u.curveAxis])
  return plotEntriesFor(kind, u.axes)
}

/** Drop plot-menu entries whose requirement the upstream can't meet (each entry checked with its
 *  kind's default config plus its override, e.g. dr's axis). */
export function gatePlotEntries(entries: PlotMenuEntry[], u: UpstreamFacts): PlotMenuEntry[] {
  return entries.filter(
    (e) =>
      unmetRequirement(e.kind, { ...NODE_SPECS[e.kind].defaultConfig(), ...e.override }, u) == null
  )
}
