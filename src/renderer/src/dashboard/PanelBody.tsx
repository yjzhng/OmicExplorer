/** Renders a single tile's output (table or plot) for the results dashboard.
 *  Salvaged from the retired OutputDock's OutputBody: the per-kind dispatch and
 *  the comparison/contrast column builders live here now. */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import {
  buildDR,
  buildFcHeatmap,
  buildMA,
  buildScatter,
  buildIntensityScatter,
  buildVolcano,
  facetContextDims,
  type CompareResultRow,
  type ConditionKey,
  type ContrastResultRow,
  type QcMetric,
  type StandardizeResult
} from '../engine'
import { BubbleView } from '../ui/BubbleView'
import { DataTableView, fixed, type Column } from '../ui/DataTableView'
import { DRView } from '../ui/DRView'
import { DumbbellView } from '../ui/DumbbellView'
import { MAView } from '../ui/MAView'
import { ClusterTile } from './ClusterTile'
import { CorrTile } from './CorrTile'
import { QcTile } from './QcTile'
import { GOI_TOGGLE_KINDS } from './goi'
import { GeneBarTile } from './GeneBarTile'
import { ScatterView } from '../ui/ScatterView'
import { SwitchBar } from './SwitchBar'
import { TdrTile } from './TdrTile'
import { divergeStyle, heatStyle, valueRange } from '../ui/colormap'
import { UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { VolcanoView } from '../ui/VolcanoView'
import { FacetedPlot } from './FacetedPlot'
import { HeatmapTile } from './HeatmapTile'
import { FcHeatmapTile } from './FcHeatmapTile'
import { focusIds, resolveChildFocus, resolveFocus } from '../graph/focus'
import { useGraph } from '../graph/store'
import {
  isStep,
  type BarConfig,
  type BubbleConfig,
  type CompareConfig,
  type DRConfig,
  type DumbbellConfig,
  type HeatmapConfig,
  type LoadConfig,
  type MAConfig,
  type NodeResult,
  type ClusterConfig,
  type CorrConfig,
  type PlotChild,
  type QcConfig,
  type ScatterConfig,
  type StepNode,
  type VolcanoConfig
} from '../graph/types'

type StdRow = StandardizeResult['rows'][number]

/** The viridis `value` heat style for a standardize result, scaled globally across every value
 *  (log10 when the values look like raw intensity). Shared by the matrix cells and the long view. */
function makeValueHeat(std: StandardizeResult): (v: unknown) => CSSProperties | undefined {
  return heatStyle(valueRange(std.rows.map((r) => r.value)))
}

/** Standardized-table columns: each condition/replicate column is shown only when the data
 *  carries a value for it — inactive (empty) conditions are dropped rather than shown blank. */
function stdColumns(rows: StdRow[]): Column[] {
  const present = (c: 'strain' | 'cmpd' | 'dose' | 'time' | 'rep'): boolean =>
    c === 'dose' || c === 'time' || c === 'rep'
      ? rows.some((r) => r[c] != null)
      : rows.some((r) => r[c] !== '' && r[c] != null)
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  if (present('strain')) cols.push({ key: 'strain', label: 'strain' })
  if (present('cmpd')) cols.push({ key: 'cmpd', label: 'cmpd' })
  if (present('dose')) cols.push({ key: 'dose', label: 'dose', align: 'right' })
  if (present('time')) cols.push({ key: 'time', label: 'time', align: 'right' })
  if (present('rep')) cols.push({ key: 'rep', label: 'rep', align: 'right' })
  cols.push({ key: 'value', label: 'value', align: 'right', format: fixed(3) })
  return cols
}

/** Pivot the tidy standardized rows into a gene × sample matrix: one row per uniqID, one column
 *  per sample. The samplesheet's sample names aren't retained in the standardized rows, so a
 *  sample is identified (and labelled) by its condition combination + replicate. */
function standardizeMatrix(std: StandardizeResult): {
  columns: Column[]
  rows: Record<string, unknown>[]
} {
  const dm = std.displayMap
  const conds = std.activeConditions
  const combo = (r: StdRow): string =>
    [...conds.map((c) => String(r[c] ?? '')), `r${r.rep ?? ''}`].join('')
  const label = (r: StdRow): string => {
    const parts = conds.map((c) => String(r[c] ?? '')).filter((x) => x !== '')
    if (r.rep != null) parts.push(`r${r.rep}`)
    return parts.join(' · ') || 'sample'
  }
  const colKeyOf = new Map<string, string>()
  const labelOf = new Map<string, string>()
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
  const heat = makeValueHeat(std)
  const columns: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...sampleKeys.map(
      (k): Column => ({
        key: k,
        label: labelOf.get(k) ?? k,
        align: 'right',
        format: fixed(3),
        cellStyle: heat
      })
    )
  ]
  return { columns, rows: uidOrder.map((u) => byUid.get(u)!) }
}

