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
import { enrichTermsOf } from '../engine'
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
  isStep,
  type EnrichConfig,
  type NodeKind,
  type NodeResult,
  type StringConfig
} from './types'

/** What is known about a tile's upstream: its kind, its result (if run), and the response axes. */
export interface UpstreamFacts {
  kind?: NodeKind
  result?: NodeResult
  axes: AxisAvail
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

const REQUIREMENTS: Partial<Record<NodeKind, Requirement>> = {
  dr: (u, cfg) =>
    needAxis(u, (cfg as { axis?: 'dose' | 'time' })?.axis === 'time' ? 'time' : 'dose'),
  tdr: (u) =>
    u.axes.dose && u.axes.time ? null : 'Needs both dose and time conditions in the data',
  bubble: (u) => (u.axes.dose || u.axes.time ? null : 'Needs a dose or time condition in the data'),
  enrich: (u, cfg) => {
    if (u.result?.kind !== 'compare') return null // unknown until run
    const source = (cfg as EnrichConfig)?.source ?? 'go'
    const ann = u.result.annotationMap ?? {}
    const has = Object.keys(ann).some((uid) => enrichTermsOf(ann, source, uid).length > 0)
    return has
      ? null
      : `No ${source === 'go' ? 'GO' : 'KEGG'} annotations on these genes — fetch them in the interactive import (Metadata step), then re-run Standardize and Compare.`
  },
  string: (u, cfg) => {
    if (u.result?.kind !== 'compare') return null
    const species = (cfg as StringConfig)?.species
    if (species && species > 0) return null
    return dominantTaxon(u.result.annotationMap ?? {}) > 0
      ? null
      : 'No species detected — fetch annotations in the interactive import (Metadata step), which reads the organism, then re-run Standardize and Compare.'
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
  return {
    kind: n && isStep(n) ? n.data.kind : undefined,
    result: g.results[upstreamId],
    axes: axisAvailFor(g, upstreamId)
  }
}

/** Facts from a result alone (no graph walk) — for the results panel, where the result is in hand. */
export function factsOf(result: NodeResult | undefined): UpstreamFacts {
  return { kind: result?.kind, result, axes: axisAvailFromResult(result) }
}

/** Drop plot-menu entries whose requirement the upstream can't meet (each entry checked with its
 *  kind's default config plus its override, e.g. dr's axis). */
export function gatePlotEntries(entries: PlotMenuEntry[], u: UpstreamFacts): PlotMenuEntry[] {
  return entries.filter(
    (e) =>
      unmetRequirement(e.kind, { ...NODE_SPECS[e.kind].defaultConfig(), ...e.override }, u) == null
  )
}
