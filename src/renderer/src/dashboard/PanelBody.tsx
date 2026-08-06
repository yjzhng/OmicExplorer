/** Renders a single tile's output (table or plot) for the results dashboard.
 *  Salvaged from the retired OutputDock's OutputBody: the per-kind dispatch and
 *  the comparison/contrast column builders live here now. */
import { type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import {
  buildDR,
  buildMA,
  buildScatter,
  buildIntensityScatter,
  buildVolcano,
  facetContextDims,
  type CompareResultRow,
  type ConditionKey,
  type ContrastResultRow
} from '../engine'
import { BubbleView } from '../ui/BubbleView'
import { DataTableView, fixed, type Column } from '../ui/DataTableView'
import { DRView } from '../ui/DRView'
import { DumbbellView } from '../ui/DumbbellView'
import { MAView } from '../ui/MAView'
import { ClusterTile } from './ClusterTile'
import { GOI_TOGGLE_KINDS } from './goi'
import { GeneBarTile } from './GeneBarTile'
import { ScatterView } from '../ui/ScatterView'
import { SwitchBar } from './SwitchBar'
import { TdrTile } from './TdrTile'
import { UI } from '../ui/theme'
import { VolcanoView } from '../ui/VolcanoView'
import { FacetedPlot } from './FacetedPlot'
import { HeatmapTile } from './HeatmapTile'
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
  type PlotChild,
  type ScatterConfig,
  type StepNode,
  type VolcanoConfig
} from '../graph/types'

const STD_COLUMNS: Column[] = [
  { key: 'uniqID', label: 'uniqID' },
  { key: 'gene', label: 'gene' },
  { key: 'cmpd', label: 'cmpd' },
  { key: 'dose', label: 'dose', align: 'right' },
  { key: 'time', label: 'time', align: 'right' },
  { key: 'rep', label: 'rep', align: 'right' },
  { key: 'value', label: 'value', align: 'right', format: fixed(3) }
]

/** Standardized-table columns, with `strain` shown only when the data carries it
 *  (single-strain datasets leave it out rather than show an empty column). */
function stdColumns(rows: { strain?: string | null }[]): Column[] {
  if (!rows.some((r) => r.strain !== '' && r.strain != null)) return STD_COLUMNS
  const cols = [...STD_COLUMNS]
  cols.splice(2, 0, { key: 'strain', label: 'strain' }) // after uniqID, gene
  return cols
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
    const dm = result.std.displayMap
    const rows = result.std.rows.map((r) => ({ ...r, gene: dm[r.uniqID] ?? '' }))
    return (
      <DataTableView
        columns={stdColumns(result.std.rows)}
        rows={rows}
        caption="Standardized table"
      />
    )
  }
  if (kind === 'compare') {
    if (result?.kind !== 'compare')
      return <Empty text="Run this tile to produce the comparison table." />
    const dm = result.displayMap
    const rows = result.cmp.rows.map((r) => ({ ...r, gene: dm[r.uniqID] ?? '' }))
    const analysis = (node.data.config as CompareConfig).analysis
    return (
      <DataTableView
        columns={compareColumns(result.cmp.rows, analysis)}
        rows={rows}
        caption={`Comparison — ${result.cmp.comparisons.join(', ')}`}
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
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Standardize tile and run it." />
    const cfg = cfgSource as HeatmapConfig
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
    if (genes.length === 0)
      return <Empty text="Set a focus gene (here or on Standardize) to plot TDR." />
    // TDR uses both axes (dose × time) for one gene, so it shows up to 3, switched by tab.
    if (genes.length > 3)
      return (
        <Empty
          text={`TDR shows up to 3 genes — ${genes.length} focus genes selected. Narrow the focus to 3 or fewer.`}
        />
      )
    return (
      <div style={styles.chart}>
        {/* TDR plots over dose × time, so facet by the OTHER context dims (e.g. strain);
            without this a gene's curve mixes strains and zig-zags (two points per dose). */}
        <FacetedPlot rows={upstream.cmp.rows} exclude={['dose', 'time']} facetSel={facetSel}>
          {(rows) => <TdrTile rows={rows} genes={genes} displayMap={upstream.displayMap} />}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'geneBar') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Standardize tile and run it." />
    if (genes.length === 0)
      return <Empty text="Set focus genes (here or on Standardize) to plot the bars." />
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
          <SwitchBar
            label="colour by"
            value={cfg.colorBy}
            options={colorOpts}
            onChange={(v) => patchConfig({ colorBy: v })}
          />
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
  return <Empty text="No output." />
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
