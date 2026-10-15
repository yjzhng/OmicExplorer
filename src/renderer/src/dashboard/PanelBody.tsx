/** Renders a single tile's output (table or plot) for the results dashboard.
 *  Salvaged from the retired OutputDock's OutputBody: the per-kind dispatch and
 *  the comparison/contrast column builders live here now. */
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import {
  buildDR,
  DEFAULT_THRESHOLD,
  buildMA,
  comparisonOf,
  fcMeasure,
  buildScatter,
  buildIntensityScatter,
  buildVolcano,
  enrichSourcesPresent,
  resolveEnrichSource,
  ENRICH_SOURCE_LABEL,
  type EnrichSource,
  type CompareResultRow,
  type ClusterColorBy,
  type AxisTail,
  contrastStatDrag,
  type ConditionKey,
  type ContrastResultRow,
  type QcMetric,
  type StandardizeResult,
  CLUSTER_COLOR,
  condLabel,
  condPresent,
  condsIn,
  condValue,
  ctxValue,
  customCond,
  isCustomCond,
  isNumericCond,
  VALID_CONDITIONS,
  presentStd,
  presentScaleOf,
  plotScaleOf,
  abundanceLabel,
  abundanceOnScale,
  contrastFeatureLabel,
  rowsOfFeature,
  rowsOfFeatureNamed,
  type ValueScale,
  type ThresholdConfig,
  curveGroupKey,
  curveCuratorWall,
  curvesReplicated,
  RESIDUAL_DOT_CAP,
  curveMetrics,
  curveHasLof,
  ccTestOf,
  responseMetrics,
  DUMBBELL_ORDERS,
  dumbbellOrderLabel
} from '../engine'
import { BubbleView } from '../ui/BubbleView'
import { EnrichView } from '../ui/EnrichView'
import { StringView } from '../ui/StringView'
import { DataTableView, fixed, type Column, type HeaderLine } from '../ui/DataTableView'
import { autoStringLevel, stringCapOptions, type StringLevel } from '../ui/stringModel'
import { DRView } from '../ui/DRView'
import { DRFocusView } from '../ui/DRFocusView'
import { DumbbellView } from '../ui/DumbbellView'
import { ResponseCompareView } from '../ui/ResponseCompareView'
import { MAView } from '../ui/MAView'
import { PotencyView } from '../ui/PotencyView'
import { ResponseSurfaceView } from '../ui/ResponseSurfaceView'
import { CurveMadView } from '../ui/CurveMadView'
import { ClusterTile } from './ClusterTile'
import { CorrTile } from './CorrTile'
import { QcTile } from './QcTile'
import { SUBSET_TOGGLE_KINDS } from './subset'
import { GeneBarTile } from './GeneBarTile'
import { GeneSwitch } from './GeneSwitch'
import { ScatterView } from '../ui/ScatterView'
import { SwitchBar, SwitchStrip, SwitchBarToggle } from './SwitchBar'
import { TdrBody } from './TdrTile'
import { divergeStyle, heatStyle, valueRange } from '../ui/colormap'
import {
  CATEGORICAL_SCHEMES,
  ROLE_DEFAULTS,
  toCategoricalId,
  toPaletteRef,
  BUBBLE_SIG_PALETTE,
  type PaletteRef,
  type PaletteRole
} from '../ui/palettes'
import { useAppSettings, useRolePalette } from '../ui/useAppSettings'
import { UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { VolcanoView } from '../ui/VolcanoView'
import { FacetedPlot } from './FacetedPlot'
import { HeatmapTile } from './HeatmapTile'
import { FcHeatmapTile } from './FcHeatmapTile'
import { categoryOf } from '../graph/registry'
import { dominantTaxon, factsOf, unmetRequirement } from '../graph/requirements'
import { useGraph } from '../graph/store'
import { useCondUnits } from '../graph/useUpstreamFacts'
import { StatusIcon } from '../ui/StatusNote'
import {
  isStep,
  type BarConfig,
  type BubbleConfig,
  type CompareConfig,
  axisTitle,
  curveDoseUnit,
  effectLabelsOf,
  plotEffectColors,
  type FcPaletteConfig,
  type PlotEffectColors,
  isComparisonKind,
  normalizeCompareConfig,
  type EffectLabels,
  type DRConfig,
  type DumbbellConfig,
  type EnrichConfig,
  type StringConfig,
  type HeatmapConfig,
  heatmapCapOn,
  drLook,
  DR_DETAIL_CAP,
  clusterStyle,
  drYScale,
  qcColorConds,
  heatmapCondBar,
  DENDRO_CLADES_DEFAULT,
  HEATMAP_LINKAGES,
  HEATMAP_LEAF_ORDERS,
  type ContrastConfig,
  primaryColorLevels,
  SAMPLE_ORDERS,
  sampleOrderOf,
  clusterTwoConds,
  plotResultKey,
  geneCapOn,
  labelCapOn,
  type LoadConfig,
  type MAConfig,
  type NodeResult,
  type PotencyConfig,
  type ResponseConfig,
  type TdrConfig,
  responseDim,
  responseLook,
  responseShow,
  responseShowWhy,
  type CurveMadConfig,
  clusterLook,
  type ClusterConfig,
  type CorrConfig,
  type PlotChild,
  type QcConfig,
  quickOn,
  type ScatterConfig,
  type StandardizeConfig,
  type StepNode,
  type StepStatus,
  TABLE_GENE_MAX,
  type TableConfig,
  type VolcanoConfig
} from '../graph/types'

/** The fold-change heatmap's linkage and leaf-order choices, as switch-bar options. */
const HEATMAP_LINKAGE_KEYS = Object.keys(HEATMAP_LINKAGES)
const HEATMAP_LEAF_ORDER_KEYS = Object.keys(HEATMAP_LEAF_ORDERS)

type StdRow = StandardizeResult['rows'][number]

/** Stable empties for props that are "nothing selected" — a fresh `[]` / `{}` per render would
 *  defeat every memo downstream (a new object is a new dependency, hence a full chart rebuild). */
const NO_GENES: string[] = []
const NO_IDS: ReadonlySet<string> = new Set()
const NO_CATS: Record<string, string> = {}
const NO_DOSE = { scale: 1 }

/** The Clean data step a plot reads, walking up from its input (through a Compare, a Contrast…):
 *  the nearest step upstream whose result is a Clean data one, or undefined. */
function cleanDataUpstream(
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

/** The value range every gene's surface spans in a facet (its level means), padded — the curve-fit
 *  Response plot's global scale. Cached per Compare result (`all`, its whole row table) and facet,
 *  so the same range object comes back each render and the plot doesn't redraw for it. */
const surfaceRanges = new WeakMap<CompareResultRow[], Map<string, [number, number] | undefined>>()
function surfaceValueRange(
  all: CompareResultRow[],
  facetKey: string,
  rows: CompareResultRow[]
): [number, number] | undefined {
  let byFacet = surfaceRanges.get(all)
  if (!byFacet) surfaceRanges.set(all, (byFacet = new Map()))
  if (byFacet.has(facetKey)) return byFacet.get(facetKey)
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows)
    for (const c of r.rs?.cells ?? [])
      if (Number.isFinite(c.y)) {
        if (c.y < lo) lo = c.y
        if (c.y > hi) hi = c.y
      }
  // padded more than the measured plot's: a description's curve can run a little past its means
  const pad = (hi - lo) * 0.08 || 0.1
  const range: [number, number] | undefined = lo <= hi ? [lo - pad, hi + pad] : undefined
  byFacet.set(facetKey, range)
  return range
}

/** Memoizes a plot-data build inside a FacetedPlot render prop. The render prop runs on every
 *  PanelBody render (a pin click, a status tick anywhere), and an inline `buildX(rows, …)` there
 *  hands the view a FRESH data object each time — which is a full Plotly redraw of the chart, on
 *  every tile, hidden tabs included. `deps` are the build's actual inputs. */
function Built<T>({
  build,
  deps,
  children
}: {
  build: () => T
  deps: unknown[]
  children: (built: T) => ReactNode
}): ReactNode {
  // A generic helper can't hand the hooks lint a literal deps array; the deps ARE the memo key.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const built = useMemo(build, deps)
  return children(built)
}

/** The viridis `value` heat style for a standardize result, scaled globally across every value
 *  (log10 when the values look like raw intensity). Shared by the matrix cells and the long view. */
function makeValueHeat(
  std: StandardizeResult,
  palette: PaletteRef = ROLE_DEFAULTS.data
): (v: unknown) => CSSProperties | undefined {
  // The Clean data table's abundance cells: on the value palette, as the Clean data heatmap.
  return heatStyle(valueRange(std.rows.map((r) => r.value)), palette)
}

/** A table row's custom condition values hoisted to flat `@slug` keys. DataTableView addresses a
 *  cell by one column key, and the `@` prefix (the custom condition key itself) can't collide with
 *  a result column's name the way a bare slug like `effect` could. */
function flatConds(r: { extra?: Record<string, string> }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r.extra ?? {}).map(([k, v]) => [customCond(k), v]))
}

/** Add `gene` and the flat custom condition keys to each row, ready for DataTableView. */
function tableRows<T extends { uniqID: string; extra?: Record<string, string> }>(
  rows: T[],
  displayMap: Record<string, string>
): Record<string, unknown>[] {
  return groupByGene(rows).map((r) => ({
    ...r,
    gene: displayMap[r.uniqID] ?? '',
    ...flatConds(r)
  }))
}

/** The condition columns a table shows: presets in hierarchy order then the custom conditions,
 *  each included only when the rows carry a value for it. Numeric conditions right-align; the
 *  column key is the condition key itself (`@slug` for a custom one — see flatConds). `only`
 *  restricts which PRESETS are eligible (a contrast table carries no cmpd of its own, say);
 *  custom conditions are always eligible. */
function condColumns(
  rows: Array<{ extra?: Record<string, string> }>,
  only?: ConditionKey[]
): Column[] {
  return condsIn(rows)
    .filter((c) => (only ? only.includes(c) || isCustomCond(c) : true) && condPresent(rows, c))
    .map((c) => ({
      key: c,
      label: condLabel(c),
      ...(isNumericCond(c) ? { align: 'right' as const } : null)
    }))
}

/** Standardized-table columns: each condition/replicate column is shown only when the data
 *  carries a value for it — inactive (empty) conditions are dropped rather than shown blank. */
function stdColumns(rows: StdRow[]): Column[] {
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...condColumns(rows)
  ]
  if (rows.some((r) => r.rep != null)) cols.push({ key: 'rep', label: 'rep', align: 'right' })
  cols.push({ key: 'value', label: 'value', align: 'right', format: fixed(3) })
  return cols
}

/** The genes a one-gene pager steps through: the selected genes when any of them is in the data,
 *  else every gene in it — so the pager starts on all genes and a selection narrows it. */
function pagerGenes(selected: string[], present: Set<string>): string[] {
  return selected.some((id) => present.has(id)) ? selected : [...present]
}

/** Long tables always show a gene's rows as one block: rows are regrouped by uniqID in the order
 *  genes first appear (a stable partition, not an alphabetical sort — genes keep the input/engine
 *  order, and each gene's rows keep theirs). The engines emit rows comparison- or context-major,
 *  which scatters a gene across the table. */
function groupByGene<T extends { uniqID: string }>(rows: T[]): T[] {
  const blocks = new Map<string, T[]>()
  for (const r of rows) {
    let b = blocks.get(r.uniqID)
    if (!b) blocks.set(r.uniqID, (b = []))
    b.push(r)
  }
  return [...blocks.values()].flat()
}

/** Pivot the tidy standardized rows into a gene × sample matrix: one row per uniqID, one column
 *  per sample. The samplesheet's sample names aren't retained in the standardized rows, so a
 *  sample is identified (and labelled) by its condition combination + replicate. */
function standardizeMatrix(
  std: StandardizeResult,
  palette?: PaletteRef
): {
  columns: Column[]
  rows: Record<string, unknown>[]
} {
  const dm = std.displayMap
  const conds = std.activeConditions
  const combo = (r: StdRow): string =>
    [...conds.map((c) => String(condValue(r, c) ?? '')), `r${r.rep ?? ''}`].join('')
  const label = (r: StdRow): string => {
    const parts = conds.map((c) => String(condValue(r, c) ?? '')).filter((x) => x !== '')
    if (r.rep != null) parts.push(`r${r.rep}`)
    return parts.join(' · ') || 'sample'
  }
  // The header's lines: each condition the sample carries, then its replicate, by name.
  const lines = (r: StdRow): HeaderLine[] => {
    const out = conds
      .map((c) => ({ key: condLabel(c), value: String(condValue(r, c) ?? '') }))
      .filter((l) => l.value !== '')
    if (r.rep != null) out.push({ key: 'rep', value: String(r.rep) })
    return out
  }
  const colKeyOf = new Map<string, string>()
  const labelOf = new Map<string, string>()
  const linesOf = new Map<string, HeaderLine[]>()
  const sampleKeys: string[] = []
  const byUid = new Map<string, Record<string, unknown>>()
  const uidOrder: string[] = []
  for (const r of std.rows) {
    const c = combo(r)
    let ck = colKeyOf.get(c)
    if (!ck) {
      ck = `s${sampleKeys.length}`
      colKeyOf.set(c, ck)
      labelOf.set(ck, label(r))
      linesOf.set(ck, lines(r))
      sampleKeys.push(ck)
    }
    let row = byUid.get(r.uniqID)
    if (!row) {
      row = { uniqID: r.uniqID, gene: dm[r.uniqID] ?? '' }
      byUid.set(r.uniqID, row)
      uidOrder.push(r.uniqID)
    }
    row[ck] = r.value
  }
  // Global viridis heat scale across every value cell (matches the Heatmap tile's colour map).
  const heat = makeValueHeat(std, palette)
  const columns: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...sampleKeys.map((k): Column => ({
      key: k,
      label: labelOf.get(k) ?? k,
      labelLines: linesOf.get(k),
      align: 'right',
      format: fixed(3),
      cellStyle: heat
    }))
  ]
  return { columns, rows: uidOrder.map((u) => byUid.get(u)!) }
}

