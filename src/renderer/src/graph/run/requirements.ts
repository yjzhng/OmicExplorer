/**
 * Tile requirements beyond the upstream KIND (which the data contracts — `canConnect` — already gate):
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
import { type ConditionKey } from '../../engine'
import { firstRow } from '../../engine/columns/lazyRows'
import type { UpstreamFacts } from '../../nodes/contract'
import { axisAvailFromResult, DEFAULT_AXES } from '../models/axisAvail'
import {
  acceptsFromOf,
  axisAvailFor,
  canConnect,
  NODE_SPECS,
  plotEntriesFor,
  wiredKindOf,
  type AxisGraph,
  type PlotMenuEntry
} from '../registry'
import { type GraphNode, isDataResult, isStep, type NodeKind, type NodeResult } from '../types'
import type { CompareConfig } from '../config/compare'

export type { UpstreamFacts } from '../../nodes/contract'

/** No upstream wired: nothing can be ruled out. */
export const UNWIRED: UpstreamFacts = { axes: DEFAULT_AXES }

/** Why `kind` (with `config`) can't be fed by this upstream — null when it can. Kind mismatch
 *  first (a stale wiring from an older project), then the data requirement. */
export function unmetRequirement(kind: NodeKind, config: unknown, u: UpstreamFacts): string | null {
  if (u.kind && !canConnect(u.kind, kind)) {
    const ok = acceptsFromOf(kind)
      .map((k) => NODE_SPECS[k].label)
      .join(' or ')
    return `Needs a ${ok} upstream`
  }
  return NODE_SPECS[kind].requirement?.(u, config) ?? null
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
