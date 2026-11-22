import type { Edge } from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'
import type { FacetSource } from '../../../dashboard/FacetedPlot'
import {
  type CompareResultRow,
  type ConditionKey,
  type ContextRow,
  type ContrastResultRow,
  hasTermRows,
  holderWhere,
  presentScaleOf,
  rowsWhere,
  showKindOf,
  type ValueScale,
  type ValueUnit,
  valueUnitOf,
  withBatchCond
} from '../../../engine'
import { useGraph } from '../../../graph/store'
import {
  axisTitle,
  type CompareConfig,
  type FcPaletteConfig,
  isComparisonKind,
  isStep,
  type NodeResult,
  numericOfResult,
  type PlotChild,
  type PlotEffectColors,
  plotEffectColors,
  type StepNode
} from '../../../graph/types'
import { useCondUnits } from '../../../graph/useUpstreamFacts'
import {
  CATEGORICAL_SCHEMES,
  type PaletteRef,
  type PaletteRole,
  toCategoricalId,
  toPaletteRef
} from '../../../ui/palettes'
import type { StringLevel } from '../../../ui/stringModel'
import { useAppSettings } from '../../../ui/useAppSettings'
import { useSelection } from '../../../ui/useSelection'

/** Stable empties for props that are "nothing selected" — a fresh `[]` / `{}` per render would
 *  defeat every memo downstream (a new object is a new dependency, hence a full chart rebuild). */
export const NO_GENES: string[] = []
export const NO_IDS: ReadonlySet<string> = new Set()
export const NO_DOSE = { scale: 1 }
/** The Clean data step a plot reads, walking up from its input (through a Compare, a Contrast…):
 *  the nearest step upstream whose result is a Clean data one, or undefined. */
export function cleanDataUpstream(
  start: string,
  edges: Edge[],
  results: Record<string, NodeResult>
): string | undefined {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    if (results[id]?.kind === 'standardize') return id
    for (const e of edges) if (e.target === id) queue.push(e.source)
  }
  return undefined
}
/** The plot kinds that read a Compare's direction or group means — fed its rows without a two-way
 *  ANOVA's term rows (unsigned; see termless). */
export const SIGNED_KINDS: ReadonlySet<string> = new Set([
  'scatter',
  'ma',
  'dr',
  'bubble',
  'tdr',
  'enrich',
  'string'
])
/** A Compare's rows of one `show` kind (rowsOfKind) as a result of their own (holderWhere): the
 *  same result when it has only one kind. */
export function cmpOfKind<H extends { rows: readonly CompareResultRow[] }>(
  cmp: H,
  show?: string
): H {
  if (!hasTermRows(cmp)) return cmp
  const want = show === 'factors' ? 'factors' : 'overall'
  return holderWhere(cmp, `show¦${want}`, (c) => showKindOf(c) === want)
}
/** One term-free copy per Compare result, so memos keyed on the result hold across renders. */
export const termFree = new WeakMap<object, NodeResult>()
export function signedFor(kind: string, r: NodeResult | undefined): NodeResult | undefined {
  if (r?.kind !== 'compare' || !SIGNED_KINDS.has(kind) || !hasTermRows(r.cmp)) return r
  let out = termFree.get(r)
  if (!out) termFree.set(r, (out = { ...r, cmp: holderWhere(r.cmp, 'signed', (c) => !c.term) }))
  return out
}
/** PanelBody's props: the tile (or a group's subcard) and the results it reads. */
export type PanelBodyProps = {
  node: StepNode
  edges: Edge[]
  results: Record<string, NodeResult>
  /** when set, render this group subcard instead of the node's own output; `node` is the
   *  group tile, so its edge still supplies the shared upstream. */
  child?: PlotChild
  /** restrict the plot to the selected genes only, instead of all genes (see the tile's
   *  All/Selected toggle; only meaningful for SUBSET_TOGGLE_KINDS). */
  selectedOnly?: boolean
  /** force a specific facet tuple (batch export renders one facet per file); undefined =
   *  interactive tabs. */
  facetSel?: Record<string, string>
}
/** What every result body reads: the tile's kind and config, its upstream and results, the units,
 *  palettes, selection … — computed once per render here (the hooks live here, so the per-kind
 *  bodies, which run inside PanelBody, call none). */