/** A table's cell colouring when a Data table tile owns it (its settings): on / off, and the
 *  palette (unset = the table's default). Absent: the table keeps its own on/off switch. */
interface TableColour {
  on: boolean
  set: (on: boolean) => void
  palette?: PaletteRef
}

/** The standardized table with a Long ⇆ Matrix (gene × sample) view toggle. */
function StdTable({
  std,
  initialView = 'matrix',
  maxChars,
  colour
}: {
  std: StandardizeResult
  initialView?: 'matrix' | 'long'
  /** the id / gene columns' display caps (characters, by column key) */
  maxChars?: Record<string, number>
  colour?: TableColour
}): ReactNode {
  const [view, setView] = useState<'matrix' | 'long'>(initialView)
  const [localColored, setLocalColored] = useState(true)
  const colored = colour?.on ?? localColored
  const setColored = colour?.set ?? setLocalColored
  // Abundance cells on the value palette (default viridis, as the Clean data heatmap).
  const dataPalette = useRolePalette('data')
  const palette = colour?.palette ?? dataPalette
  const long = useMemo(() => {
    const heat = makeValueHeat(std, palette)
    return {
      // Colour the long view's `value` column with the same viridis heat scale as the matrix.
      columns: stdColumns(std.rows).map((c) => (c.key === 'value' ? { ...c, cellStyle: heat } : c)),
      rows: tableRows(std.rows, std.displayMap)
    }
  }, [std, palette])
  const matrix = useMemo(() => standardizeMatrix(std, palette), [std, palette])
  const cur = view === 'matrix' ? matrix : long
  // Drop the per-cell heat styling when colouring is off.
  const columns = colored
    ? cur.columns
    : cur.columns.map((c) => (c.cellStyle ? { ...c, cellStyle: undefined } : c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
        <SwitchBar
          label="View"
          value={view === 'matrix' ? 'Matrix' : 'Long'}
          options={['Matrix', 'Long']}
          onChange={(v) => setView(v === 'Matrix' ? 'matrix' : 'long')}
        />
        <SwitchBarToggle label="Colour" on={colored} onChange={setColored} />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view so the table fully remounts on toggle — otherwise its internal sort/filter
            state (and the Long view's duplicate uniqID row keys) leak across and mis-render. */}
        <DataTableView key={view} columns={columns} rows={cur.rows} maxChars={maxChars} />
      </div>
    </div>
  )
}

/** What the cluster tile's `plot` choice reads as on screen (the stored values are terse). */
const PLOT_LABEL: Record<NonNullable<ClusterConfig['plot']>, string> = {
  pc: 'PC plot',
  loadings: 'loadings',
  scree: 'scree plot'
}

/** Columns for a comparison table, adapted to which conditions the rows carry
 *  and to the analysis (two-way's log2FC is an interaction term). */
function compareColumns(
  rows: CompareResultRow[],
  analysis: CompareConfig['analysis'],
  labels: EffectLabels,
  statType: 'pP' | 'pQ',
  threshold?: ThresholdConfig,
  doseUnit?: string
): Column[] {
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  // Show the comparison label when several coexist (e.g. two-way factor combos) — and always for a
  // curve fit, where it says what each curve is against: "drugA | baseline (dose 0 · time 60)".
  if (analysis === 'curve_fit' || new Set(rows.map((r) => r.comparison)).size > 1) {
    cols.push({ key: 'comparison', label: 'comparison' })
  }
  cols.push(...condColumns(rows))
  // The response surface method (a Curve fit with detection model Spline): its own columns below.
  const response = analysis === 'curve_fit' && rows.some((r) => r.rs)
  cols.push({
    key: 'log2FC',
    label:
      analysis === 'two_way_anova'
        ? 'interaction'
        : response
          ? 'peak log₂FC'
          : analysis === 'curve_fit'
            ? 'curve log₂FC'
            : 'log₂FC',
    align: 'right',
    format: fixed(3)
  })
  // Its description (4PL on log₂: plateaus are log₂ vs the control), how much of the spline's fit
  // that explains (the shape QC), and its moderated F — a surface has the F only.
  if (response)
    cols.push(
      { key: 'pEC50', label: 'pEC50', align: 'right', format: fixed(3) },
      {
        key: 'EC50',
        label: doseUnit ? `EC50 (${doseUnit})` : 'EC50',
        align: 'right',
        format: sig3
      },
      { key: 'slope', label: 'slope', align: 'right', format: fixed(2) },
      { key: 'front', label: 'front (log₂)', align: 'right', format: fixed(3) },
      { key: 'back', label: 'back (log₂)', align: 'right', format: fixed(3) },
      { key: 'R2', label: 'R²', align: 'right', format: fixed(3) },
      { key: 'shape_ratio', label: 'shape ratio', align: 'right', format: fixed(2) },
      { key: 'shape_QC', label: 'shape QC' },
      { key: 'F', label: 'F', align: 'right', format: sig3 },
      // a 4PL surface under CurveCurator's threshold: its relevance score and target–decoy q
      ...(threshold?.type === 'curvecurator' && rows.some((r) => r.rs?.cc)
        ? [{ key: 'relevance', label: 'relevance', align: 'right' as const, format: fixed(3) }]
        : []),
      ...(rows.some((r) => r.rs?.cc?.q != null)
        ? [{ key: 'q_decoy', label: 'q (decoy)', align: 'right' as const, format: sig3 }]
        : [])
    )
  // A curve fit's own parameters and test, as CurveCurator's results table lists them: potency
  // (pEC50 = −log₁₀ EC50, both in the dose's units), the slope and plateaus (ratios to the
  // control), the fit's quality, and the F test.
  if (analysis === 'curve_fit' && !response)
    cols.push(
      { key: 'pEC50', label: 'pEC50', align: 'right', format: fixed(3) },
      {
        key: 'EC50',
        label: doseUnit ? `EC50 (${doseUnit})` : 'EC50',
        align: 'right',
        format: sig3
      },
      { key: 'slope', label: 'slope', align: 'right', format: fixed(2) },
      { key: 'front', label: 'front', align: 'right', format: sig3 },
      { key: 'back', label: 'back', align: 'right', format: sig3 },
      { key: 'R2', label: 'R²', align: 'right', format: fixed(3) },
      ...(rows.some((r) => r.curve?.rmse != null)
        ? [{ key: 'RMSE', label: 'RMSE', align: 'right' as const, format: sig3 }]
        : []),
      { key: 'points', label: 'points', align: 'right' },
      { key: 'F', label: 'F', align: 'right', format: sig3 },
      // The lack-of-fit test, where the doses have replicates to estimate pure error from.
      ...(rows.some((r) => r.curve && curveHasLof(r.curve))
        ? [
            { key: 'F_lof', label: 'lack-of-fit F', align: 'right' as const, format: sig3 },
            {
              key: 'pP_lof',
              label: 'lack-of-fit −log₁₀ P',
              align: 'right' as const,
              format: fixed(3)
            }
          ]
        : []),
      // CurveCurator's relevance score (only under its threshold, whose FC limit and α it uses).
      ...(threshold?.type === 'curvecurator'
        ? [{ key: 'relevance', label: 'relevance', align: 'right' as const, format: fixed(3) }]
        : []),
      // CurveCurator's target–decoy q (only under its relevance threshold).
      ...(rows.some((r) => r.curve?.q != null)
        ? [{ key: 'q_decoy', label: 'q (decoy)', align: 'right' as const, format: sig3 }]
        : [])
    )
  cols.push(
    // Only the significance column that drives the calls (the Compare's P/Q switch).
    {
      key: statType,
      label: statType === 'pQ' ? '−log₁₀ Q-value' : '−log₁₀ P-value',
      align: 'right',
      format: fixed(3)
    },
    { key: 'signf', label: 'signf' },
    { key: 'effect', label: 'effect', format: effectName(labels) },
    // A curve fit's final model: the 4PL, or M0 (flat) where its F-test doesn't reject flat.
    ...(rows.some((r) => r.model) ? [{ key: 'model', label: 'model' }] : [])
  )
  return cols
}

/** Where SAM's permutation FDR put the cutoff on |d| for the comparison a facet shows: the
 *  smallest |d| it called (from every gene, not just a selection on show), and the pooled t's
 *  usual degrees of freedom there — what the volcano needs to draw the boundary. */
function samCutoff(
  all: CompareResultRow[],
  facet: CompareResultRow[],
  statMin: number
): { c: number; df: number } | undefined {
  const key = (r: CompareResultRow): string =>
    [r.comparison, r.cell, r.cmpd, r.dose, r.time, JSON.stringify(r.extra ?? {})].join('|')
  const keys = new Set(facet.map(key))
  let c = Infinity
  const dfs = new Map<number, number>()
  for (const r of all) {
    if (!r.sam || !keys.has(key(r))) continue
    dfs.set(r.sam.df, (dfs.get(r.sam.df) ?? 0) + 1)
    if ((r.pQ ?? -Infinity) >= statMin) c = Math.min(c, Math.abs(r.sam.d))
  }
  let df = 0
  let most = 0
  for (const [d, n] of dfs) if (n > most) [df, most] = [d, n]
  return Number.isFinite(c) && df > 0 ? { c, df } : undefined
}

/** CurveCurator called by FDR: the effective α the target settled on for the comparison a facet
 *  shows (see applyCurveFdr) — the boundary's shape and cutoff. Undefined when nothing was called
 *  there (or the facet spans several groups that settled differently: the strictest is drawn). */
function facetAlpha(
  alphas: Record<string, number> | undefined,
  facet: CompareResultRow[]
): number | undefined {
  if (!alphas) return undefined
  let a: number | undefined
  for (const k of new Set(facet.map(curveGroupKey)))
    if (alphas[k] != null) a = a == null ? alphas[k] : Math.min(a, alphas[k])
  return a
}

/** A curve fit's point counts (control included) common enough to draw CurveCurator's boundary
 *  for — each at least 5% of the curves, most common first. Empty for any other analysis. */
function curvePointCounts(rows: CompareResultRow[]): number[] {
  const tally = new Map<number, number>()
  let total = 0
  for (const r of rows) {
    const cc = ccTestOf(r)
    if (cc) {
      tally.set(cc.n, (tally.get(cc.n) ?? 0) + 1)
      total++
    }
  }
  return [...tally]
    .filter(([, c]) => c >= total * 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n)
}

/** Three significant figures (EC50s span orders of magnitude, so fixed decimals don't fit). */
const sig3 = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toPrecision(3))) : ''

/** Cell formatter mapping the stored effect class ('up'/'down'/'none') to its display name. */
const effectName =
  (labels: EffectLabels) =>
  (v: unknown): string =>
    v === 'up'
      ? labels.up
      : v === 'down'
        ? labels.down
        : v === 'none'
          ? labels.none
          : String(v ?? '')

/** One context value in a matrix column header: dose/time carry their name ("dose 10") since a
 *  bare number is ambiguous; cell/cmpd values speak for themselves ("WT", "Amk"). */
const ctxLabel = (c: ConditionKey, v: unknown): string =>
  isNumericCond(c) || isCustomCond(c) ? `${condLabel(c)} ${v}` : String(v)

/** A matrix column's context conditions as header lines: name → value, blank values left out. */
function ctxLines(r: Parameters<typeof ctxValue>[0], dims: ConditionKey[]): HeaderLine[] {
  return dims
    .map((c) => ({ key: condLabel(c), value: String(ctxValue(r, c) ?? '') }))
    .filter((l) => l.value !== '')
}

/** A value column a matrix view can show in its cells. */
interface MatrixField {
  key: string
  label: string
  /** categorical (e.g. effect): shown as text, no heat colouring */
  text?: boolean
}

/** Pivot result rows into a gene × column matrix showing ONE field per cell. `colOf` names the
 *  column a row belongs to (comparison + context, or the contrast's context tuple); columns keep
 *  first-seen order unless `order` sorts them. Numeric fields are heat-coloured: a diverging RdBu
 *  scale when the values are signed (fold changes, differences), the sequential scale otherwise
 *  (−log p/q, means, SDs). */