/** The standardized table with a Long ⇆ Matrix (gene × sample) view toggle. */
function StdTable({ std }: { std: StandardizeResult }): ReactNode {
  const [view, setView] = useState<'matrix' | 'long'>('matrix')
  const [colored, setColored] = useState(true)
  const long = useMemo(() => {
    const heat = makeValueHeat(std)
    return {
      // Colour the long view's `value` column with the same viridis heat scale as the matrix.
      columns: stdColumns(std.rows).map((c) => (c.key === 'value' ? { ...c, cellStyle: heat } : c)),
      rows: std.rows.map((r) => ({ ...r, gene: std.displayMap[r.uniqID] ?? '' }))
    }
  }, [std])
  const matrix = useMemo(() => standardizeMatrix(std), [std])
  const cur = view === 'matrix' ? matrix : long
  // Drop the per-cell heat styling when colouring is off.
  const columns = colored
    ? cur.columns
    : cur.columns.map((c) => (c.cellStyle ? { ...c, cellStyle: undefined } : c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <SwitchBar
          label="View"
          value={view === 'matrix' ? 'Matrix' : 'Long'}
          options={['Matrix', 'Long']}
          onChange={(v) => setView(v === 'Matrix' ? 'matrix' : 'long')}
        />
        <ToggleSwitch label="Colour" on={colored} onChange={setColored} />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view so the table fully remounts on toggle — otherwise its internal sort/filter
            state (and the Long view's duplicate uniqID row keys) leak across and mis-render. */}
        <DataTableView key={view} columns={columns} rows={cur.rows} />
      </div>
    </div>
  )
}

/** A labelled sliding on/off switch, styled to sit in the SwitchBar row. */
function ToggleSwitch({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
}): ReactNode {
  return (
    <div style={toggle.bar}>
      <span style={toggle.label}>{label}</span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={{
          ...toggle.track,
          background: on ? UI.accent : UI.border,
          justifyContent: on ? 'flex-end' : 'flex-start'
        }}
      >
        <span style={toggle.knob} />
      </button>
    </div>
  )
}

const toggle: Record<string, CSSProperties> = {
  bar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  label: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  track: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 32,
    height: 18,
    borderRadius: 9,
    padding: 2,
    border: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
    transition: 'background 120ms'
  },
  knob: {
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
  }
}

/** Columns for a comparison table, adapted to which conditions the rows carry
 *  and to the analysis (two-way's log2FC is an interaction term). */
function compareColumns(rows: CompareResultRow[], analysis: CompareConfig['analysis']): Column[] {
  const present = (c: 'strain' | 'cmpd' | 'dose' | 'time'): boolean =>
    rows.some((r) => r[c] !== '' && r[c] != null)
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  // Show the comparison label only when several coexist (e.g. two-way factor combos).
  if (new Set(rows.map((r) => r.comparison)).size > 1) {
    cols.push({ key: 'comparison', label: 'comparison' })
  }
  if (present('strain')) cols.push({ key: 'strain', label: 'strain' })
  if (present('cmpd')) cols.push({ key: 'cmpd', label: 'cmpd' })
  if (present('dose')) cols.push({ key: 'dose', label: 'dose', align: 'right' })
  if (present('time')) cols.push({ key: 'time', label: 'time', align: 'right' })
  cols.push(
    {
      key: 'log2FC',
      label: analysis === 'two_way_anova' ? 'interaction' : 'log2FC',
      align: 'right',
      format: fixed(3)
    },
    { key: 'pP', label: 'pP', align: 'right', format: fixed(3) },
    { key: 'pQ', label: 'pQ', align: 'right', format: fixed(3) },
    { key: 'signf', label: 'signf' },
    { key: 'effect', label: 'effect' }
  )
  return cols
}

/** Pivot a comparison result into a gene × comparison-column matrix whose cells are log2FC —
 *  the tabular twin of the log₂FC heatmap. Reuses `buildFcHeatmap` (no clustering, all genes)
 *  so the columns line up exactly with the Fc heatmap; cells share its diverging RdBu scale. */
function compareMatrix(
  rows: CompareResultRow[],
  displayMap: Record<string, string>
): { columns: Column[]; rows: Record<string, unknown>[]; absMax: number } {
  const h = buildFcHeatmap(rows, { displayMap, cluster: false })
  const cell = divergeStyle(h.absMax)
  const columns: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...h.columns.map(
      (label, i): Column => ({
        key: `m${i}`,
        label,
        align: 'right',
        format: fixed(3),
        cellStyle: cell
      })
    )
  ]
  const out = h.geneIds.map((gid, ri) => {
    const row: Record<string, unknown> = { uniqID: gid, gene: h.genes[ri] }
    h.columns.forEach((_, ci) => (row[`m${ci}`] = h.z[ri][ci]))
    return row
  })
  return { columns, rows: out, absMax: h.absMax }
}

