/** Facet fan-out for batch export. A faceted plot (volcano/MA/DR/bubble/dumbbell/scatter)
 *  shows one context tuple at a time via tabs; export writes one file per tuple. This
 *  enumerates those tuples using the same engine helpers FacetedPlot uses, and turns the
 *  export into a flat list of render jobs (spec × facet × all/GOI). No React imports. */
import type { Edge } from '@xyflow/react'

import { facetCompareRows, facetContextDims } from '../engine'
import type { ConditionKey, ContextRow } from '../engine'
import type { NodeKind, NodeResult } from '../graph/types'
import type { ExportSpec } from './specs'

/** Plot kinds wrapped in FacetedPlot (draw per context tuple); others render once. */
const FACETED_KINDS = new Set<NodeKind>(['volcano', 'ma', 'dr', 'bubble', 'dumbbell', 'scatter'])

export interface FacetView {
  /** forced FacetedPlot selection for this tuple ({} = the single, unfaceted view) */
  sel: Record<string, string>
  /** filename component identifying the facet (e.g. "strain-WT_dose-2.5"); '' when single */
  suffix: string
}

const SINGLE: FacetView[] = [{ sel: {}, suffix: '' }]

/** The facet tuples a plot spec expands into. Non-faceted plots (or ones with no context
 *  dims / a single tuple) return a single unlabelled view. */
export function facetViews(
  kind: NodeKind,
  config: unknown,
  upstream: NodeResult | undefined
): FacetView[] {
  if (!FACETED_KINDS.has(kind) || !upstream) return SINGLE
  const rows: ContextRow[] | null =
    upstream.kind === 'compare'
      ? upstream.cmp.rows
      : upstream.kind === 'contrast'
        ? upstream.ctr.rows
        : null
  if (!rows) return SINGLE
  // DR/bubble consume one condition as their axis, so it isn't a facet dimension.
  const exclude =
    kind === 'dr' || kind === 'bubble' ? [(config as { axis: ConditionKey }).axis] : undefined
  const dims = facetContextDims(rows, exclude)
  if (dims.length === 0) return SINGLE
  const groups = facetCompareRows(rows, dims)
  if (groups.length <= 1) return SINGLE
  return groups.map((g) => {
    const sel: Record<string, string> = {}
    const parts: string[] = []
    for (const { dim, value } of g.values) {
      sel[dim] = String(value)
      parts.push(`${dim}-${value}`)
    }
    return { sel, suffix: parts.join('_') }
  })
}

/** One rasterise job: a spec rendered at a specific facet, all-genes or GOI-subset. */
export interface PlotJob {
  spec: ExportSpec
  goiOnly: boolean
  facetSel: Record<string, string>
  suffix: string
}

/**
 * Flatten specs into render jobs: one per (facet tuple) × (all-genes, and a GOI-subset
 * variant when the plot has focus genes). This is the single source of truth for both the
 * exported files and the modal's file count.
 */
export function planPlotJobs(
  specs: ExportSpec[],
  edges: Edge[],
  results: Record<string, NodeResult>
): PlotJob[] {
  const jobs: PlotJob[] = []
  for (const spec of specs) {
    const upId = edges.find((e) => e.target === spec.node.id)?.source
    const upstream = upId ? results[upId] : undefined
    const kind = spec.child ? spec.child.kind : spec.node.data.kind
    const config = spec.child ? spec.child.config : spec.node.data.config
    for (const view of facetViews(kind, config, upstream)) {
      jobs.push({ spec, goiOnly: false, facetSel: view.sel, suffix: view.suffix })
      if (spec.hasGoi) jobs.push({ spec, goiOnly: true, facetSel: view.sel, suffix: view.suffix })
    }
  }
  return jobs
}