function pivotMatrix<T extends { uniqID: string }>(
  rows: T[],
  displayMap: Record<string, string>,
  field: MatrixField,
  colOf: (r: T) => string,
  order?: (a: string, b: string) => number,
  /** a column's header as named lines (from its first row) */
  linesOf?: (r: T) => HeaderLine[],
  /** the fold-change palette a signed value's cell is coloured on */
  palettes: { fc: PaletteRef; data: PaletteRef } = {
    fc: ROLE_DEFAULTS.fc,
    data: ROLE_DEFAULTS.data
  }
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const colKeys: string[] = []
  const colSeen = new Set<string>()
  const colLines = new Map<string, HeaderLine[]>()
  const byUid = new Map<string, Record<string, unknown>>()
  const uidOrder: string[] = []
  const values: number[] = []
  for (const r of rows) {
    const col = colOf(r)
    if (!colSeen.has(col)) {
      colSeen.add(col)
      colKeys.push(col)
      if (linesOf) colLines.set(col, linesOf(r))
    }
    let row = byUid.get(r.uniqID)
    if (!row) {
      row = { uniqID: r.uniqID, gene: displayMap[r.uniqID] ?? '' }
      byUid.set(r.uniqID, row)
      uidOrder.push(r.uniqID)
    }
    const v = (r as unknown as Record<string, unknown>)[field.key]
    row[`c¦${col}`] = v
    if (!field.text && typeof v === 'number' && Number.isFinite(v)) values.push(v)
  }
  if (order) colKeys.sort(order)
  let cell: ((v: unknown) => CSSProperties | undefined) | undefined
  if (!field.text) {
    const signed = values.some((v) => v < 0)
    cell = signed
      ? divergeStyle(
          values.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
          palettes.fc
        )
      : heatStyle(valueRange(values), palettes.data)
  }
  const columns: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...colKeys.map((col): Column => ({
      key: `c¦${col}`,
      label: col,
      labelLines: colLines.get(col),
      align: field.text ? 'left' : 'right',
      format: field.text ? undefined : fixed(3),
      cellStyle: cell
    }))
  ]
  return { columns, rows: uidOrder.map((u) => byUid.get(u)!) }
}

/** The fields of `all` that carry at least one value in these rows, in `all`'s order. */
function presentFields<T>(rows: T[], all: MatrixField[]): MatrixField[] {
  return all.filter((f) =>
    rows.some((r) => {
      const v = (r as unknown as Record<string, unknown>)[f.key]
      return v != null && v !== '' && (f.text || Number.isFinite(v as number))
    })
  )
}

/** Cell choices for the comparison matrix (log2FC first — the heatmap's field). */
const COMPARE_FIELDS: MatrixField[] = [
  { key: 'log2FC', label: 'log₂FC' },
  { key: 'pP', label: '−log₁₀ P-value' },
  { key: 'pQ', label: '−log₁₀ Q-value' },
  { key: 'mean1', label: 'mean1' },
  { key: 'mean2', label: 'mean2' },
  // a curve fit's own (see curveMetrics)
  { key: 'pEC50', label: 'pEC50' },
  { key: 'R2', label: 'R²' },
  { key: 'relevance', label: 'relevance' },
  { key: 'q_decoy', label: 'q (decoy)' },
  { key: 'effect', label: 'effect', text: true }
]

/** Cell choices for the contrast matrix (FCdiff first — the divergence). */
const CONTRAST_FIELDS: MatrixField[] = [
  { key: 'FCdiff', label: 'FCdiff' },
  { key: 'FC1', label: 'FC1' },
  { key: 'FC2', label: 'FC2' },
  { key: 'Pdiff', label: 'Pdiff' },
  { key: 'P1', label: 'P1' },
  { key: 'P2', label: 'P2' },
  { key: 'Qdiff', label: 'Qdiff' },
  { key: 'Q1', label: 'Q1' },
  { key: 'Q2', label: 'Q2' },
  { key: 'effect', label: 'effect', text: true }
]

/** The compare fields with mean1/mean2 named for the groups they average: a comparison labelled
 *  "A | B" averages A in mean1 and B in mean2, so each reads as its comparisons' side ("clpP",
 *  or "clpP, dnaK" over several). Falls back to mean1/mean2 where a label isn't "A | B" (two-way,
 *  curve fits), there are too many to list, or the two names would collide. */
function namedMeanFields(rows: CompareResultRow[]): MatrixField[] {
  const comparisons = [...new Set(rows.map((r) => r.comparison))]
  const sides = comparisons.map((c) => c.split(' | '))
  if (!sides.length || sides.some((s) => s.length !== 2)) return COMPARE_FIELDS
  const side = (i: number): string | null => {
    const names = [...new Set(sides.map((s) => s[i]))]
    return names.length <= 3 ? names.join(', ') : null
  }
  const m1 = side(0)
  const m2 = side(1)
  const taken = new Set(COMPARE_FIELDS.map((f) => f.label))
  if (!m1 || !m2 || m1 === m2 || taken.has(m1) || taken.has(m2)) return COMPARE_FIELDS
  return COMPARE_FIELDS.map((f) =>
    f.key === 'mean1' ? { ...f, label: m1 } : f.key === 'mean2' ? { ...f, label: m2 } : f
  )
}

/** Pivot a comparison result into a gene × comparison-column matrix — the tabular twin of the
 *  log₂FC heatmap. Columns are keyed exactly as the Fc heatmap keys them (comparison label + the
 *  context conditions the comparison doesn't consume), so the two line up; the cell field is the
 *  matrix view's "Show" choice. */
function compareMatrix(
  rows: CompareResultRow[],
  displayMap: Record<string, string>,
  field: MatrixField,
  palettes: { fc: PaletteRef; data: PaletteRef }
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const consumed = new Set<string>()
  for (const r of rows) for (const p of r.cmp_cond.split(':')) if (p) consumed.add(p)
  const ctxDims = condsIn(rows).filter(
    (c) => !consumed.has(c) && rows.some((r) => ctxValue(r, c) != null && ctxValue(r, c) !== '')
  )
  return pivotMatrix(
    rows,
    displayMap,
    field,
    (r) => [r.comparison, ...ctxDims.map((c) => ctxLabel(c, ctxValue(r, c)))].join(' · '),
    undefined,
    (r) => [{ key: 'comparison', value: r.comparison }, ...ctxLines(r, ctxDims)],
    palettes
  )
}

/** The comparison table with a Long ⇆ Matrix (gene × comparison, cells = log2FC) view toggle,
 *  mirroring the standardized table. Long is the stats view (log2FC, p, effect); Matrix is the
 *  wide fold-change pivot that reads like the Fc heatmap. */
function CompareTable({
  rows,
  analysis,
  effectLabels,
  displayMap,
  comparisons,
  statType,
  threshold,
  dose = NO_DOSE,
  initialView = 'matrix',
  maxChars,
  colour
}: {
  rows: CompareResultRow[]
  analysis: CompareConfig['analysis']
  effectLabels: EffectLabels
  displayMap: Record<string, string>
  comparisons: string[]
  /** which significance column drives the calls — the only one shown (pP or pQ) */
  statType: 'pP' | 'pQ'
  /** the threshold the calls were made with (a curve fit's relevance score uses its FC and α) */
  threshold?: ThresholdConfig
  /** a curve fit's dose unit and its molar scale (pEC50 is molar; see curveDoseUnit) */
  dose?: { unit?: string; scale: number }
  initialView?: 'long' | 'matrix'
  /** the id / gene columns' display caps (characters, by column key) */
  maxChars?: Record<string, number>
  colour?: TableColour
}): ReactNode {
  const [view, setView] = useState<'long' | 'matrix'>(initialView)
  const [localColored, setLocalColored] = useState(true)
  const colored = colour?.on ?? localColored
  const setColored = colour?.set ?? setLocalColored
  // Signed cells on the fold-change palette (the tile's own, else the global role's); others —
  // p-values, abundance — on the data-values palette.
  const fcRole = useRolePalette('fc')
  const dataRole = useRolePalette('data')
  const palettes = useMemo(
    () => ({ fc: colour?.palette ?? fcRole, data: dataRole }),
    [colour?.palette, fcRole, dataRole]
  )
  // Matrix cell field ("Show"): any value column the result carries (only the driving one of
  // pP/pQ); log2FC by default.
  // The rows with a curve fit's own cells alongside (pEC50, relevance…), for both views.
  const cellRows = useMemo(
    () =>
      rows.map((r) =>
        r.curve
          ? ({
              ...r,
              ...curveMetrics(r.log2FC, r.curve, threshold, dose.scale)
            } as CompareResultRow)
          : r.rs
            ? ({ ...r, ...responseMetrics(r, dose.scale, threshold) } as CompareResultRow)
            : r
      ),
    [rows, threshold, dose.scale]
  )
  const fields = useMemo(
    () =>
      presentFields(cellRows, namedMeanFields(cellRows)).filter(
        (f) => (f.key !== 'pP' && f.key !== 'pQ') || f.key === statType
      ),
    [cellRows, statType]
  )
  const [fieldKey, setFieldKey] = useState(COMPARE_FIELDS[0].key)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0] ?? COMPARE_FIELDS[0]
  const long = useMemo(
    () => ({
      columns: compareColumns(rows, analysis, effectLabels, statType, threshold, dose.unit),
      // a curve fit's comparison as the plots read it ("drugA | baseline (dose 0)"); the key itself
      // stays on the result rows
      rows: tableRows(cellRows, displayMap).map((t) =>
        analysis === 'curve_fit'
          ? {
              ...t,
              comparison:
                comparisonOf([t as Parameters<typeof comparisonOf>[0][number]]) ?? t.comparison
            }
          : t
      )
    }),
    [rows, cellRows, analysis, effectLabels, displayMap, statType, threshold, dose.unit]
  )
  const matrix = useMemo(
    () => compareMatrix(cellRows, displayMap, field, palettes),
    [cellRows, displayMap, field, palettes]
  )
  const cur = view === 'matrix' ? matrix : long
  const columns = colored
    ? cur.columns
    : cur.columns.map((c) => (c.cellStyle ? { ...c, cellStyle: undefined } : c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
        <SwitchBar
          label="View"
          value={view === 'matrix' ? 'Matrix' : 'Long'}
          options={['Matrix', 'Long']}
          onChange={(v) => setView(v === 'Matrix' ? 'matrix' : 'long')}
        />
        {/* Matrix-only controls: which field fills the cells, and whether to heat-colour them
            (the Long stats table isn't heat-mapped). */}
        {view === 'matrix' && fields.length > 1 && (
          <SwitchBar
            label="Show"
            value={field.label}
            options={fields.map((f) => f.label)}
            onChange={(v) => setFieldKey(fields.find((f) => f.label === v)?.key ?? fieldKey)}
          />
        )}
        {view === 'matrix' && <SwitchBarToggle label="Colour" on={colored} onChange={setColored} />}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view + field so the table fully remounts on toggle — its internal sort/filter
            state (and the Long view's duplicate uniqID row keys) must not leak across. */}
        <DataTableView
          key={`${view}¦${field.key}`}
          columns={columns}
          rows={cur.rows}
          maxChars={maxChars}
          caption={`Comparison — ${comparisons.join(', ')}`}
        />
      </div>
    </div>
  )
}

/** Which response axes the compare rows actually carry (dose, time, or both). Drives whether
 *  DR/TR and Bubble show the dose⇆time switcher — a single-axis dataset needs no switch. */
function axisChoices(
  rows: ReadonlyArray<{
    dose?: number | null
    time?: number | null
    curve?: { axis: string }
    rs?: { axis: string }
  }>
): ('dose' | 'time')[] {
  // A curve fit's row is a whole curve over its own axis (its dose / time field is the context,
  // e.g. the time a dose curve was measured at); other rows sit at a level of either.
  return (['dose', 'time'] as const).filter((a) =>
    rows.some((r) => {
      const along = r.curve?.axis ?? r.rs?.axis
      return along ? along === a : r[a] != null
    })
  )
}

/** Columns for a contrast (compare-vs-compare) table. */
function contrastColumns(rows: ContrastResultRow[]): Column[] {
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...condColumns(rows, ['cell', 'dose', 'time'])
  ]
  cols.push(
    { key: 'FC1', label: 'FC1', align: 'right', format: fixed(3) },
    { key: 'FC2', label: 'FC2', align: 'right', format: fixed(3) },
    { key: 'FCdiff', label: 'FCdiff', align: 'right', format: fixed(3) },
    { key: 'signf1', label: 'signf1' },
    { key: 'signf2', label: 'signf2' },
    { key: 'signf', label: 'signf' },
    { key: 'effect', label: 'effect' }
  )
  return cols
}

/** Pivot contrast rows into a gene × matched-context matrix (cell/cmpd/dose/time tuple, in
 *  numeric-aware order — dose 2.5 < 5 < 10) showing one field per cell: FCdiff by default, or any
 *  other value column (the "Show" choice). With no matched context it's one column. */