/** The comparison table with a Long ⇆ Matrix (gene × comparison, cells = log2FC) view toggle,
 *  mirroring the standardized table. Long is the stats view (log2FC, p, effect); Matrix is the
 *  wide fold-change pivot that reads like the Fc heatmap. */
function CompareTable({
  rows,
  analysis,
  displayMap,
  comparisons
}: {
  rows: CompareResultRow[]
  analysis: CompareConfig['analysis']
  displayMap: Record<string, string>
  comparisons: string[]
}): ReactNode {
  const [view, setView] = useState<'long' | 'matrix'>('long')
  const [colored, setColored] = useState(true)
  const long = useMemo(
    () => ({
      columns: compareColumns(rows, analysis),
      rows: rows.map((r) => ({ ...r, gene: displayMap[r.uniqID] ?? '' }))
    }),
    [rows, analysis, displayMap]
  )
  const matrix = useMemo(() => compareMatrix(rows, displayMap), [rows, displayMap])
  const cur = view === 'matrix' ? matrix : long
  const columns = colored
    ? cur.columns
    : cur.columns.map((c) => (c.cellStyle ? { ...c, cellStyle: undefined } : c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <SwitchBar
          label="View"
          value={view === 'matrix' ? 'Matrix' : 'Long'}
          options={['Long', 'Matrix']}
          onChange={(v) => setView(v === 'Matrix' ? 'matrix' : 'long')}
        />
        {/* Colour only means something in the Matrix view (the Long stats table isn't heat-mapped). */}
        {view === 'matrix' && <ToggleSwitch label="Colour" on={colored} onChange={setColored} />}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view so the table fully remounts on toggle — its internal sort/filter state (and
            the Long view's duplicate uniqID row keys) must not leak across. */}
        <DataTableView
          key={view}
          columns={columns}
          rows={cur.rows}
          caption={`Comparison — ${comparisons.join(', ')}`}
        />
      </div>
    </div>
  )
}

/** Columns for a contrast (compare-vs-compare) table. */
function contrastColumns(rows: ContrastResultRow[]): Column[] {
  const present = (c: 'strain' | 'dose' | 'time'): boolean =>
    rows.some((r) => r[c] != null && r[c] !== '')
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  if (present('strain')) cols.push({ key: 'strain', label: 'strain' })
  if (present('dose')) cols.push({ key: 'dose', label: 'dose', align: 'right' })
  if (present('time')) cols.push({ key: 'time', label: 'time', align: 'right' })
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
  goiOnly = false,
  facetSel
}: {
  node: StepNode
  edges: Edge[]
  results: Record<string, NodeResult>
  /** when set, render this group subcard instead of the node's own output; `node` is the
   *  group tile, so its edge still supplies the shared upstream. */
  child?: PlotChild
  /** restrict the plot to the focus (GOI) genes only, instead of all genes (see the
   *  tile-header toggle; only meaningful for GOI_TOGGLE_KINDS). */
  goiOnly?: boolean
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
  // Effective focus genes (resolved through none/inherit/custom) that this plot applies.
  const nodes = useGraph((s) => s.nodes)
  const steps = nodes.filter(isStep)
  const genes = focusIds(
    child ? resolveChildFocus(child, node.id, steps, edges) : resolveFocus(node.id, steps, edges)
  )
  // Linked-selection pins — some plots (e.g. the gene bar) render off a selected gene even
  // when no focus/GOI genes are set.
  const pinnedIds = useSelection((s) => s.pinnedIds)
  // GOI-subset mode: keep only rows whose feature is a focus gene. `sub` is a no-op in
  // all-genes mode. Guarded below so subset mode with no GOI shows guidance, not an empty plot.
  const focusSet = new Set(genes)
  const sub = <T extends { uniqID: string }>(rows: T[]): T[] =>
    goiOnly ? rows.filter((r) => focusSet.has(r.uniqID)) : rows
  if (GOI_TOGGLE_KINDS.has(kind) && goiOnly && genes.length === 0)
    return <Empty text="No GOI genes selected — set focus genes on this tile or upstream." />

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
  if (kind === 'standardize') {
    if (result?.kind !== 'standardize')
      return <Empty text="Run this tile to produce the standardized table." />
    return <StdTable std={result.std} />
  }
  if (kind === 'compare') {
    if (result?.kind !== 'compare')
      return <Empty text="Run this tile to produce the comparison table." />
    const analysis = (node.data.config as CompareConfig).analysis
    return (
      <CompareTable
        rows={result.cmp.rows}
        analysis={analysis}
        displayMap={result.displayMap}
        comparisons={result.cmp.comparisons}
      />
    )
  }
  if (kind === 'contrast') {
    if (result?.kind !== 'contrast')
      return <Empty text="Connect a Compare tile, pick two levels to contrast, and run." />
    const dm = result.displayMap
    const rows = result.ctr.rows.map((r) => ({ ...r, gene: dm[r.uniqID] ?? '' }))
    return (
      <DataTableView
        columns={contrastColumns(result.ctr.rows)}
        rows={rows}
        caption={`Contrast — ${result.ctr.comparisons.join(', ')}`}
      />
    )
  }
  if (kind === 'volcano') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as VolcanoConfig
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={sub(upstream.cmp.rows)} facetSel={facetSel}>
          {(rows) => (
            <VolcanoView
              volcano={buildVolcano(rows, {
                statType: cfg.statType,
                fcLow: -1,
                fcHigh: 1,
                statMin: 1.3,
                displayMap: dm
              })}
              focus={genes}
            />
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'heatmap') {
    const cfg = cfgSource as HeatmapConfig
    // Compare upstream → log2FC heatmap (every comparison/context is a column, no faceting).
    if (upstream?.kind === 'compare') {
      return (
        <div style={styles.chart}>
          <FcHeatmapTile
            rows={upstream.cmp.rows}
            displayMap={upstream.displayMap}
            maxGenes={cfg.maxGenes}
            focus={goiOnly ? genes : []}
            orient={cfg.orient}
          />
        </div>
      )
    }
    // Standardize upstream → intensity heatmap (genes × samples).
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Standardize or Compare tile and run it." />
    return (
      <div style={styles.chart}>
        <HeatmapTile
          std={upstream.std}
          maxGenes={cfg.maxGenes}
          log10={cfg.log10}
          focus={goiOnly ? genes : []}
          orient={cfg.orient}
        />
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
              <ScatterView
                scatter={buildIntensityScatter(rows, { displayMap: dm })}
                labelTop={cfg.labelTop}
              />
            )}
          </FacetedPlot>
        </div>
      )
    }
    if (upstream?.kind !== 'contrast')
      return <Empty text="Connect a Compare or Contrast tile and run it." />
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={upstream.ctr.rows} facetSel={facetSel}>
          {(rows) => (
            <ScatterView scatter={buildScatter(rows, { displayMap: dm })} labelTop={cfg.labelTop} />
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
        {/* Full rows (no `sub`): the base list follows the ALL/GOI toggle via `focus`,
            and DumbbellView appends any hovered/pinned gene from the full set. */}
        <FacetedPlot rows={upstream.ctr.rows} facetSel={facetSel}>
          {(rows) => (
            <DumbbellView
              rows={rows}
              topGenes={cfg.topGenes}
              displayMap={dm}
              focus={goiOnly ? genes : []}
              orient={cfg.orient}
            />
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'ma') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as MAConfig
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={sub(upstream.cmp.rows)} facetSel={facetSel}>
          {(rows) => (
            <MAView
              ma={buildMA(rows, { fcLow: cfg.fcLow, fcHigh: cfg.fcHigh, displayMap: dm })}
              focus={genes}
            />
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'dr') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as DRConfig
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <SwitchBar
            label="axis"
            value={cfg.axis}
            options={['dose', 'time']}
            onChange={(v) => patchConfig({ axis: v })}
          />
          <div style={styles.stackBody}>
            {/* DR/TR always draws every gene as a faint background curve; the ALL/GOI
                toggle only changes WHICH curves are coloured (top-N by response, or the
                GOI set) — it must not hide genes, so use the full rows (no `sub`). */}
            <FacetedPlot rows={upstream.cmp.rows} exclude={[cfg.axis]} facetSel={facetSel}>
              {(rows) => (
                <DRView
                  dr={buildDR(rows, {
                    axis: cfg.axis,
                    topGenes: cfg.topGenes,
                    displayMap: dm,
                    focus: goiOnly ? genes : []
                  })}
                />
              )}
            </FacetedPlot>
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'bubble') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as BubbleConfig
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <SwitchBar
            label="axis"
            value={cfg.axis}
            options={['dose', 'time']}
            onChange={(v) => patchConfig({ axis: v })}
          />
          <div style={styles.stackBody}>
            {/* Full rows (no `sub`): base follows the ALL/GOI toggle via `focus`, and
                BubbleView appends any hovered/pinned gene to the gene axis. */}
            <FacetedPlot rows={upstream.cmp.rows} exclude={[cfg.axis]} facetSel={facetSel}>
              {(rows) => (
                <BubbleView
                  rows={rows}
                  axis={cfg.axis}
                  topGenes={cfg.topGenes}
                  displayMap={dm}
                  focus={goiOnly ? genes : []}
                  orient={cfg.orient}
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
    // Focus (GOI) genes drive TDR; with none set, fall back to the linked selection — a gene
    // clicked in the FC matrix table (or any plot) — so a single selected gene plots its TDR.
    const present = new Set(upstream.cmp.rows.map((r) => r.uniqID))
    const tdrGenes = genes.length > 0 ? genes : [...pinnedIds].filter((id) => present.has(id))
    if (tdrGenes.length === 0)
      return (
        <Empty text="Set a focus gene (here or on Standardize), or select a gene, to plot TDR." />
      )
    // TDR uses both axes (dose × time) for one gene, so it shows up to 3, switched by tab.
    if (tdrGenes.length > 3)
      return (
        <Empty
          text={`TDR shows up to 3 genes — ${tdrGenes.length} selected. Narrow to 3 or fewer.`}
        />
      )
    return (
      <div style={styles.chart}>
        {/* TDR plots over dose × time, so facet by the OTHER context dims (e.g. strain);
            without this a gene's curve mixes strains and zig-zags (two points per dose). */}
        <FacetedPlot rows={upstream.cmp.rows} exclude={['dose', 'time']} facetSel={facetSel}>
          {(rows) => <TdrTile rows={rows} genes={tdrGenes} displayMap={upstream.displayMap} />}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'geneBar') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Standardize tile and run it." />
    // Show for focus (GOI) genes OR a selected (pinned) gene present in the data — GeneSwitch
    // appends the pinned gene as a tab, so either source can drive the bars.
    if (genes.length === 0) {
      const present = new Set(upstream.std.rows.map((r) => r.uniqID))
      const hasSel = [...pinnedIds].some((id) => present.has(id))
      if (!hasSel)
        return <Empty text="Set focus genes (here or on Standardize), or select a gene, to plot the bars." />
    }
    return (
      <div style={styles.chart}>
        <GeneBarTile std={upstream.std} genes={genes} orient={(cfgSource as BarConfig).orient} />
      </div>
    )
  }
  if (kind === 'pca') {
    const cfg = cfgSource as ClusterConfig
    const display = cfg.display ?? 'centroid'
    // Colour-by options depend on the upstream: a Standardize's active conditions, or a
    // Compare's context dims. Keep the current value selectable if it's off-list.
    const active: ConditionKey[] =
      upstream?.kind === 'standardize'
        ? upstream.std.activeConditions
        : upstream?.kind === 'compare'
          ? facetContextDims(upstream.cmp.rows)
          : (['strain', 'cmpd', 'dose', 'time'] as ConditionKey[])
    const colorOpts = active.includes(cfg.colorBy) ? active : [cfg.colorBy, ...active]
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <SwitchBar
              label="colour by"
              value={cfg.colorBy}
              options={colorOpts}
              onChange={(v) => patchConfig({ colorBy: v })}
            />
            <SwitchBar
              label="show"
              value={display === 'replicate' ? 'data' : 'centroid'}
              options={['centroid', 'data']}
              onChange={(v) => patchConfig({ display: v === 'data' ? 'replicate' : 'centroid' })}
            />
          </div>
          <div style={styles.stackBody}>{body}</div>
        </div>
      </div>
    )
    if (upstream?.kind === 'standardize')
      return withBar(
        <ClusterTile
          std={upstream.std}
          method={cfg.method}
          colorBy={cfg.colorBy}
          display={display}
        />
      )
    if (upstream?.kind === 'compare')
      return withBar(
        <ClusterTile
          cmp={upstream.cmp.rows}
          method={cfg.method}
          colorBy={cfg.colorBy}
          display={display}
        />
      )
    return <Empty text="Connect a Standardize or Compare tile and run it." />
  }
  if (kind === 'qc') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Standardize tile and run it." />
    const cfg = cfgSource as QcConfig
    const metric = cfg.metric ?? 'intensity'
    // Plot type is metric-dependent: distributions (intensity/CV) render as violin/box; a
    // per-sample count (proteins) only makes sense as a bar.
    const plotOpts = qcPlotOptions(metric)
    const plot = plotOpts.includes(cfg.plot) ? cfg.plot : plotOpts[0]
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
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
            {/* Only offer the plot toggle when the metric supports more than one type. */}
            {plotOpts.length > 1 && (
              <SwitchBar
                label="plot"
                value={plot}
                options={plotOpts}
                onChange={(v) => patchConfig({ plot: v as QcConfig['plot'] })}
              />
            )}
          </div>
          <div style={styles.stackBody}>
            <QcTile std={upstream.std} metric={metric} plot={plot} />
          </div>
        </div>
      </div>
    )
  }
  if (kind === 'corr') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Standardize tile and run it." />
    const cfg = cfgSource as CorrConfig
    return (
      <div style={styles.chart}>
        <CorrTile std={upstream.std} cluster={cfg.cluster ?? true} />
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

const styles: Record<string, CSSProperties> = {
  chart: { height: '100%', minHeight: 0 },
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