export function usePlotContext({
  node,
  edges,
  results,
  child,
  selectedOnly = false,
  facetSel
}: PanelBodyProps) {
  // A subcard borrows the group's upstream (via node.id) but renders its own kind/config.
  const kind = child ? child.kind : node.data.kind
  const cfgSource = child ? child.config : node.data.config
  // In-plot switch bars (DR axis, cluster colour-by) write straight to the config; a group
  // subcard patches the matching child. Single source of truth, persisted.
  const patchConfig = (patch: Record<string, unknown>): void => {
    const s = useGraph.getState()
    if (child) s.updateChildConfig(node.id, child.id, patch)
    else s.updateConfig(node.id, patch)
  }
  const result = results[node.id]
  const upId = edges.find((e) => e.target === node.id)?.source
  // The plots that read a direction (DR, bubble, dose × time, enrichment, STRING) or per-group means
  // (MA, intensity scatter) see a Compare without a two-way ANOVA's unsigned term rows.
  const upstream = upId ? signedFor(kind, results[upId]) : undefined
  // The upstream dataset's numeric conditions — its schema (dose, time, any declared numeric):
  // ordered facets, right-aligned columns, response axes.
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
  // Only the UPSTREAM node is needed (its config: effect names, threshold fallback). Subscribing to
  // the whole node list would re-render every tile on any node change anywhere (a status tick,
  // a config edit, a canvas drag).
  const upNode = useGraph((s) => (upId ? s.nodes.find((n) => n.id === upId) : undefined))
  const upStep = upNode && isStep(upNode) ? upNode : undefined
  // The upstream Compare's config, for the effect colours its plots inherit.
  const upCompareCfg =
    upStep && isComparisonKind(upStep.data.kind) ? (upStep.data.config as CompareConfig) : undefined
  // The global fold-change palette; a plot with its own (cfg.fcPalette) draws on that instead.
  // Each palette role's global default (Settings → Customisation): what a plot draws when its own palette
  // is Automatic — its settings name the same, so the two always agree.
  const roles = useAppSettings((s) => s.palettes)
  // A plot's categorical palette: its own, else the global one.
  const globalCategorical = useAppSettings((s) => s.categorical)
  const categoricalOf = (c: unknown): readonly string[] =>
    CATEGORICAL_SCHEMES[
      toCategoricalId((c as { categorical?: unknown } | undefined)?.categorical) ??
        globalCategorical
    ]
  const responseRoles = useMemo(() => ({ value: roles.fc, points: roles.fcObject }), [roles])
  const paletteOf = (c: unknown, role: PaletteRole, field = 'fcPalette'): PaletteRef =>
    toPaletteRef((c as Record<string, unknown> | undefined)?.[field]) ?? roles[role]
  // A plot's effect colours: its own → its FC palette (its own, else the global one).
  const effectsOf = (c: unknown, own?: PlotEffectColors) =>
    plotEffectColors(own, roles.fcObject, (c as FcPaletteConfig | undefined)?.fcPalette)
  // The numeric conditions' units, from the import this plot's data came through (axis titles,
  // a curve fit's EC50) — the dose's, for a workflow saved before units moved to the import, the
  // unit its Curve fit carried (as curveDoseUnit reads it), so every axis titles it alike.
  const importUnits = useCondUnits(node.id)
  const legacyDose = upCompareCfg?.doseUnit
  const units = useMemo(
    () => (importUnits.dose || !legacyDose ? importUnits : { ...importUnits, dose: legacyDose }),
    [importUnits, legacyDose]
  )
  // A condition's legend heading with its unit — dose (nM), time (min) — for the condition
  // legends (QC, gene bar, cluster); one function per units, so the plots don't redraw for nothing.
  const condTitle = useCallback((c: ConditionKey): string => axisTitle(c, units), [units])
  // The scale every abundance plot shows Clean data on (see presentScaleOf): the one the Clean-data
  // result this plot reads carries — directly, or through a Compare / Contrast. Log₁₀ when there's
  // none.
  const cleanId = useMemo(
    () => (upId ? cleanDataUpstream(upId, edges, results) : undefined),
    [upId, edges, results]
  )
  const cleanResult = cleanId ? results[cleanId] : undefined
  // The rows a fold change's replicates are found on: a per-batch Compare's rows carry the batch,
  // so its replicates are matched on rows that do too (withBatchCond).
  const repStd =
    cleanResult?.kind === 'standardize'
      ? upCompareCfg?.splitBatch
        ? withBatchCond(cleanResult.std)
        : cleanResult.std
      : undefined
  const quantityScale: ValueScale =
    cleanResult?.kind === 'standardize' ? presentScaleOf(cleanResult.std) : 'log10'
  // …and what its values are: abundances, or fractions of a reference protein (valueUnitOf) —
  // the word every abundance axis and legend uses ("log fraction").
  const quantityUnit: ValueUnit =
    cleanResult?.kind === 'standardize' ? valueUnitOf(cleanResult.std) : 'abundance'
  /** A contrast as a faceted plot's source: its rows built a facet at a time (FacetSource), an
   *  abundance contrast's sides (stored as log₁₀) moved onto quantityScale (quantityOnScale) and
   *  fold-change contrasts as they are. */
  const contrastSource = (
    u: Extract<NodeResult, { kind: 'contrast' }>
  ): FacetSource<ContrastResultRow> => ({
    of: u.ctr,
    scale: u.ctr.valueKind === 'quantity' ? quantityScale : undefined
  })
  // The genes a plot emphasises / subsets to / draws per-gene: the linked gene selection (pins
  // from clicking in plots or the gene menu). Only the tiles that DRAW BY SELECTION subscribe —
  // the rest read a stable empty set, so a click doesn't re-render (and redraw) every tile: the
  // point plots take the selection straight from the store themselves, imperatively.
  const drawsSelection =
    selectedOnly ||
    kind === 'tdr' ||
    kind === 'geneBar' ||
    kind === 'dr' ||
    kind === 'response' ||
    kind === 'metrics' ||
    // a 2-way ANOVA's plots: the gene pager steps through the selection, and the variance plot's
    // detailed view draws it
    kind === 'variance' ||
    kind === 'interaction'
  const pinnedIds = useSelection((s) => (drawsSelection ? s.pinnedIds : NO_IDS))
  // STRING: the confidence levels at which the facet on show has any network (from StringView's
  // read; null until known, or with interactors on) — greys out the empty levels, resolves "auto".
  const [stringLevels, setStringLevels] = useState<Set<StringLevel> | null>(null)
  const genes = useMemo(() => (pinnedIds.size ? [...pinnedIds] : NO_GENES), [pinnedIds])
  const focus = selectedOnly ? genes : NO_GENES
  // Selected-only mode: a faceted plot is fed only the rows whose feature is selected — read off
  // the uniqID column, only those built — else the whole result to facet (FacetSource). Guarded
  // below so subset mode with nothing selected shows guidance, not an empty plot.
  const subSource = <T extends ContextRow & { uniqID: string }>(h: {
    rows: readonly T[]
  }): T[] | FacetSource<T> =>
    selectedOnly ? rowsWhere(h, 'uniqID', (v) => pinnedIds.has(v as string)) : { of: h }
  return {
    kind,
    node,
    edges,
    results,
    child,
    selectedOnly,
    facetSel,
    cfgSource,
    patchConfig,
    result,
    upId,
    upstream,
    numeric,
    upNode,
    upStep,
    upCompareCfg,
    roles,
    globalCategorical,
    categoricalOf,
    responseRoles,
    paletteOf,
    effectsOf,
    importUnits,
    legacyDose,
    units,
    condTitle,
    cleanId,
    cleanResult,
    repStd,
    quantityScale,
    quantityUnit,
    contrastSource,
    drawsSelection,
    pinnedIds,
    stringLevels,
    setStringLevels,
    genes,
    focus,
    subSource
  }
}
/** The context a kind's result body (nodes/<kind>/View.tsx) renders from. */
export type ViewContext = ReturnType<typeof usePlotContext> & {
  /** the plot's own run (graph/plotRun.ts), for a plot */
  plotRun: NodeResult | undefined
  /** the upstream's result as stored (before signedFor) */
  rawUp: NodeResult | undefined
}