function contrastMatrix(
  rows: ContrastResultRow[],
  displayMap: Record<string, string>,
  field: MatrixField,
  palettes: { fc: PaletteRef; data: PaletteRef }
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const dims = condsIn(rows).filter((c) => condPresent(rows, c))
  // Column label → its raw context tuple, kept for the numeric-aware ordering below.
  const tupleOf = new Map<string, unknown[]>()
  const colOf = (r: ContrastResultRow): string => {
    if (!dims.length) return field.label
    const label = dims.map((c) => ctxLabel(c, ctxValue(r, c) ?? '')).join(' · ')
    if (!tupleOf.has(label))
      tupleOf.set(
        label,
        dims.map((c) => ctxValue(r, c) ?? '')
      )
    return label
  }
  // Numeric-aware, dim-by-dim order like the facet tabs (dose 2.5 < 5 < 10; strings code-point).
  const cmp = (a: unknown, b: unknown): number => {
    const an = Number(a)
    const bn = Number(b)
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    const sa = String(a)
    const sb = String(b)
    return sa < sb ? -1 : sa > sb ? 1 : 0
  }
  const order = (a: string, b: string): number => {
    const ta = tupleOf.get(a) ?? []
    const tb = tupleOf.get(b) ?? []
    for (let i = 0; i < dims.length; i++) {
      const c = cmp(ta[i], tb[i])
      if (c !== 0) return c
    }
    return 0
  }
  return pivotMatrix(
    rows,
    displayMap,
    field,
    colOf,
    order,
    (r) => (dims.length ? ctxLines(r, dims) : [{ key: '', value: field.label }]),
    palettes
  )
}

/** The contrast table with a Long ⇆ Matrix (gene × context, cells = FC1/FC2/Δ) view toggle,
 *  mirroring the comparison table. */
function ContrastTable({
  rows,
  displayMap,
  comparisons,
  initialView = 'matrix',
  maxChars,
  colour
}: {
  rows: ContrastResultRow[]
  displayMap: Record<string, string>
  comparisons: string[]
  initialView?: 'long' | 'matrix'
  /** the id / gene columns' display caps (characters, by column key) */
  maxChars?: Record<string, number>
  colour?: TableColour
}): ReactNode {
  const [view, setView] = useState<'long' | 'matrix'>(initialView)
  const [localColored, setLocalColored] = useState(true)
  const colored = colour?.on ?? localColored
  const setColored = colour?.set ?? setLocalColored
  // Signed cells on the fold-change palette (the tile's own, else the global role's); others —
  // p-values, abundance — on the data-values palette.
  const fcRole = useRolePalette('fc')
  const dataRole = useRolePalette('data')
  const palettes = useMemo(
    () => ({ fc: colour?.palette ?? fcRole, data: dataRole }),
    [colour?.palette, fcRole, dataRole]
  )
  // Matrix cell field ("Show"): any value column the result carries; FCdiff by default.
  const fields = useMemo(() => presentFields(rows, CONTRAST_FIELDS), [rows])
  const [fieldKey, setFieldKey] = useState(CONTRAST_FIELDS[0].key)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0] ?? CONTRAST_FIELDS[0]
  const long = useMemo(
    () => ({
      columns: contrastColumns(rows),
      rows: tableRows(rows, displayMap)
    }),
    [rows, displayMap]
  )
  const matrix = useMemo(
    () => contrastMatrix(rows, displayMap, field, palettes),
    [rows, displayMap, field, palettes]
  )
  const cur = view === 'matrix' ? matrix : long
  const columns = colored
    ? cur.columns
    : cur.columns.map((c) => (c.cellStyle ? { ...c, cellStyle: undefined } : c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
        <SwitchBar
          label="View"
          value={view === 'matrix' ? 'Matrix' : 'Long'}
          options={['Matrix', 'Long']}
          onChange={(v) => setView(v === 'Matrix' ? 'matrix' : 'long')}
        />
        {view === 'matrix' && fields.length > 1 && (
          <SwitchBar
            label="Show"
            value={field.label}
            options={fields.map((f) => f.label)}
            onChange={(v) => setFieldKey(fields.find((f) => f.label === v)?.key ?? fieldKey)}
          />
        )}
        {view === 'matrix' && <SwitchBarToggle label="Colour" on={colored} onChange={setColored} />}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view + field: the table remounts on toggle so sort/filter state doesn't leak. */}
        <DataTableView
          key={`${view}¦${field.key}`}
          columns={columns}
          rows={cur.rows}
          maxChars={maxChars}
          caption={`Contrast — ${comparisons.join(', ')}`}
        />
      </div>
    </div>
  )
}

/**
 * One tile's body. Tables read their own result from `results[node.id]`; plots
 * derive from the single upstream result. (Highlight-driven re-render memoization
 * is added in the linked-selection stage.)
 */
