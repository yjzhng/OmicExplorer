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
import {
  enrichSourcesPresent,
  ENRICH_FALLBACK,
  ENRICH_SOURCE_LABEL,
  resolveEnrichSource
} from '../engine'
import {
  axisAvailFor,
  axisAvailFromResult,
  canConnect,
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
  type StringConfig
} from './types'

/** What is known about a tile's upstream: its kind, its result (if run), and the response axes. */
export interface UpstreamFacts {
  kind?: NodeKind
  result?: NodeResult
  axes: AxisAvail
  /** the upstream is a Curve fit: one fitted curve per gene, no group means and no per-dose rows */
  curve?: boolean
  /** a Curve fit's method: 'spline' = the response surface method (no CurveCurator 4PL / decoys),
   *  and whether it fits dose × time surfaces (one row per gene × compound, no single axis) */
  detection?: '4pl' | 'spline'
  surface?: boolean
}
/** No upstream wired: nothing can be ruled out. */
export const UNWIRED: UpstreamFacts = { axes: { dose: true, time: true } }

type Requirement = (u: UpstreamFacts, config: unknown) => string | null

const needAxis = (u: UpstreamFacts, axis: 'dose' | 'time'): string | null =>
  u.axes[axis] ? null : `Needs a ${axis} condition in the data`

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

const REQUIREMENTS: Partial<Record<NodeKind, Requirement>> = {
  dr: (u, cfg) => {
    if (u.surface) return SURFACES
    const axis = (cfg as { axis?: 'dose' | 'time' })?.axis === 'time' ? 'time' : 'dose'
    // A curve fit's rows are whole curves over the axis (no per-level rows), each naming it.
    if (
      u.result?.kind === 'compare' &&
      u.result.cmp.rows.some((r) => (r.curve?.axis ?? r.rs?.axis) === axis)
    )
      return null
    return needAxis(u, axis)
  },
  curveMad: (u) => (u.detection === 'spline' || u.surface ? CC_ONLY : null),
  response: (u) => (u.surface ? null : 'Needs dose × time surfaces — a Curve fit over dose × time'),
  tdr: (u) =>
    u.axes.dose && u.axes.time ? null : 'Needs both dose and time conditions in the data',
  bubble: (u) => (u.axes.dose || u.axes.time ? null : 'Needs a dose or time condition in the data'),
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
  return {
    kind: n && isStep(n) ? n.data.kind : undefined,
    result: g.results[upstreamId],
    axes: axisAvailFor(g, upstreamId),
    curve,
    ...(cfg ? { detection: spline ? 'spline' : '4pl', surface: !!cfg.surface } : null)
  }
}

/** Facts from a result alone (no graph walk) — for the results panel, where the result is in hand. */
export function factsOf(result: NodeResult | undefined): UpstreamFacts {
  // A curve fit's rows all carry their curve, so the first row tells; its result is a comparison
  // table like a Compare's, but it came from a Curve fit tile.
  const first = result?.kind === 'compare' ? result.cmp.rows[0] : undefined
  const curve = first?.curve != null || first?.rs != null
  return {
    kind: curve ? 'curveFit' : isDataResult(result) ? result.kind : undefined,
    result,
    axes: axisAvailFromResult(result),
    curve,
    ...(first?.rs
      ? {
          detection: first.rs.detector === '4pl' ? ('4pl' as const) : ('spline' as const),
          surface: first.rs.axis === 'surface'
        }
      : null)
  }
}

/** Whether a node is a Curve fit (by its kind, so known before it has run). */
export function isCurveFit(n: GraphNode | undefined): boolean {
  return !!n && isStep(n) && n.data.kind === 'curveFit'
}

/** Drop plot-menu entries whose requirement the upstream can't meet (each entry checked with its
 *  kind's default config plus its override, e.g. dr's axis). */
export function gatePlotEntries(entries: PlotMenuEntry[], u: UpstreamFacts): PlotMenuEntry[] {
  return entries.filter(
    (e) =>
      unmetRequirement(e.kind, { ...NODE_SPECS[e.kind].defaultConfig(), ...e.override }, u) == null
  )
}