export function PanelBody({
  node,
  edges,
  results,
  child,
  selectedOnly = false,
  facetSel
}: {
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
}): ReactNode {
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
  const upstream = upId ? results[upId] : undefined
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
  // A plot's effect colours: its own → its palette → the Compare's → the global palette.
  const effectsOf = (c: unknown, compare: CompareConfig | undefined, own?: PlotEffectColors) =>
    plotEffectColors(own, compare, roles.fcObject, (c as FcPaletteConfig | undefined)?.fcPalette)
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
  const condTitle = useCallback(
    (c: ConditionKey): string => axisTitle(condLabel(c), units),
    [units]
  )
  // The scale every abundance plot shows Clean data on (see plotScaleOf), from the Clean data step
  // this plot reads — directly, or through a Compare / Contrast. Log₁₀ when there's none.
  const cleanId = useMemo(
    () => (upId ? cleanDataUpstream(upId, edges, results) : undefined),
    [upId, edges, results]
  )
  const cleanTransform = useGraph((s) => {
    const n = cleanId ? s.nodes.find((x) => x.id === cleanId) : undefined
    return n && isStep(n) ? (n.data.config as StandardizeConfig).logTransform : undefined
  })
  const cleanResult = cleanId ? results[cleanId] : undefined
  const abScale: ValueScale =
    cleanResult?.kind === 'standardize' ? plotScaleOf(cleanResult.std, cleanTransform) : 'log10'
  /** A contrast's rows for plotting: an abundance contrast's sides moved onto abScale (stored as
   *  log₁₀); fold-change contrasts as they are. Cached in the engine, so stable per result. */
  const contrastRows = (u: Extract<NodeResult, { kind: 'contrast' }>): ContrastResultRow[] =>
    u.ctr.valueKind === 'abundance' ? abundanceOnScale(u.ctr.rows, abScale) : u.ctr.rows
  // The genes a plot emphasises / subsets to / draws per-gene: the linked gene selection (pins
  // from clicking in plots or the gene menu). Only the tiles that DRAW BY SELECTION subscribe —
  // the rest read a stable empty set, so a click doesn't re-render (and redraw) every tile: the
  // point plots take the selection straight from the store themselves, imperatively.
  const drawsSelection =
    selectedOnly || kind === 'tdr' || kind === 'geneBar' || kind === 'dr' || kind === 'response'
  const pinnedIds = useSelection((s) => (drawsSelection ? s.pinnedIds : NO_IDS))
  // STRING: the confidence levels at which the facet on show has any network (from StringView's
  // read; null until known, or with interactors on) — greys out the empty levels, resolves "auto".
  const [stringLevels, setStringLevels] = useState<Set<StringLevel> | null>(null)
  const genes = useMemo(() => (pinnedIds.size ? [...pinnedIds] : NO_GENES), [pinnedIds])
  const focus = selectedOnly ? genes : NO_GENES
  // Selected-only mode: keep only rows whose feature is selected. `sub` is a no-op in all-genes
  // mode. Guarded below so subset mode with nothing selected shows guidance, not an empty plot.
  const sub = <T extends { uniqID: string }>(rows: T[]): T[] =>
    selectedOnly ? rows.filter((r) => pinnedIds.has(r.uniqID)) : rows
  if (SUBSET_TOGGLE_KINDS.has(kind) && selectedOnly && genes.length === 0)
    return <Empty text="No genes selected — pick genes in the gene menu or click them in a plot." />
  // A plot is viewed from its run (graph/plotRun.ts) — what the canvas shows green. Until it has
  // run, the tile says why it isn't drawn: not run yet, running, or the reason its run failed (a
  // requirement the upstream data doesn't meet, no species …).
  const plotRun =
    categoryOf(kind) === 'plotting' ? results[plotResultKey(node.id, child?.id)] : undefined
  if (categoryOf(kind) === 'plotting') {
    const runState = child ? (child.status ?? 'idle') : node.data.status
    const runError = child ? child.error : node.data.error
    if (runState !== 'done' || !plotRun)
      return (
        <PlotNotRun
          status={runState}
          error={runError}
          onRun={() => {
            const g = useGraph.getState()
            void (child ? g.runPlotChild(node.id, child.id) : g.runNode(node.id))
          }}
        />
      )
  }

  if (kind === 'load') {
    const cfg = node.data.config as LoadConfig
    if (!cfg.data) return <Empty text="No input selected — choose files in the tile inspector." />
    return (
      <div style={styles.loadInfo}>
        <div>
          <span style={styles.loadLabel}>data</span>
          {cfg.data}
        </div>
        <div>
          <span style={styles.loadLabel}>samplesheet</span>
          {cfg.samplesheet ?? '—'}
        </div>
        <div>
          <span style={styles.loadLabel}>ID map</span>
          {cfg.db ?? '—'}
        </div>
      </div>
    )
  }
  // Processing steps (standardize/compare/contrast) render NO dashboard tile of their own — they are
  // excluded from the grid (see expandMembers). Their results table is viewed via a separate Data
  // table tile below. (These branches stay as the canonical table renderers for any direct render.)
  if (kind === 'standardize') {
    if (result?.kind !== 'standardize')
      return <Empty text="Run this tile to produce the clean data table." />
    // Shown on Clean data's chosen scale (its log-transform); analyses read the linear rows.
    const stdCfg = node.data.config as StandardizeConfig
    return (
      <StdTable std={presentStd(result.std, presentScaleOf(result.std, stdCfg.logTransform))} />
    )
  }
  if (kind === 'compare' || kind === 'curveFit') {
    if (result?.kind !== 'compare')
      return (
        <Empty
          text={`Run this tile to produce the ${kind === 'curveFit' ? 'curve fit' : 'comparison'} table.`}
        />
      )
    const cmpCfg = node.data.config as CompareConfig
    return (
      <CompareTable
        rows={result.cmp.rows}
        analysis={cmpCfg.analysis}
        effectLabels={effectLabelsOf(cmpCfg)}
        displayMap={result.displayMap}
        comparisons={result.cmp.comparisons}
        statType={(result.cmp.threshold ?? cmpCfg.threshold)?.statType ?? 'pQ'}
        threshold={result.cmp.threshold ?? cmpCfg.threshold}
        dose={curveDoseUnit(cmpCfg, units)}
      />
    )
  }
  if (kind === 'contrast') {
    if (result?.kind !== 'contrast')
      return <Empty text="Connect a Compare tile, pick two levels to contrast, and run." />
    return (
      <ContrastTable
        // the feature on the switcher (a table isn't faceted, but it shows one feature)
        rows={rowsOfFeatureNamed(result.ctr.rows, facetSel?.feature)}
        displayMap={result.displayMap}
        comparisons={result.ctr.comparisons}
      />
    )
  }
  // The Data-table tile renders the UPSTREAM step's results table interactively.
  if (kind === 'table') {
    // The configured default view seeds each table's own View switch; keying on it means a change
    // from the settings gear takes effect immediately instead of only on the next mount.
    const view = (cfgSource as TableConfig).view
    // The uniqID and gene columns' display caps (cut with "…", whole on hover — display only).
    const tableCfg = cfgSource as TableConfig
    const maxChars = {
      uniqID: tableCfg.idMaxLen ?? TABLE_GENE_MAX,
      gene: tableCfg.geneMaxLen ?? TABLE_GENE_MAX
    }
    // Cell colouring: the tile's own (its settings and the in-tile switch write the same field).
    const colour: TableColour = {
      on: tableCfg.colored ?? true,
      set: (on) => patchConfig({ colored: on }),
      palette: toPaletteRef(tableCfg.palette)
    }
    if (!upstream) return <Empty text="Connect a Clean data, Compare, or Contrast tile." />
    if (upstream.kind === 'standardize')
      return (
        <StdTable
          key={view}
          std={presentStd(
            upstream.std,
            presentScaleOf(
              upstream.std,
              (upStep?.data.config as StandardizeConfig | undefined)?.logTransform
            )
          )}
          initialView={view}
          maxChars={maxChars}
          colour={colour}
        />
      )
    if (upstream.kind === 'compare') {
      const upCfg = upStep?.data.config as CompareConfig | undefined
      return (
        <CompareTable
          key={view}
          rows={upstream.cmp.rows}
          analysis={upCfg?.analysis ?? 'compare'}
          effectLabels={effectLabelsOf(upCfg)}
          displayMap={upstream.displayMap}
          comparisons={upstream.cmp.comparisons}
          statType={(upstream.cmp.threshold ?? upCfg?.threshold)?.statType ?? 'pQ'}
          threshold={upstream.cmp.threshold ?? upCfg?.threshold}
          dose={curveDoseUnit(upCfg, units)}
          initialView={view}
          maxChars={maxChars}
          colour={colour}
        />
      )
    }
    if (upstream.kind === 'contrast') {
      return (
        <ContrastTable
          key={view}
          // the feature on the switcher (a table isn't faceted, but it shows one feature)
          rows={rowsOfFeatureNamed(upstream.ctr.rows, facetSel?.feature)}
          displayMap={upstream.displayMap}
          comparisons={upstream.ctr.comparisons}
          initialView={view}
          maxChars={maxChars}
          colour={colour}
        />
      )
    }
    return <Empty text="Run the upstream step to produce its table." />
  }
  if (kind === 'volcano') {
    if (upstream?.kind !== 'compare')
      return <Empty text="Connect a Compare or Curve fit tile and run it." />
    const cfg = cfgSource as VolcanoConfig
    const dm = upstream.displayMap
    // The guide geometry (linear lines vs SAM curve) comes from the threshold the RESULT's calls
    // were made with — carried on the result itself — so the drawn boundary can never disagree
    // with the colours, even while the Compare config has moved on (an FDR-method change awaiting
    // a re-run). The node config is only the fallback for a result saved before it carried one.
    const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
    const threshold = upstream.cmp.threshold ?? upCfg?.threshold ?? DEFAULT_THRESHOLD
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={sub(upstream.cmp.rows)} facetSel={facetSel}>
          {(rows) => (
            <Built
              build={() =>
                buildVolcano(rows, {
                  statType: threshold.statType,
                  fcLow: threshold.fcLow,
                  fcHigh: threshold.fcHigh,
                  statMin: threshold.statMin,
                  displayMap: dm
                })
              }
              deps={[
                rows,
                threshold.statType,
                threshold.fcLow,
                threshold.fcHigh,
                threshold.statMin,
                dm
              ]}
            >
              {(volcano) => (
                <VolcanoView
                  volcano={volcano}
                  threshold={threshold}
                  curveNs={curvePointCounts(rows)}
                  samCut={
                    threshold.type === 'sam_fdr'
                      ? samCutoff(upstream.cmp.rows, rows, threshold.statMin)
                      : undefined
                  }
                  ccAlpha={
                    threshold.type === 'curvecurator' && threshold.ccCallBy === 'fdr'
                      ? facetAlpha(upstream.cmp.ccAlpha, rows)
                      : undefined
                  }
                  effectLabels={effectLabelsOf(upCfg)}
                  effectColors={effectsOf(cfg, upCfg)}
                  labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                  style={cfg.style}
                  // Dragging a guide live-rethresholds the upstream Compare (re-classifies genes).
                  onThresholdChange={
                    upId
                      ? (partial) => useGraph.getState().setCompareThreshold(upId, partial)
                      : undefined
                  }
                />
              )}
            </Built>
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'heatmap') {
    const cfg = cfgSource as HeatmapConfig
    // Compare upstream → log2FC heatmap (every comparison/context is a column, no faceting).
    if (upstream?.kind === 'compare') {
      const linkage = cfg.linkage ?? 'ward'
      const leafOrder = cfg.leafOrder ?? 'mean'
      const quickLinkage = quickOn(cfg, 'linkage', 'heatmap')
      const quickLeaf = quickOn(cfg, 'leafOrder', 'heatmap')
      // Each side's clustering switches on the tile: the genes' and the conditions' modules + tree.
      const sideToggles = (
        [
          ['gene modules', 'geneModules'],
          ['gene tree', 'geneTree'],
          ['condition modules', 'condModules'],
          ['condition tree', 'condTree']
        ] as const
      ).filter(([, f]) => quickOn(cfg, f, 'heatmap'))
      const catOf = (id: unknown): readonly string[] =>
        CATEGORICAL_SCHEMES[toCategoricalId(id) ?? globalCategorical]
      return (
        <div style={styles.chart}>
          <div style={styles.stack}>
            {(quickLinkage || quickLeaf || sideToggles.length > 0) && (
              <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
                {quickLinkage && (
                  <SwitchBar
                    label="linkage"
                    value={linkage}
                    options={HEATMAP_LINKAGE_KEYS}
                    optionLabel={(o) => (o === 'ward' ? 'Ward' : o)}
                    onChange={(v) => patchConfig({ linkage: v })}
                  />
                )}
                {quickLeaf && (
                  <SwitchBar
                    label="leaf order"
                    value={leafOrder}
                    options={HEATMAP_LEAF_ORDER_KEYS}
                    onChange={(v) => patchConfig({ leafOrder: v })}
                  />
                )}
                {sideToggles.map(([label, f]) => (
                  <SwitchBarToggle
                    key={f}
                    label={label}
                    on={!!cfg[f]}
                    onChange={(on) => patchConfig({ [f]: on })}
                  />
                ))}
              </div>
            )}
            <div style={styles.stackBody}>
              <FcHeatmapTile
                rows={upstream.cmp.rows}
                displayMap={upstream.displayMap}
                maxGenes={heatmapCapOn(cfg) ? cfg.maxGenes : 0}
                focus={focus}
                // Remount on a flip: it swaps which screen axis carries which data, and Plotly's
                // key-by-key react diff can leave the previous orientation's own keys behind (a
                // colourbar's placement, an axis side). A fresh div starts clean.
                key={cfg.orient ?? 'auto'}
                orient={cfg.orient}
                palette={paletteOf(cfg, 'fc')}
                linkage={linkage}
                leafOrder={leafOrder}
                geneMax={cfg.dendroClades ?? DENDRO_CLADES_DEFAULT}
                geneModules={!!cfg.geneModules}
                geneTree={!!cfg.geneTree}
                geneColors={catOf(cfg.geneCategorical)}
                condMax={cfg.dendroColClades ?? DENDRO_CLADES_DEFAULT}
                condModules={!!cfg.condModules}
                condTree={!!cfg.condTree}
                condColors={catOf(cfg.condCategorical)}
              />
            </div>
          </div>
        </div>
      )
    }
    // Standardize upstream → intensity heatmap (genes × samples, full proteome — no gene cap).
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data or Compare tile and run it." />
    // On the scale every abundance plot shows Clean data on (see abScale).
    const scale = abScale
    const condBar = heatmapCondBar(cfg, primaryColorLevels(upstream.std))
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'condBar') && (
              <SwitchBarToggle
                label="show conditions"
                on={condBar}
                onChange={(on) => patchConfig({ condBar: on })}
              />
            )}
            {quickOn(cfg, 'sampleOrder') && (
              <SwitchBar
                label="sort"
                value={sampleOrderOf(cfg)}
                options={SAMPLE_ORDERS}
                onChange={(v) => patchConfig({ sampleOrder: v })}
              />
            )}
          </div>
          <div style={styles.stackBody}>
            <HeatmapTile
              key={cfg.orient ?? 'auto'}
              std={presentStd(upstream.std, scale)}
              scale={scale}
              focus={focus}
              orient={cfg.orient}
              condBar={condBar}
              palette={paletteOf(cfg, 'data', 'valuePalette')}
              sampleOrder={sampleOrderOf(cfg)}
            />
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'scatter') {
    const cfg = cfgSource as ScatterConfig
    // A Compare plots the two compared groups' log10 intensities (mean1 vs mean2); a
    // Contrast plots FC1 vs FC2. Either way the upstream supplies the significance.
    if (upstream?.kind === 'compare') {
      const dm = upstream.displayMap
      return (
        <div style={styles.chart}>
          <FacetedPlot rows={upstream.cmp.rows} facetSel={facetSel}>
            {(rows) => (
              <Built
                build={() => buildIntensityScatter(rows, { displayMap: dm, scale: abScale })}
                deps={[rows, dm, abScale]}
              >
                {(scatter) => (
                  <ScatterView
                    scatter={scatter}
                    labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                    style={cfg.style}
                    effectLabels={effectLabelsOf(upStep?.data.config as CompareConfig | undefined)}
                    effectColors={effectsOf(cfg, upStep?.data.config as CompareConfig | undefined)}
                  />
                )}
              </Built>
            )}
          </FacetedPlot>
        </div>
      )
    }
    if (upstream?.kind !== 'contrast')
      return <Empty text="Connect a Compare or Contrast tile and run it." />
    const dm = upstream.displayMap
    // Dragging a guide live-re-calls the upstream Contrast (as a volcano's drag re-calls its
    // Compare): the new cutoff, written the way its Statistic panel writes it.
    const ctrStep = upStep?.data.kind === 'contrast' ? upStep : undefined
    const ctrStat = (ctrStep?.data.config as ContrastConfig | undefined)?.stat
    const onStatDrag = ctrStep
      ? (edge: 'bandUp' | 'bandDown' | AxisTail, value: number) =>
          useGraph.getState().setContrastStat(ctrStep.id, contrastStatDrag(ctrStat, edge, value))
      : undefined
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={contrastRows(upstream)} facetSel={facetSel}>
          {(rows) => (
            <Built
              build={() =>
                buildScatter(rows, {
                  displayMap: dm,
                  valueKind: upstream.ctr.valueKind,
                  scale: abScale,
                  valueLabel: contrastFeatureLabel(rows)
                })
              }
              deps={[rows, dm, upstream.ctr.valueKind, abScale]}
            >
              {(scatter) => (
                <ScatterView
                  scatter={scatter}
                  labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                  style={cfg.style}
                  onStatDrag={onStatDrag}
                  asymmetric={ctrStat?.asymmetric ?? false}
                />
              )}
            </Built>
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'dumbbell') {
    if (upstream?.kind !== 'contrast') return <Empty text="Connect a Contrast tile and run it." />
    const cfg = cfgSource as DumbbellConfig
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {quickOn(cfg, 'order') && (
            <SwitchBar
              label="order by"
              value={cfg.order ?? 'diff'}
              options={DUMBBELL_ORDERS}
              optionLabel={(o) => dumbbellOrderLabel(o, upstream.ctr.rows)}
              onChange={(v) => patchConfig({ order: v })}
            />
          )}
          <div style={styles.stackBody}>
            {/* Full rows (no `sub`): the base list follows the All/Selected toggle via `focus`,
                and DumbbellView appends any hovered/pinned gene from the full set. */}
            <FacetedPlot rows={contrastRows(upstream)} facetSel={facetSel}>
              {(rows) => (
                <DumbbellView
                  rows={rows}
                  topGenes={geneCapOn(cfg) ? cfg.topGenes : 0}
                  displayMap={dm}
                  focus={focus}
                  key={cfg.orient ?? 'auto'}
                  orient={cfg.orient}
                  order={cfg.order}
                  // the feature on the switcher, when it's not the sides' own value
                  valueKind={contrastFeatureLabel(rows) ? 'other' : upstream.ctr.valueKind}
                  valueLabel={contrastFeatureLabel(rows) ?? abundanceLabel(abScale)}
                />
              )}
            </FacetedPlot>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'ma') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as MAConfig
    const dm = upstream.displayMap
    // MA's fold-change lines are the SAME threshold volcano uses — the one the result's calls were
    // made with (see the volcano above) — so the two plots match and a drag on either updates the
    // shared cutoff. Under a SAM (non-linear) threshold there's no fixed FC cutoff to draw, so hide
    // the lines (colour still shows calls).
    const maCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
    const threshold = upstream.cmp.threshold ?? maCfg?.threshold ?? DEFAULT_THRESHOLD
    // Fold-change lines belong to the linear cutoff only.
    const maSam = threshold.type !== 'linear'
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={sub(upstream.cmp.rows)} facetSel={facetSel}>
          {(rows) => (
            <Built
              build={() =>
                buildMA(rows, {
                  fcLow: threshold.fcLow,
                  fcHigh: threshold.fcHigh,
                  displayMap: dm,
                  scale: abScale
                })
              }
              deps={[rows, threshold.fcLow, threshold.fcHigh, dm, abScale]}
            >
              {(ma) => (
                <MAView
                  ma={ma}
                  samThreshold={maSam}
                  asymmetric={threshold.asymmetric ?? false}
                  effectLabels={effectLabelsOf(maCfg)}
                  effectColors={effectsOf(cfg, maCfg)}
                  style={cfg.style}
                  onThresholdChange={
                    upId
                      ? (partial) => useGraph.getState().setCompareThreshold(upId, partial)
                      : undefined
                  }
                />
              )}
            </Built>
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'dr') {
    const cfg = cfgSource as DRConfig
    // Dose-response and Time-response are separate plots: the axis is the tile's own, never
    // switched — data without it says so instead of drawing the other.
    const axis = cfg.axis
    const noAxis = (rows: Parameters<typeof axisChoices>[0]): ReactNode =>
      axisChoices(rows).includes(axis) ? null : (
        <Empty
          text={`No ${axis} levels here — add a ${axis === 'dose' ? 'Time' : 'Dose'}-response plot instead.`}
        />
      )
    // From a Contrast: the hovered/selected gene's response profile on BOTH sides (FC1 vs FC2), for
    // comparing two datasets/contrasts. From a Compare: every gene's response curve (below).
    if (upstream?.kind === 'contrast') {
      const dm = upstream.displayMap
      const missing = noAxis(upstream.ctr.rows)
      if (missing) return missing
      const present = new Set(upstream.ctr.rows.map((r) => r.uniqID))
      // FC1/FC2 are abundance when the contrast is fed by Clean data inputs (on the plots'
      // abundance scale — see contrastRows), log2 fold-change when fed by Compare inputs.
      const yLabel = upstream.ctr.valueKind === 'abundance' ? abundanceLabel(abScale) : 'log₂FC'
      const ctrRows = contrastRows(upstream)
      return (
        <div style={styles.chart}>
          <div style={styles.stack}>
            <div style={styles.stackBody}>
              {/* One gene at a time — the pager steps through every gene, or just the selected
                  ones while any are selected. */}
              <GeneSwitch
                genes={pagerGenes(genes, present)}
                present={present}
                displayMap={dm}
                // The axis scale on the gene switcher's own row, before the gene.
                controls={
                  quickOn(cfg, 'yScale') && (
                    <SwitchBar
                      inline
                      label="scale"
                      value={drYScale(cfg, true)}
                      options={['gene', 'global']}
                      optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                      onChange={(v) => patchConfig({ yScale: v })}
                    />
                  )
                }
              >
                {(gene) => (
                  <FacetedPlot rows={ctrRows} exclude={[axis]} facetSel={facetSel}>
                    {(rows) => (
                      <ResponseCompareView
                        rows={rows}
                        displayMap={dm}
                        axis={axis}
                        axisLabel={axisTitle(axis, units)}
                        gene={gene}
                        yLabel={contrastFeatureLabel(rows) ?? yLabel}
                        // Global (default): one y scale for the WHOLE contrast — of the feature
                        // on show — so paging genes (or switching facets) doesn't rescale and the
                        // curves stay comparable. Per gene: each gene's own range.
                        scaleRows={
                          drYScale(cfg, true) === 'global'
                            ? rowsOfFeature(ctrRows, rows[0])
                            : undefined
                        }
                        look={drLook(cfg)}
                      />
                    )}
                  </FacetedPlot>
                )}
              </GeneSwitch>
            </div>
          </div>
        </div>
      )
    }
    if (upstream?.kind !== 'compare')
      return <Empty text="Connect a Compare, Curve fit or Contrast tile and run it." />
    const dm = upstream.displayMap
    const missing = noAxis(upstream.cmp.rows)
    if (missing) return missing
    const drView = cfg.view ?? 'overview'
    // Fed by a Curve fit: its look's defaults differ (no confidence band unless asked — drLook).
    const drCurveFit = upStep?.data.kind === 'curveFit'
    // A response surface method curve fit: its description 4PL ('curve') or its detection spline.
    const responseFit = upstream.cmp.rows.some((r) => r.rs && r.rs.axis !== 'surface')
    const model = cfg.model ?? 'curve'
    const present = new Set(upstream.cmp.rows.map((r) => r.uniqID))
    // The global ⇆ detailed ⇆ focused switch. (The stored value for global stays 'overview'.)
    const viewSwitch = (): ReactNode =>
      quickOn(cfg, 'view') ? (
        <SwitchBar
          inline
          label="view"
          value={drView}
          options={['overview', 'detail', 'focus']}
          optionLabel={(o) => (o === 'focus' ? 'focused' : o === 'detail' ? 'detailed' : 'global')}
          onChange={(v) => patchConfig({ view: v })}
        />
      ) : null
    // How many genes the detailed view draws: the top-N, at most DR_DETAIL_CAP.
    const detailN = Math.min(geneCapOn(cfg) ? cfg.topGenes : DR_DETAIL_CAP, DR_DETAIL_CAP)
    // The axis scale of the gene-by-gene views (detailed, focused).
    const scaleSwitch = (): ReactNode =>
      quickOn(cfg, 'yScale') ? (
        <SwitchBar
          inline
          label="scale"
          value={drYScale(cfg, false)}
          options={['gene', 'global']}
          optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
          onChange={(v) => patchConfig({ yScale: v })}
        />
      ) : null
    // The detection model ⇆ description switch, for a response surface method fit only.
    const modelSwitch = (): ReactNode =>
      responseFit && quickOn(cfg, 'model') ? (
        <SwitchBar
          inline
          label="model"
          value={model}
          options={['spline', 'curve']}
          onChange={(v) => patchConfig({ model: v })}
        />
      ) : null
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {/* Global / detailed: one strip for the view / model (/ scale) switches, one line while
              the tile is wide enough, wrapping (not cropped) when it isn't. Focused: the pager's. */}
          {drView !== 'focus' &&
            ((responseFit && quickOn(cfg, 'model')) ||
              quickOn(cfg, 'view') ||
              (drView === 'detail' && quickOn(cfg, 'yScale'))) && (
              <SwitchStrip>
                {viewSwitch()}
                {modelSwitch()}
                {drView === 'detail' && scaleSwitch()}
              </SwitchStrip>
            )}
          <div style={styles.stackBody}>
            {drView === 'focus' ? (
              // One gene at a time — the pager steps through every gene, or just the selected
              // ones while any are selected (a hovered gene takes over while hovered), drawn for
              // the compound / context on show. The view / model switches sit on the pager's own
              // row, before the gene.
              <GeneSwitch
                genes={pagerGenes(genes, present)}
                present={present}
                displayMap={dm}
                // The view, model and axis-scale switches on the gene switcher's own row, before
                // the gene (as the bar's) — the master view first.
                controls={
                  <>
                    {viewSwitch()}
                    {modelSwitch()}
                    {scaleSwitch()}
                  </>
                }
              >
                {(gene) => (
                  <FacetedPlot rows={upstream.cmp.rows} exclude={[axis]} facetSel={facetSel}>
                    {(rows) => (
                      <DRFocusView
                        rows={rows.filter((r) => r.uniqID === gene)}
                        axis={axis}
                        axisLabel={axisTitle(axis, units)}
                        gene={gene}
                        std={cleanResult?.kind === 'standardize' ? cleanResult.std.rows : undefined}
                        look={drLook(cfg, drCurveFit)}
                        effectColors={effectsOf(cfg, upCompareCfg)}
                        model={model}
                        // Global: one y scale for the WHOLE Compare, so paging genes (or switching
                        // facets) doesn't rescale. Per gene (default): each gene's own range.
                        scaleRows={
                          drYScale(cfg, false) === 'global' ? upstream.cmp.rows : undefined
                        }
                      />
                    )}
                  </FacetedPlot>
                )}
              </GeneSwitch>
            ) : drView === 'detail' ? (
              // The top-N genes by response (at most DR_DETAIL_CAP; buildDR picks them, in its colour
              // order) without the every-gene background, each drawn in full as the focused view
              // draws one. The selection narrows the pool they're picked from, not the curves.
              <FacetedPlot rows={upstream.cmp.rows} exclude={[axis]} facetSel={facetSel}>
                {(rows) => (
                  <Built
                    build={() =>
                      buildDR(rows, {
                        axis,
                        model,
                        topGenes: detailN,
                        displayMap: dm,
                        within: genes
                      })
                    }
                    deps={[rows, axis, model, detailN, dm, genes]}
                  >
                    {(dr) => {
                      const shown = dr.series.slice(0, dr.highlight).map((sr) => sr.uniqID)
                      const on = new Set(shown)
                      return (
                        <DRFocusView
                          rows={rows.filter((r) => on.has(r.uniqID))}
                          genes={shown}
                          displayMap={dm}
                          axis={axis}
                          axisLabel={axisTitle(axis, units)}
                          std={
                            cleanResult?.kind === 'standardize' ? cleanResult.std.rows : undefined
                          }
                          look={drLook(cfg, drCurveFit)}
                          effectColors={effectsOf(cfg, upCompareCfg)}
                          model={model}
                          scaleRows={
                            drYScale(cfg, false) === 'global' ? upstream.cmp.rows : undefined
                          }
                        />
                      )
                    }}
                  </Built>
                )}
              </FacetedPlot>
            ) : (
              // DR/TR always draws every gene as a faint background curve; the selection only
              // changes WHICH curves are coloured — the selected genes while any are selected,
              // else the top-N by response — so use the full rows (no `sub`).
              <FacetedPlot rows={upstream.cmp.rows} exclude={[axis]} facetSel={facetSel}>
                {(rows) => (
                  <Built
                    build={() =>
                      buildDR(rows, {
                        axis,
                        model,
                        topGenes: geneCapOn(cfg) ? cfg.topGenes : 0,
                        displayMap: dm,
                        focus: genes
                      })
                    }
                    deps={[rows, axis, model, geneCapOn(cfg) ? cfg.topGenes : 0, dm, genes]}
                  >
                    {(dr) => (
                      <DRView
                        dr={dr}
                        axisLabel={axisTitle(dr.axis, units)}
                        look={drLook(cfg, drCurveFit)}
                        palette={paletteOf(cfg, 'fcObject')}
                      />
                    )}
                  </Built>
                )}
              </FacetedPlot>
            )}
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'curveMad') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
    const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
    const cfg = cfgSource as CurveMadConfig
    // By sample is offered only where it can differ from by dose (curvesReplicated).
    const replicated = curvesReplicated(upstream.cmp.rows)
    const check = cfg.check === 'sample' && !replicated ? 'dose' : (cfg.check ?? 'dose')
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {/* One row, wrapping when the tile is narrow (as the PCA's switches). */}
          <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'check') && (
              <SwitchBar
                label="check"
                value={check}
                options={
                  replicated
                    ? ['dose', 'sample', 'fitted', 'normality', 'metrics']
                    : ['dose', 'fitted', 'normality', 'metrics']
                }
                onChange={(v) => patchConfig({ check: v })}
              />
            )}
            {/* how the residuals are drawn: only the dose / sample groupings have a choice */}
            {(check === 'dose' || check === 'sample') && quickOn(cfg, 'show') && (
              <SwitchBar
                label="show"
                value={cfg.show ?? 'dot'}
                options={['dot', 'violin']}
                onChange={(v) => patchConfig({ show: v })}
              />
            )}
            {/* a Q–Q plot's axes are quantiles, not residuals — no scale to choose (nor the
                metrics', each its own) */}
            {check !== 'normality' && check !== 'metrics' && quickOn(cfg, 'yScale') && (
              <SwitchBar
                label="scale"
                value={cfg.yScale ?? 'fit'}
                options={['fit', 'range']}
                optionLabel={(o) => (o === 'fit' ? 'adjusted' : 'global')}
                onChange={(v) => patchConfig({ yScale: v })}
              />
            )}
          </div>
          <div style={styles.stackBody}>
            <FacetedPlot rows={upstream.cmp.rows} facetSel={facetSel}>
              {(rows) => (
                <CurveMadView
                  rows={rows}
                  displayMap={upstream.displayMap}
                  std={cleanResult?.kind === 'standardize' ? cleanResult.std.rows : undefined}
                  unit={curveDoseUnit(upCfg, units).unit}
                  style={cfg.style}
                  yScale={cfg.yScale}
                  show={cfg.show}
                  check={check}
                  metricX={cfg.metricX}
                  metricY={cfg.metricY}
                  threshold={upstream.cmp.threshold ?? upCfg?.threshold}
                  doseScale={curveDoseUnit(upCfg, units).scale}
                  effectLabels={effectLabelsOf(upCfg)}
                  effectColors={effectsOf(cfg, upCfg)}
                  onMetricX={(m) => patchConfig({ metricX: m })}
                  onMetricY={(m) => patchConfig({ metricY: m })}
                  maxPoints={
                    cfg.capEnabled === false
                      ? Infinity
                      : Math.min(cfg.maxPoints ?? RESIDUAL_DOT_CAP, RESIDUAL_DOT_CAP)
                  }
                />
              )}
            </FacetedPlot>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'potency') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
    const cfg = cfgSource as PotencyConfig
    const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
    const threshold = upstream.cmp.threshold ?? upCfg?.threshold ?? DEFAULT_THRESHOLD
    // The calls' smallest fold change either side — the volcano boundary's vertical wall: under
    // CurveCurator's score, where it sits for this facet's α (by a target FDR, the α its
    // comparison settled on — none when nothing was called) and its most common point count;
    // under a linear cutoff, the limits themselves; SAM has no fixed wall.
    const wallsFor = (rows: CompareResultRow[]): { low?: number; high?: number } => {
      if (threshold.type === 'sam_fdr') return {}
      // No limit (the response surface method's default) draws no wall.
      if (threshold.type !== 'curvecurator')
        return threshold.fcHigh === 0 && threshold.fcLow === 0
          ? {}
          : { low: threshold.fcLow, high: threshold.fcHigh }
      const a =
        threshold.ccCallBy === 'fdr'
          ? facetAlpha(upstream.cmp.ccAlpha, rows)
          : 10 ** -threshold.statMin
      const n = curvePointCounts(rows)[0]
      if (a == null || n == null) return {}
      return {
        low: -curveCuratorWall(n, -threshold.fcLow, a),
        high: curveCuratorWall(n, threshold.fcHigh, a)
      }
    }
    const show = cfg.show ?? 'all'
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {quickOn(cfg, 'show') && (
            <SwitchBar
              label="curves"
              value={show}
              options={['called', 'all']}
              optionLabel={(o) => (o === 'called' ? 'significant' : 'all')}
              onChange={(v) => patchConfig({ show: v })}
            />
          )}
          <div style={styles.stackBody}>
            <FacetedPlot rows={sub(upstream.cmp.rows)} facetSel={facetSel}>
              {(rows) => (
                <PotencyView
                  rows={rows}
                  dose={curveDoseUnit(upCfg, units)}
                  displayMap={upstream.displayMap}
                  show={show}
                  fcLow={wallsFor(rows).low}
                  fcHigh={wallsFor(rows).high}
                  labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                  effectLabels={effectLabelsOf(upCfg)}
                  effectColors={effectsOf(cfg, upCfg)}
                  style={cfg.style}
                />
              )}
            </FacetedPlot>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'response') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
    const cfg = cfgSource as ResponseConfig
    const dim = responseDim(cfg)
    const show = responseShow(cfg)
    const look = responseLook(cfg)
    // A Curve fit by the response surface method over dose × time: one surface per gene × compound.
    const surfaces = upstream.cmp.rows.filter((r) => r.rs?.axis === 'surface')
    if (!surfaces.length)
      return <Empty text="Needs dose × time surfaces — set the Curve fit’s axis to dose × time." />
    const present = new Set(surfaces.map((r) => r.uniqID))
    // A joint description's or the spline surface's (no description) 3-D lines can be sliced by
    // time or by dose (a per-time one's by time, a per-dose one's by dose).
    const sliceable =
      dim === '3d' &&
      show === 'line' &&
      surfaces.some((r) => !r.rs?.surface || r.rs.surface.method === 'joint')
    const slice = cfg.slice ?? 'time'
    const yScale = cfg.yScale ?? 'gene'
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={styles.stackBody}>
            {/* One gene at a time — every gene, or the selected ones while any are selected. */}
            <GeneSwitch
              genes={pagerGenes(genes, present)}
              present={present}
              displayMap={upstream.displayMap}
              // The view / show / lines / scale switches on the gene switcher's row, before the
              // gene — one strip, wrapping only as the tile's width needs.
              controls={
                <>
                  {quickOn(cfg, 'dim') && (
                    <SwitchBar
                      inline
                      label="view"
                      value={dim}
                      options={['2d', '3d']}
                      optionLabel={(o) => o.toUpperCase()}
                      onChange={(v) => patchConfig({ dim: v })}
                    />
                  )}
                  {quickOn(cfg, 'show') && (
                    <SwitchBar
                      inline
                      label="show"
                      value={show}
                      options={['line', 'surface', 'heatmap']}
                      optionDisabled={(o) => responseShowWhy(dim, o)}
                      onChange={(v) => patchConfig({ show: v })}
                    />
                  )}
                  {sliceable && quickOn(cfg, 'slice') && (
                    <SwitchBar
                      inline
                      label="lines per"
                      value={slice}
                      options={['time', 'dose']}
                      onChange={(v) => patchConfig({ slice: v })}
                    />
                  )}
                  {quickOn(cfg, 'yScale') && (
                    <SwitchBar
                      inline
                      label="scale"
                      value={yScale}
                      options={['gene', 'global']}
                      optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                      onChange={(v) => patchConfig({ yScale: v })}
                    />
                  )}
                </>
              }
            >
              {(gene) => (
                <FacetedPlot rows={surfaces} facetSel={facetSel}>
                  {(rows, facetKey) => (
                    <ResponseSurfaceView
                      row={rows.find((r) => r.uniqID === gene)}
                      dim={dim}
                      show={show}
                      look={look}
                      rolePalettes={responseRoles}
                      slice={slice}
                      valueRange={
                        yScale === 'global'
                          ? surfaceValueRange(upstream.cmp.rows, facetKey, rows)
                          : undefined
                      }
                      doseLabel={axisTitle('dose', units)}
                      timeLabel={axisTitle('time', units)}
                    />
                  )}
                </FacetedPlot>
              )}
            </GeneSwitch>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'bubble') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as BubbleConfig
    const dm = upstream.displayMap
    // Show the dose⇆time switch only when both axes exist; otherwise force the present one.
    const axes = axisChoices(upstream.cmp.rows)
    const axis = axes.length > 1 ? cfg.axis : (axes[0] ?? cfg.axis)
    // Rank by log₂FC, or by the significance column the Compare calls by (its P or Q value).
    const statType =
      (upstream.cmp.threshold ?? (upStep?.data.config as CompareConfig | undefined)?.threshold)
        ?.statType ?? 'pQ'
    const statName = statType === 'pP' ? 'P-value' : 'Q-value'
    const rank = cfg.rank ?? 'fc'
    const over = cfg.over ?? 'peak'
    const showAxis = axes.length > 1 && quickOn(cfg, 'axis')
    const showRank = quickOn(cfg, 'rank')
    const showOver = quickOn(cfg, 'over')
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {(showAxis || showRank || showOver) && (
            <SwitchStrip>
              {showAxis && (
                <SwitchBar
                  inline
                  label="axis"
                  value={cfg.axis}
                  options={['dose', 'time']}
                  onChange={(v) => patchConfig({ axis: v })}
                />
              )}
              {showRank && (
                <SwitchBar
                  inline
                  label="rank"
                  value={rank}
                  options={['fc', 'sig']}
                  optionLabel={(o) => (o === 'fc' ? 'log₂FC' : statName)}
                  onChange={(v) => patchConfig({ rank: v })}
                />
              )}
              {showOver && (
                <SwitchBar
                  inline
                  label="over levels"
                  value={over}
                  options={['peak', 'total']}
                  onChange={(v) => patchConfig({ over: v })}
                />
              )}
            </SwitchStrip>
          )}
          <div style={styles.stackBody}>
            {/* Full rows (no `sub`): base follows the All/Selected toggle via `focus`, and
                BubbleView appends any hovered/pinned gene to the gene axis. */}
            <FacetedPlot rows={upstream.cmp.rows} exclude={[axis]} facetSel={facetSel}>
              {(rows) => (
                <BubbleView
                  rows={rows}
                  axis={axis}
                  axisLabel={axisTitle(axis, units)}
                  topGenes={geneCapOn(cfg) ? cfg.topGenes : 0}
                  rank={rank === 'sig' ? statType : 'fc'}
                  over={over}
                  stat={statType}
                  sizeBy={cfg.sizeBy}
                  colorBy={cfg.colorBy}
                  outlineBy={cfg.outlineBy}
                  outlineColor={cfg.outlineColor}
                  asterisk={cfg.asterisk}
                  sigPalette={toPaletteRef(cfg.sigPalette) ?? BUBBLE_SIG_PALETTE}
                  displayMap={dm}
                  focus={focus}
                  key={cfg.orient ?? 'auto'}
                  orient={cfg.orient}
                  palette={paletteOf(cfg, 'fcObject')}
                />
              )}
            </FacetedPlot>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'tdr') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    // A Compare's measured log₂FC over dose × time, drawn as the Response plot draws a surface.
    const cfg = cfgSource as TdrConfig
    const dim = responseDim(cfg)
    const show = responseShow(cfg)
    const look = responseLook(cfg)
    const present = new Set(
      upstream.cmp.rows.filter((r) => r.dose != null && r.time != null).map((r) => r.uniqID)
    )
    if (!present.size) return <Empty text="Needs dose and time both active in the Compare." />
    // 3-D lines can run along dose (one per time) or along time (one per dose).
    const sliceable = dim === '3d' && show === 'line'
    const slice = cfg.slice ?? 'time'
    const yScale = cfg.yScale ?? 'gene'
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={styles.stackBody}>
            {/* One gene at a time — every gene, or the selected ones while any are selected. */}
            <GeneSwitch
              genes={pagerGenes(genes, present)}
              present={present}
              displayMap={upstream.displayMap}
              // The view / show / lines / scale switches on the gene switcher's row, before the
              // gene — one strip, wrapping only as the tile's width needs.
              controls={
                <>
                  {quickOn(cfg, 'dim') && (
                    <SwitchBar
                      inline
                      label="view"
                      value={dim}
                      options={['2d', '3d']}
                      optionLabel={(o) => o.toUpperCase()}
                      onChange={(v) => patchConfig({ dim: v })}
                    />
                  )}
                  {quickOn(cfg, 'show') && (
                    <SwitchBar
                      inline
                      label="show"
                      value={show}
                      options={['line', 'surface', 'heatmap']}
                      optionDisabled={(o) => responseShowWhy(dim, o)}
                      onChange={(v) => patchConfig({ show: v })}
                    />
                  )}
                  {sliceable && quickOn(cfg, 'slice') && (
                    <SwitchBar
                      inline
                      label="lines per"
                      value={slice}
                      options={['time', 'dose']}
                      onChange={(v) => patchConfig({ slice: v })}
                    />
                  )}
                  {quickOn(cfg, 'yScale') && (
                    <SwitchBar
                      inline
                      label="scale"
                      value={yScale}
                      options={['gene', 'global']}
                      optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                      onChange={(v) => patchConfig({ yScale: v })}
                    />
                  )}
                </>
              }
            >
              {(gene) => (
                // Over dose × time, so facet by the OTHER context dims (e.g. cell); without this a
                // gene's levels would mix cells.
                <FacetedPlot
                  rows={upstream.cmp.rows}
                  exclude={['dose', 'time']}
                  facetSel={facetSel}
                >
                  {(rows) => (
                    <TdrBody
                      rows={rows}
                      gene={gene}
                      std={cleanResult?.kind === 'standardize' ? cleanResult.std.rows : undefined}
                      global={yScale === 'global'}
                      dim={dim}
                      show={show}
                      look={look}
                      slice={slice}
                      rolePalettes={responseRoles}
                      doseLabel={axisTitle('dose', units)}
                      timeLabel={axisTitle('time', units)}
                    />
                  )}
                </FacetedPlot>
              )}
            </GeneSwitch>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'geneBar') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data tile and run it." />
    // On the scale every abundance plot shows Clean data on (see abScale).
    const scale = abScale
    const barCfg = cfgSource as BarConfig
    return (
      <div style={styles.chart}>
        <GeneBarTile
          condTitle={condTitle}
          key={barCfg.orient ?? 'auto'}
          std={presentStd(upstream.std, scale)}
          scale={scale}
          genes={genes}
          config={barCfg}
          // The quick switches on the gene switcher's row, before the gene.
          controls={
            <>
              {quickOn(barCfg, 'yScale') && (
                <SwitchBar
                  inline
                  label="scale"
                  value={barCfg.yScale ?? 'gene'}
                  options={['gene', 'global']}
                  optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                  onChange={(v) => patchConfig({ yScale: v })}
                />
              )}
              {quickOn(barCfg, 'sampleOrder') && (
                <SwitchBar
                  inline
                  label="sort"
                  value={sampleOrderOf(barCfg)}
                  options={SAMPLE_ORDERS}
                  onChange={(v) => patchConfig({ sampleOrder: v })}
                />
              )}
            </>
          }
        />
      </div>
    )
  }
  if (kind === 'pca') {
    const cfg = cfgSource as ClusterConfig
    // What marks the data, and the territory outlining it — from old configs too (clusterLook).
    const { data: display, territory } = clusterLook(cfg)
    // Every write sets both, so an old combined 'territory' display becomes the two settings.
    const patchLook = (next: Partial<ReturnType<typeof clusterLook>>): void =>
      patchConfig({
        display: next.data ?? display,
        outline: next.territory ?? territory
      })
    // All three plots are PCA notions, so the choice is only offered (and only honoured) for PCA.
    const plot = cfg.method === 'pca' ? (cfg.plot ?? 'pc') : 'pc'
    const scree = plot === 'scree'
    // Colour-by options are the Standardize's active conditions. Keep the current value
    // selectable if it's off-list.
    const active: ConditionKey[] =
      upstream?.kind === 'standardize'
        ? upstream.std.activeConditions
        : (VALID_CONDITIONS as ConditionKey[])
    // `cluster` sits alongside the conditions: same question ("what do the colours mean?"), one
    // control. A stored colorBy that isn't in the upstream's conditions stays selectable.
    const byCluster = cfg.colorBy === CLUSTER_COLOR
    const conds: ClusterColorBy[] = active.includes(cfg.colorBy as ConditionKey)
      ? active
      : byCluster
        ? active
        : [cfg.colorBy, ...active]
    const colorOpts: string[] = [...conds, CLUSTER_COLOR]
    const clusterOn = cfg.clusterOn ?? 'coords'
    const clusterCount = cfg.clusterCount ?? 'fixed'
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {cfg.method === 'pca' && quickOn(cfg, 'plot', 'pca') && (
              <SwitchBar
                label="plot"
                value={PLOT_LABEL[plot]}
                options={Object.values(PLOT_LABEL)}
                onChange={(v) =>
                  patchConfig({
                    plot: (Object.keys(PLOT_LABEL) as Array<ClusterConfig['plot'] & string>).find(
                      (k) => PLOT_LABEL[k] === v
                    )
                  })
                }
              />
            )}
            {/* Everything below styles the embedding scatter, which the scree plot replaces. */}
            {!scree && quickOn(cfg, 'colorBy', 'pca') && (
              <SwitchBar
                label="colour by"
                value={cfg.colorBy}
                options={colorOpts}
                optionLabel={(o) => (o === CLUSTER_COLOR ? o : condLabel(o as ConditionKey))}
                onChange={(v) => patchConfig({ colorBy: v })}
              />
            )}
            {/* Both cluster knobs only mean anything while the colours ARE clusters. */}
            {!scree && byCluster && quickOn(cfg, 'clusterOn', 'pca') && (
              <SwitchBar
                label="cluster on"
                value={clusterOn}
                options={['coords', 'features']}
                onChange={(v) => patchConfig({ clusterOn: v as ClusterConfig['clusterOn'] })}
              />
            )}
            {!scree && byCluster && quickOn(cfg, 'clusterCount', 'pca') && (
              <SwitchBar
                label="count"
                value={clusterCount}
                options={['fixed', 'conditions', 'auto']}
                onChange={(v) => patchConfig({ clusterCount: v as ClusterConfig['clusterCount'] })}
              />
            )}
            {!scree && quickOn(cfg, 'display', 'pca') && (
              <SwitchBar
                label="data"
                value={display}
                options={['replicate', 'centroid']}
                onChange={(v) => patchLook({ data: v as 'replicate' | 'centroid' })}
              />
            )}
            {!scree && quickOn(cfg, 'territory', 'pca') && (
              <SwitchBar
                label="territory"
                value={territory}
                options={['hull', 'gaussian', 'none']}
                onChange={(v) => patchLook({ territory: v as 'hull' | 'gaussian' | 'none' })}
              />
            )}
            {/* PCA computation parameters (scaling, missing, normalize, features, transform,
                replicates) live in the tile's settings dialog (gear), not inline. */}
          </div>
          <div style={styles.stackBody}>{body}</div>
        </div>
      </div>
    )
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data tile and run it." />
    // Drawn from the plot's run (the embedding, computed in the worker). A result from before the
    // cluster computed in its run (a bare marker) has no embedding: run it.
    if (plotRun?.kind !== 'cluster')
      return withBar(
        <PlotNotRun
          status="idle"
          onRun={() => {
            const g = useGraph.getState()
            void (child ? g.runPlotChild(node.id, child.id) : g.runNode(node.id))
          }}
        />
      )
    return withBar(
      <ClusterTile
        condTitle={condTitle}
        categorical={categoricalOf(cfg)}
        cluster={plotRun.cluster}
        colorBy={cfg.colorBy}
        display={display}
        territory={territory}
        plot={plot}
        loadings={cfg.loadings}
        // two conditions picked under the simple legend: drawn by the complex legend's colour
        // and shade (clusterTwoConds)
        legend={clusterTwoConds(cfg) ? 'complex' : 'simple'}
        look={clusterStyle(cfg)}
        schemeColor={clusterTwoConds(cfg)?.color}
        schemeShade={clusterTwoConds(cfg)?.shade}
        schemeArrow={clusterTwoConds(cfg)?.arrow}
      />
    )
  }
  if (kind === 'enrich') {
    if (upstream?.kind !== 'compare')
      return <Empty text="Connect a Compare or Curve fit tile and run it." />
    const cfg = cfgSource as EnrichConfig
    const method = cfg.method ?? 'ora'
    // 'ridge' is GSEA-only; fall back to dot if a persisted ridge style meets ORA.
    const style = cfg.style === 'ridge' && method !== 'gsea' ? 'dot' : (cfg.style ?? 'dot')
    const styleOpts = method === 'gsea' ? ['dot', 'bar', 'ridge'] : ['dot', 'bar']
    const ann = upstream.annotationMap ?? {}
    const cats = upstream.keggCategories ?? NO_CATS
    // Only offer term sets these genes actually carry. If the saved source isn't one of them the
    // tile falls back through ENRICH_FALLBACK to one that is, rather than an error the user can't
    // act on — display only, the config keeps what it had (same as the GSEA-only ridge style
    // falling back to dot above).
    const sources = enrichSourcesPresent(ann, cats)
    const saved = cfg.source ?? 'go'
    const source = resolveEnrichSource(saved, sources) ?? saved
    const unmet = unmetRequirement('enrich', { ...cfg, source }, factsOf(upstream))
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'method') && (
              <SwitchBar
                label="method"
                value={method}
                options={['ora', 'gsea']}
                onChange={(v) => patchConfig({ method: v })}
              />
            )}
            {quickOn(cfg, 'source') && sources.length > 1 && (
              <SwitchBar
                label="terms"
                value={source}
                options={sources}
                // Short on the tile: the species note ("(human)") is left to the settings.
                optionLabel={(o) =>
                  (ENRICH_SOURCE_LABEL[o as EnrichSource] ?? o).replace(/\s*\(human\)$/, '')
                }
                onChange={(v) => patchConfig({ source: v })}
              />
            )}
            {quickOn(cfg, 'style') && (
              <SwitchBar
                label="style"
                value={style}
                options={styleOpts}
                onChange={(v) => patchConfig({ style: v })}
              />
            )}
          </div>
          <div style={styles.stackBody}>{body}</div>
        </div>
      </div>
    )
    if (unmet) return withBar(<Empty text={unmet} />)
    return withBar(
      <FacetedPlot rows={upstream.cmp.rows} facetSel={facetSel}>
        {(facetRows, facetKey) => {
          // From the plot's run: this facet's terms for the method and source on show (every one
          // was computed), cut to the top N — so switching any of them only re-renders.
          const all =
            plotRun?.kind === 'enrich'
              ? plotRun.facets[facetKey]?.[`${method}|${source}`]
              : undefined
          if (!all) return <Empty text="No enrichment for these terms here — re-run the plot." />
          const top = cfg.topTerms > 0 ? cfg.topTerms : 15
          return (
            <Built
              build={() => ({ ...all, up: all.up.slice(0, top), down: all.down.slice(0, top) })}
              deps={[all, top]}
            >
              {(enrich) => (
                <EnrichView
                  enrich={enrich}
                  style={style}
                  measure={fcMeasure(
                    upCompareCfg && normalizeCompareConfig(upCompareCfg).analysis,
                    upCompareCfg?.detection,
                    upCompareCfg?.surface
                  )}
                  comparison={comparisonOf(facetRows)}
                  effectColors={effectsOf(cfg, upCompareCfg, cfg.effectColors)}
                />
              )}
            </Built>
          )
        }}
      </FacetedPlot>
    )
  }
  if (kind === 'string') {
    if (upstream?.kind !== 'compare')
      return <Empty text="Connect a Compare or Curve fit tile and run it." />
    const cfg = cfgSource as StringConfig
    const maxGenes = cfg.maxGenes > 0 ? cfg.maxGenes : 40
    const addInteractors = cfg.addInteractors ?? false
    // Unset = auto: the highest level at which this setting has a network (from the view's read);
    // medium before the read is back.
    const known = stringLevels
    const confidence: StringLevel = cfg.confidence ?? (known ? autoStringLevel(known) : 'medium')
    // Species: a manual override, else the dominant taxon learned from the annotation fetch.
    const ann = upstream.annotationMap ?? {}
    const species = cfg.species && cfg.species > 0 ? cfg.species : dominantTaxon(ann)
    // A custom cap set in the gear shows as its own option so the bar never lies. One read covers
    // them all (and the export's), so switching between them only re-renders.
    const caps = stringCapOptions(maxGenes)
    const geneOpts = caps.map(String)
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'confidence') && (
              <SwitchBar
                label="confidence"
                // No level has a network → none is picked (every one is greyed).
                value={known && known.size === 0 ? '' : confidence}
                options={['low', 'medium', 'high', 'highest']}
                onChange={(v) => patchConfig({ confidence: v })}
                // A level with no network can't be picked (only known for a query-only network).
                optionDisabled={(o) =>
                  known && !known.has(o as StringLevel)
                    ? 'No interactions among the query genes at this confidence'
                    : undefined
                }
              />
            )}
            {quickOn(cfg, 'maxGenes') && (
              <SwitchBar
                label="max genes"
                value={String(maxGenes)}
                options={geneOpts}
                onChange={(v) => patchConfig({ maxGenes: Number(v) })}
              />
            )}
            {quickOn(cfg, 'addInteractors') && (
              <SwitchBar
                label="interactors"
                value={addInteractors ? 'add connected' : 'query only'}
                options={['query only', 'add connected']}
                onChange={(v) => patchConfig({ addInteractors: v === 'add connected' })}
              />
            )}
          </div>
          <div style={styles.stackBody}>{body}</div>
        </div>
      </div>
    )
    const unmet = unmetRequirement('string', cfg, factsOf(upstream))
    if (unmet || !species) return withBar(<Empty text={unmet ?? 'No species detected.'} />)
    return withBar(
      <FacetedPlot rows={upstream.cmp.rows} facetSel={facetSel}>
        {(rows, facetKey) => (
          <StringView
            rows={rows}
            displayMap={upstream.displayMap}
            annotationMap={ann}
            // From the plot's run: this facet's network for every setting (graph/plotRun.ts).
            all={plotRun?.kind === 'string' ? plotRun.facets[facetKey] : undefined}
            level={confidence}
            maxGenes={maxGenes}
            capOptions={plotRun?.kind === 'string' ? plotRun.caps : caps}
            addInteractors={addInteractors}
            onLevels={setStringLevels}
            palette={paletteOf(cfg, 'fcObject')}
          />
        )}
      </FacetedPlot>
    )
  }
  if (kind === 'qc') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data tile and run it." />
    const cfg = cfgSource as QcConfig
    const metric = cfg.metric ?? 'intensity'
    // Plot type is metric-dependent: distributions (intensity/CV) render as violin/box; a
    // per-sample count (proteins) only makes sense as a bar.
    const plotOpts = qcPlotOptions(metric)
    const plot = plotOpts.includes(cfg.plot) ? cfg.plot : plotOpts[0]
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'metric') && (
              <SwitchBar
                label="metric"
                value={QC_METRIC_LABEL[metric]}
                options={['intensity', 'CV', '# proteins']}
                onChange={(v) => {
                  const m = QC_LABEL_METRIC[v]
                  const opts = qcPlotOptions(m)
                  // Keep the plot type if the new metric still allows it, else snap to its default.
                  patchConfig({ metric: m, plot: opts.includes(plot) ? plot : opts[0] })
                }}
              />
            )}
            {/* Only offer the plot toggle when the metric supports more than one type. */}
            {plotOpts.length > 1 && quickOn(cfg, 'plot') && (
              <SwitchBar
                label="plot"
                value={plot}
                options={plotOpts}
                onChange={(v) => patchConfig({ plot: v as QcConfig['plot'] })}
              />
            )}
            {metric === 'proteins' && quickOn(cfg, 'yScale') && (
              <SwitchBar
                label="scale"
                value={cfg.yScale ?? 'global'}
                options={['range', 'global']}
                optionLabel={(o) => (o === 'range' ? 'adjusted' : 'global')}
                onChange={(v) => patchConfig({ yScale: v })}
              />
            )}
            {quickOn(cfg, 'sampleOrder') && (
              <SwitchBar
                label="sort"
                value={sampleOrderOf(cfg)}
                options={SAMPLE_ORDERS}
                onChange={(v) => patchConfig({ sampleOrder: v })}
              />
            )}
          </div>
          <div style={styles.stackBody}>
            <QcTile
              condTitle={condTitle}
              categorical={categoricalOf(cfg)}
              std={upstream.std}
              metric={metric}
              plot={plot}
              scale={abScale}
              color={cfg.color}
              colorConds={qcColorConds(
                cfg,
                upstream.std.activeConditions,
                primaryColorLevels(upstream.std)
              )}
              fit={metric === 'proteins' && cfg.yScale === 'range'}
              sampleOrder={sampleOrderOf(cfg)}
            />
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'corr') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data tile and run it." />
    const cfg = cfgSource as CorrConfig
    return (
      <div style={styles.chart}>
        <CorrTile
          std={upstream.std}
          cluster={cfg.cluster ?? true}
          scale={abScale}
          palette={paletteOf(cfg, 'corr', 'palette')}
        />
      </div>
    )
  }
  return <Empty text="No output." />
}

// QC metric ⇆ display-label maps for the in-tile metric SwitchBar.
const QC_METRIC_LABEL: Record<QcMetric, string> = {
  intensity: 'intensity',
  cv: 'CV',
  proteins: '# proteins'
}
const QC_LABEL_METRIC: Record<string, QcMetric> = {
  intensity: 'intensity',
  CV: 'cv',
  '# proteins': 'proteins'
}
/** Plot types valid for a metric: distributions → box/violin (box first = default); a per-sample
 *  count → bar only. */
function qcPlotOptions(metric: QcMetric): QcConfig['plot'][] {
  return metric === 'proteins' ? ['bar'] : ['box', 'violin']
}

function Empty({ text }: { text: string }): ReactNode {
  return <div style={styles.empty}>{text}</div>
}

/** A plot that hasn't run (or whose run failed): why, and a button to run just this plot. */
function PlotNotRun({
  status,
  error,
  onRun
}: {
  status: StepStatus
  error?: string
  onRun: () => void
}): ReactNode {
  if (status === 'running')
    return (
      // The progress spinner turns on the compositor, so it keeps going while the UI thread is busy.
      <div style={{ ...styles.empty, gap: 8 }}>
        <StatusIcon kind="progress" />
        Running…
      </div>
    )
  return (
    <div style={{ ...styles.empty, flexDirection: 'column', gap: 10 }}>
      <span>
        {status === 'error'
          ? (error ?? 'This plot failed to run.')
          : 'Not run yet — run this plot to view it.'}
      </span>
      <button style={styles.runBtn} onClick={onRun}>
        {status === 'error' ? 'Retry' : 'Run'}
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  chart: { height: '100%', minHeight: 0, position: 'relative' },
  runBtn: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '5px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // A SwitchBar (or other in-plot control) stacked above the chart, which fills the rest.
  stack: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  stackBody: { flex: 1, minHeight: 0 },
  loadInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12,
    color: UI.text,
    fontSize: 13
  },
  loadLabel: { color: UI.textMuted, width: 100, display: 'inline-block' },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 120,
    color: UI.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: 16
  }
}
