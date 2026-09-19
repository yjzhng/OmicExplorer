/** Renders a single tile's output (table or plot) for the results dashboard.
 *  Salvaged from the retired OutputDock's OutputBody: the per-kind dispatch and
 *  the comparison/contrast column builders live here now. */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import {
  buildDR,
  buildEnrichment,
  DEFAULT_THRESHOLD,
  buildMA,
  buildScatter,
  buildIntensityScatter,
  buildVolcano,
  type CompareResultRow,
  type ConditionKey,
  type ContrastResultRow,
  type QcMetric,
  type StandardizeResult,
  VALID_CONDITIONS
} from '../engine'
import { BubbleView } from '../ui/BubbleView'
import { EnrichView } from '../ui/EnrichView'
import { StringView } from '../ui/StringView'
import { DataTableView, fixed, type Column } from '../ui/DataTableView'
import { DRView } from '../ui/DRView'
import { DumbbellView } from '../ui/DumbbellView'
import { ResponseCompareView } from '../ui/ResponseCompareView'
import { MAView } from '../ui/MAView'
import { ClusterTile } from './ClusterTile'
import { CorrTile } from './CorrTile'
import { QcTile } from './QcTile'
import { SUBSET_TOGGLE_KINDS } from './subset'
import { GeneBarTile } from './GeneBarTile'
import { GeneSwitch } from './GeneSwitch'
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
import { NODE_SPECS } from '../graph/registry'
import { dominantTaxon, factsOf, unmetRequirement } from '../graph/requirements'
import { useGraph } from '../graph/store'
import {
  isStep,
  type BarConfig,
  type BubbleConfig,
  type CompareConfig,
  effectLabelsOf,
  normalizeCompareConfig,
  type EffectLabels,
  type DRConfig,
  type DumbbellConfig,
  type EnrichConfig,
  type StringConfig,
  type HeatmapConfig,
  heatmapCapOn,
  geneCapOn,
  labelCapOn,
  type LoadConfig,
  type MAConfig,
  type NodeResult,
  type ClusterConfig,
  type CorrConfig,
  type PlotChild,
  type QcConfig,
  quickOn,
  type ScatterConfig,
  type StepNode,
  type TableConfig,
  type VolcanoConfig
} from '../graph/types'

type StdRow = StandardizeResult['rows'][number]

/** Stable empties for props that are "nothing selected" — a fresh `[]` / `{}` per render would
 *  defeat every memo downstream (a new object is a new dependency, hence a full chart rebuild). */
const NO_GENES: string[] = []
const NO_IDS: ReadonlySet<string> = new Set()
const NO_CATS: Record<string, string> = {}

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
function makeValueHeat(std: StandardizeResult): (v: unknown) => CSSProperties | undefined {
  return heatStyle(valueRange(std.rows.map((r) => r.value)))
}

/** Standardized-table columns: each condition/replicate column is shown only when the data
 *  carries a value for it — inactive (empty) conditions are dropped rather than shown blank. */
function stdColumns(rows: StdRow[]): Column[] {
  const present = (c: 'cell' | 'cmpd' | 'dose' | 'time' | 'rep'): boolean =>
    c === 'dose' || c === 'time' || c === 'rep'
      ? rows.some((r) => r[c] != null)
      : rows.some((r) => r[c] !== '' && r[c] != null)
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  if (present('cell')) cols.push({ key: 'cell', label: 'cell' })
  if (present('cmpd')) cols.push({ key: 'cmpd', label: 'cmpd' })
  if (present('dose')) cols.push({ key: 'dose', label: 'dose', align: 'right' })
  if (present('time')) cols.push({ key: 'time', label: 'time', align: 'right' })
  if (present('rep')) cols.push({ key: 'rep', label: 'rep', align: 'right' })
  cols.push({ key: 'value', label: 'value', align: 'right', format: fixed(3) })
  return cols
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
    ...sampleKeys.map((k): Column => ({
      key: k,
      label: labelOf.get(k) ?? k,
      align: 'right',
      format: fixed(3),
      cellStyle: heat
    }))
  ]
  return { columns, rows: uidOrder.map((u) => byUid.get(u)!) }
}

/** The standardized table with a Long ⇆ Matrix (gene × sample) view toggle. */
function StdTable({
  std,
  initialView = 'matrix'
}: {
  std: StandardizeResult
  initialView?: 'matrix' | 'long'
}): ReactNode {
  const [view, setView] = useState<'matrix' | 'long'>(initialView)
  const [colored, setColored] = useState(true)
  const long = useMemo(() => {
    const heat = makeValueHeat(std)
    return {
      // Colour the long view's `value` column with the same viridis heat scale as the matrix.
      columns: stdColumns(std.rows).map((c) => (c.key === 'value' ? { ...c, cellStyle: heat } : c)),
      rows: groupByGene(std.rows).map((r) => ({ ...r, gene: std.displayMap[r.uniqID] ?? '' }))
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
    padding: '3px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  label: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  track: {
    display: 'inline-flex',
    alignItems: 'center',
    width: 28,
    height: 15,
    borderRadius: 8,
    padding: 2,
    border: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
    transition: 'background 120ms'
  },
  knob: {
    width: 11,
    height: 11,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
  }
}

/** Columns for a comparison table, adapted to which conditions the rows carry
 *  and to the analysis (two-way's log2FC is an interaction term). */
function compareColumns(
  rows: CompareResultRow[],
  analysis: CompareConfig['analysis'],
  labels: EffectLabels,
  statType: 'pP' | 'pQ'
): Column[] {
  const present = (c: 'cell' | 'cmpd' | 'dose' | 'time'): boolean =>
    rows.some((r) => r[c] !== '' && r[c] != null)
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  // Show the comparison label only when several coexist (e.g. two-way factor combos).
  if (new Set(rows.map((r) => r.comparison)).size > 1) {
    cols.push({ key: 'comparison', label: 'comparison' })
  }
  if (present('cell')) cols.push({ key: 'cell', label: 'cell' })
  if (present('cmpd')) cols.push({ key: 'cmpd', label: 'cmpd' })
  if (present('dose')) cols.push({ key: 'dose', label: 'dose', align: 'right' })
  if (present('time')) cols.push({ key: 'time', label: 'time', align: 'right' })
  cols.push(
    {
      key: 'log2FC',
      label: analysis === 'two_way_anova' ? 'interaction' : 'log₂FC',
      align: 'right',
      format: fixed(3)
    },
    // Only the significance column that drives the calls (the Compare's P/Q switch).
    { key: statType, label: statType, align: 'right', format: fixed(3) },
    { key: 'signf', label: 'signf' },
    { key: 'effect', label: 'effect', format: effectName(labels) }
  )
  return cols
}

/** Cell formatter mapping the stored effect class ('up'/'down'/'none') to its display name. */
const effectName =
  (labels: EffectLabels) =>
  (v: unknown): string =>
    v === 'up' ? labels.up : v === 'down' ? labels.down : String(v ?? '')

/** One context value in a matrix column header: dose/time carry their name ("dose 10") since a
 *  bare number is ambiguous; cell/cmpd values speak for themselves ("WT", "Amk"). */
const ctxLabel = (c: ConditionKey, v: unknown): string =>
  c === 'dose' || c === 'time' ? `${c} ${v}` : String(v)

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
  order?: (a: string, b: string) => number
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const colKeys: string[] = []
  const colSeen = new Set<string>()
  const byUid = new Map<string, Record<string, unknown>>()
  const uidOrder: string[] = []
  const values: number[] = []
  for (const r of rows) {
    const col = colOf(r)
    if (!colSeen.has(col)) {
      colSeen.add(col)
      colKeys.push(col)
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
      ? divergeStyle(values.reduce((m, v) => Math.max(m, Math.abs(v)), 0))
      : heatStyle(valueRange(values))
  }
  const columns: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...colKeys.map((col): Column => ({
      key: `c¦${col}`,
      label: col,
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
  { key: 'pP', label: 'pP' },
  { key: 'pQ', label: 'pQ' },
  { key: 'mean1', label: 'mean1' },
  { key: 'mean2', label: 'mean2' },
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

/** Pivot a comparison result into a gene × comparison-column matrix — the tabular twin of the
 *  log₂FC heatmap. Columns are keyed exactly as the Fc heatmap keys them (comparison label + the
 *  context conditions the comparison doesn't consume), so the two line up; the cell field is the
 *  matrix view's "Show" choice. */
function compareMatrix(
  rows: CompareResultRow[],
  displayMap: Record<string, string>,
  field: MatrixField
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const consumed = new Set<string>()
  for (const r of rows) for (const p of r.cmp_cond.split(':')) if (p) consumed.add(p)
  const ctxDims = VALID_CONDITIONS.filter(
    (c) => !consumed.has(c) && rows.some((r) => r[c] != null && r[c] !== '')
  )
  return pivotMatrix(rows, displayMap, field, (r) =>
    [r.comparison, ...ctxDims.map((c) => ctxLabel(c, r[c]))].join(' · ')
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
  initialView = 'matrix'
}: {
  rows: CompareResultRow[]
  analysis: CompareConfig['analysis']
  effectLabels: EffectLabels
  displayMap: Record<string, string>
  comparisons: string[]
  /** which significance column drives the calls — the only one shown (pP or pQ) */
  statType: 'pP' | 'pQ'
  initialView?: 'long' | 'matrix'
}): ReactNode {
  const [view, setView] = useState<'long' | 'matrix'>(initialView)
  const [colored, setColored] = useState(true)
  // Matrix cell field ("Show"): any value column the result carries (only the driving one of
  // pP/pQ); log2FC by default.
  const fields = useMemo(
    () =>
      presentFields(rows, COMPARE_FIELDS).filter(
        (f) => (f.key !== 'pP' && f.key !== 'pQ') || f.key === statType
      ),
    [rows, statType]
  )
  const [fieldKey, setFieldKey] = useState(COMPARE_FIELDS[0].key)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0] ?? COMPARE_FIELDS[0]
  const long = useMemo(
    () => ({
      columns: compareColumns(rows, analysis, effectLabels, statType),
      rows: groupByGene(rows).map((r) => ({ ...r, gene: displayMap[r.uniqID] ?? '' }))
    }),
    [rows, analysis, effectLabels, displayMap, statType]
  )
  const matrix = useMemo(() => compareMatrix(rows, displayMap, field), [rows, displayMap, field])
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
        {view === 'matrix' && <ToggleSwitch label="Colour" on={colored} onChange={setColored} />}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view + field so the table fully remounts on toggle — its internal sort/filter
            state (and the Long view's duplicate uniqID row keys) must not leak across. */}
        <DataTableView
          key={`${view}¦${field.key}`}
          columns={columns}
          rows={cur.rows}
          caption={`Comparison — ${comparisons.join(', ')}`}
        />
      </div>
    </div>
  )
}

/** Which response axes the compare rows actually carry (dose, time, or both). Drives whether
 *  DR/TR and Bubble show the dose⇆time switcher — a single-axis dataset needs no switch. */
function axisChoices(
  rows: ReadonlyArray<{ dose?: number | null; time?: number | null }>
): ('dose' | 'time')[] {
  return (['dose', 'time'] as const).filter((a) => rows.some((r) => r[a] != null))
}

/** Columns for a contrast (compare-vs-compare) table. */
function contrastColumns(rows: ContrastResultRow[]): Column[] {
  const present = (c: 'cell' | 'dose' | 'time'): boolean =>
    rows.some((r) => r[c] != null && r[c] !== '')
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  if (present('cell')) cols.push({ key: 'cell', label: 'cell' })
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

/** Pivot contrast rows into a gene × matched-context matrix (cell/cmpd/dose/time tuple, in
 *  numeric-aware order — dose 2.5 < 5 < 10) showing one field per cell: FCdiff by default, or any
 *  other value column (the "Show" choice). With no matched context it's one column. */
function contrastMatrix(
  rows: ContrastResultRow[],
  displayMap: Record<string, string>,
  field: MatrixField
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const dims = (['cell', 'cmpd', 'dose', 'time'] as const).filter((c) =>
    rows.some((r) => r[c] != null && r[c] !== '')
  )
  // Column label → its raw context tuple, kept for the numeric-aware ordering below.
  const tupleOf = new Map<string, unknown[]>()
  const colOf = (r: ContrastResultRow): string => {
    if (!dims.length) return field.label
    const label = dims.map((c) => ctxLabel(c, r[c] ?? '')).join(' · ')
    if (!tupleOf.has(label))
      tupleOf.set(
        label,
        dims.map((c) => r[c] ?? '')
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
  return pivotMatrix(rows, displayMap, field, colOf, order)
}

/** The contrast table with a Long ⇆ Matrix (gene × context, cells = FC1/FC2/Δ) view toggle,
 *  mirroring the comparison table. */
function ContrastTable({
  rows,
  displayMap,
  comparisons,
  initialView = 'matrix'
}: {
  rows: ContrastResultRow[]
  displayMap: Record<string, string>
  comparisons: string[]
  initialView?: 'long' | 'matrix'
}): ReactNode {
  const [view, setView] = useState<'long' | 'matrix'>(initialView)
  const [colored, setColored] = useState(true)
  // Matrix cell field ("Show"): any value column the result carries; FCdiff by default.
  const fields = useMemo(() => presentFields(rows, CONTRAST_FIELDS), [rows])
  const [fieldKey, setFieldKey] = useState(CONTRAST_FIELDS[0].key)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0] ?? CONTRAST_FIELDS[0]
  const long = useMemo(
    () => ({
      columns: contrastColumns(rows),
      rows: groupByGene(rows).map((r) => ({ ...r, gene: displayMap[r.uniqID] ?? '' }))
    }),
    [rows, displayMap]
  )
  const matrix = useMemo(() => contrastMatrix(rows, displayMap, field), [rows, displayMap, field])
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
        {view === 'matrix' && <ToggleSwitch label="Colour" on={colored} onChange={setColored} />}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* key by view + field: the table remounts on toggle so sort/filter state doesn't leak. */}
        <DataTableView
          key={`${view}¦${field.key}`}
          columns={columns}
          rows={cur.rows}
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
  // The genes a plot emphasises / subsets to / draws per-gene: the linked gene selection (pins
  // from clicking in plots or the gene menu). Only the tiles that DRAW BY SELECTION subscribe —
  // the rest read a stable empty set, so a click doesn't re-render (and redraw) every tile: the
  // point plots take the selection straight from the store themselves, imperatively.
  const drawsSelection =
    selectedOnly ||
    kind === 'tdr' ||
    kind === 'geneBar' ||
    (kind === 'dr' && upstream?.kind === 'contrast')
  const pinnedIds = useSelection((s) => (drawsSelection ? s.pinnedIds : NO_IDS))
  const genes = useMemo(() => (pinnedIds.size ? [...pinnedIds] : NO_GENES), [pinnedIds])
  const focus = selectedOnly ? genes : NO_GENES
  // Selected-only mode: keep only rows whose feature is selected. `sub` is a no-op in all-genes
  // mode. Guarded below so subset mode with nothing selected shows guidance, not an empty plot.
  const sub = <T extends { uniqID: string }>(rows: T[]): T[] =>
    selectedOnly ? rows.filter((r) => pinnedIds.has(r.uniqID)) : rows
  if (SUBSET_TOGGLE_KINDS.has(kind) && selectedOnly && genes.length === 0)
    return <Empty text="No genes selected — pick genes in the gene menu or click them in a plot." />
  // A plot whose requirement the upstream data no longer meets (see requirements.ts) shows the
  // same reason the canvas status dot gives, instead of an empty or misleading chart. Enrichment
  // and STRING handle theirs below, keeping their switch bar visible so the user can change the
  // term source / species from the tile.
  if (!NODE_SPECS[kind].hasRun && upstream && kind !== 'enrich' && kind !== 'string') {
    const why = unmetRequirement(kind, cfgSource, factsOf(upstream))
    if (why) return <Empty text={why} />
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
    return <StdTable std={result.std} />
  }
  if (kind === 'compare') {
    if (result?.kind !== 'compare')
      return <Empty text="Run this tile to produce the comparison table." />
    const cmpCfg = node.data.config as CompareConfig
    return (
      <CompareTable
        rows={result.cmp.rows}
        analysis={cmpCfg.analysis}
        effectLabels={effectLabelsOf(cmpCfg)}
        displayMap={result.displayMap}
        comparisons={result.cmp.comparisons}
        statType={(result.cmp.threshold ?? cmpCfg.threshold)?.statType ?? 'pQ'}
      />
    )
  }
  if (kind === 'contrast') {
    if (result?.kind !== 'contrast')
      return <Empty text="Connect a Compare tile, pick two levels to contrast, and run." />
    return (
      <ContrastTable
        rows={result.ctr.rows}
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
    if (!upstream) return <Empty text="Connect a Clean data, Compare, or Contrast tile." />
    if (upstream.kind === 'standardize')
      return <StdTable key={view} std={upstream.std} initialView={view} />
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
          initialView={view}
        />
      )
    }
    if (upstream.kind === 'contrast') {
      return (
        <ContrastTable
          key={view}
          rows={upstream.ctr.rows}
          displayMap={upstream.displayMap}
          comparisons={upstream.ctr.comparisons}
          initialView={view}
        />
      )
    }
    return <Empty text="Run the upstream step to produce its table." />
  }
  if (kind === 'volcano') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
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
                  effectLabels={effectLabelsOf(upCfg)}
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
      return (
        <div style={styles.chart}>
          <FcHeatmapTile
            rows={upstream.cmp.rows}
            displayMap={upstream.displayMap}
            maxGenes={heatmapCapOn(cfg) ? cfg.maxGenes : 0}
            focus={focus}
            orient={cfg.orient}
          />
        </div>
      )
    }
    // Standardize upstream → intensity heatmap (genes × samples, full proteome — no gene cap).
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data or Compare tile and run it." />
    return (
      <div style={styles.chart}>
        <HeatmapTile std={upstream.std} log10={cfg.log10} focus={focus} orient={cfg.orient} />
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
                build={() => buildIntensityScatter(rows, { displayMap: dm })}
                deps={[rows, dm]}
              >
                {(scatter) => (
                  <ScatterView
                    scatter={scatter}
                    labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                    style={cfg.style}
                    effectLabels={effectLabelsOf(upStep?.data.config as CompareConfig | undefined)}
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
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={upstream.ctr.rows} facetSel={facetSel}>
          {(rows) => (
            <Built
              build={() =>
                buildScatter(rows, { displayMap: dm, valueKind: upstream.ctr.valueKind })
              }
              deps={[rows, dm, upstream.ctr.valueKind]}
            >
              {(scatter) => (
                <ScatterView
                  scatter={scatter}
                  labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                  style={cfg.style}
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
        {/* Full rows (no `sub`): the base list follows the All/Selected toggle via `focus`,
            and DumbbellView appends any hovered/pinned gene from the full set. */}
        <FacetedPlot rows={upstream.ctr.rows} facetSel={facetSel}>
          {(rows) => (
            <DumbbellView
              rows={rows}
              topGenes={geneCapOn(cfg) ? cfg.topGenes : 0}
              displayMap={dm}
              focus={focus}
              orient={cfg.orient}
              valueKind={upstream.ctr.valueKind}
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
    // MA's fold-change lines are the SAME threshold volcano uses — the one the result's calls were
    // made with (see the volcano above) — so the two plots match and a drag on either updates the
    // shared cutoff. Under a SAM (non-linear) threshold there's no fixed FC cutoff to draw, so hide
    // the lines (colour still shows calls).
    const maCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
    const threshold = upstream.cmp.threshold ?? maCfg?.threshold ?? DEFAULT_THRESHOLD
    const maSam = threshold.type === 'non-linear'
    return (
      <div style={styles.chart}>
        <FacetedPlot rows={sub(upstream.cmp.rows)} facetSel={facetSel}>
          {(rows) => (
            <Built
              build={() =>
                buildMA(rows, { fcLow: threshold.fcLow, fcHigh: threshold.fcHigh, displayMap: dm })
              }
              deps={[rows, threshold.fcLow, threshold.fcHigh, dm]}
            >
              {(ma) => (
                <MAView
                  ma={ma}
                  samThreshold={maSam}
                  asymmetric={threshold.asymmetric ?? false}
                  effectLabels={effectLabelsOf(maCfg)}
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
    // From a Contrast: the hovered/selected gene's response profile on BOTH sides (FC1 vs FC2), for
    // comparing two datasets/contrasts. From a Compare: every gene's response curve (below).
    if (upstream?.kind === 'contrast') {
      const dm = upstream.displayMap
      const axes = axisChoices(upstream.ctr.rows)
      const axis = axes.length > 1 ? cfg.axis : (axes[0] ?? cfg.axis)
      const present = new Set(upstream.ctr.rows.map((r) => r.uniqID))
      // FC1/FC2 are log10 abundance when the contrast is fed by Standardize inputs, log2 fold-change
      // when fed by Compare inputs — label the y-axis to match.
      const yLabel = upstream.ctr.valueKind === 'abundance' ? 'log abundance' : 'log₂FC'
      return (
        <div style={styles.chart}>
          <div style={styles.stack}>
            {axes.length > 1 && quickOn(cfg, 'axis') && (
              <SwitchBar
                label="axis"
                value={cfg.axis}
                options={['dose', 'time']}
                onChange={(v) => patchConfig({ axis: v })}
              />
            )}
            <div style={styles.stackBody}>
              {/* One gene at a time — the pager steps through the selected genes. */}
              <GeneSwitch genes={genes} present={present} displayMap={dm}>
                {(gene) => (
                  <FacetedPlot rows={upstream.ctr.rows} exclude={[axis]} facetSel={facetSel}>
                    {(rows) => (
                      <ResponseCompareView
                        rows={rows}
                        displayMap={dm}
                        axis={axis}
                        gene={gene}
                        yLabel={yLabel}
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
      return <Empty text="Connect a Compare or Contrast tile and run it." />
    const dm = upstream.displayMap
    // Only offer the dose⇆time switch when the data actually has both; with a single axis
    // present, force it and drop the switcher (a switch to the absent axis would draw nothing).
    const axes = axisChoices(upstream.cmp.rows)
    const axis = axes.length > 1 ? cfg.axis : (axes[0] ?? cfg.axis)
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {axes.length > 1 && quickOn(cfg, 'axis') && (
            <SwitchBar
              label="axis"
              value={cfg.axis}
              options={['dose', 'time']}
              onChange={(v) => patchConfig({ axis: v })}
            />
          )}
          <div style={styles.stackBody}>
            {/* DR/TR always draws every gene as a faint background curve; the All/Selected
                toggle only changes WHICH curves are coloured (top-N by response, or the
                selection) — it must not hide genes, so use the full rows (no `sub`). */}
            <FacetedPlot rows={upstream.cmp.rows} exclude={[axis]} facetSel={facetSel}>
              {(rows) => (
                <Built
                  build={() =>
                    buildDR(rows, {
                      axis,
                      topGenes: geneCapOn(cfg) ? cfg.topGenes : 0,
                      displayMap: dm,
                      focus
                    })
                  }
                  deps={[rows, axis, geneCapOn(cfg) ? cfg.topGenes : 0, dm, focus]}
                >
                  {(dr) => <DRView dr={dr} />}
                </Built>
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
    // Show the dose⇆time switch only when both axes exist; otherwise force the present one.
    const axes = axisChoices(upstream.cmp.rows)
    const axis = axes.length > 1 ? cfg.axis : (axes[0] ?? cfg.axis)
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {axes.length > 1 && quickOn(cfg, 'axis') && (
            <SwitchBar
              label="axis"
              value={cfg.axis}
              options={['dose', 'time']}
              onChange={(v) => patchConfig({ axis: v })}
            />
          )}
          <div style={styles.stackBody}>
            {/* Full rows (no `sub`): base follows the All/Selected toggle via `focus`, and
                BubbleView appends any hovered/pinned gene to the gene axis. */}
            <FacetedPlot rows={upstream.cmp.rows} exclude={[axis]} facetSel={facetSel}>
              {(rows) => (
                <BubbleView
                  rows={rows}
                  axis={axis}
                  topGenes={geneCapOn(cfg) ? cfg.topGenes : 0}
                  displayMap={dm}
                  focus={focus}
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
    // The selected genes drive TDR — a gene clicked in the FC matrix table (or any plot), or
    // picked in the gene menu — one figure each.
    const present = new Set(upstream.cmp.rows.map((r) => r.uniqID))
    const tdrGenes = genes.filter((id) => present.has(id))
    if (tdrGenes.length === 0) return <Empty text="Select a gene to plot its TDR." />
    // TDR uses both axes (dose × time) for one gene; the pager steps through however many are set.
    return (
      <div style={styles.chart}>
        {/* TDR plots over dose × time, so facet by the OTHER context dims (e.g. cell);
            without this a gene's curve mixes cells and zig-zags (two points per dose). */}
        <FacetedPlot rows={upstream.cmp.rows} exclude={['dose', 'time']} facetSel={facetSel}>
          {(rows) => <TdrTile rows={rows} genes={tdrGenes} displayMap={upstream.displayMap} />}
        </FacetedPlot>
      </div>
    )
  }
  if (kind === 'geneBar') {
    if (upstream?.kind !== 'standardize')
      return <Empty text="Connect a Clean data tile and run it." />
    // Bars for the selected genes present in the data.
    const present = new Set(upstream.std.rows.map((r) => r.uniqID))
    if (!genes.some((id) => present.has(id)))
      return <Empty text="Select a gene to plot its bars." />
    return (
      <div style={styles.chart}>
        <GeneBarTile std={upstream.std} genes={genes} orient={(cfgSource as BarConfig).orient} />
      </div>
    )
  }
  if (kind === 'pca') {
    const cfg = cfgSource as ClusterConfig
    const display = cfg.display ?? 'centroid'
    const legend = cfg.legend ?? 'simple'
    // Colour-by options are the Standardize's active conditions. Keep the current value
    // selectable if it's off-list.
    const active: ConditionKey[] =
      upstream?.kind === 'standardize'
        ? upstream.std.activeConditions
        : (['cell', 'cmpd', 'dose', 'time'] as ConditionKey[])
    const colorOpts = active.includes(cfg.colorBy) ? active : [cfg.colorBy, ...active]
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'legend') && (
              <SwitchBar
                label="legend"
                value={legend}
                options={['simple', 'complex']}
                onChange={(v) => patchConfig({ legend: v })}
              />
            )}
            {/* In complex mode colour is driven by every varying condition, so the single
                colour-by choice no longer applies. */}
            {legend === 'simple' && quickOn(cfg, 'colorBy') && (
              <SwitchBar
                label="colour by"
                value={cfg.colorBy}
                options={colorOpts}
                onChange={(v) => patchConfig({ colorBy: v })}
              />
            )}
            {quickOn(cfg, 'display') && (
              <SwitchBar
                label="show"
                value={display === 'replicate' ? 'data' : 'centroid'}
                options={['centroid', 'data']}
                onChange={(v) => patchConfig({ display: v === 'data' ? 'replicate' : 'centroid' })}
              />
            )}
            {/* PCA computation parameters (scaling, missing, normalize, features, transform,
                replicates) live in the tile's settings dialog (gear), not inline. */}
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
          scale={cfg.scale}
          missing={cfg.missing}
          center={cfg.center}
          topVar={cfg.topVar}
          transform={cfg.transform}
          replicates={cfg.replicates}
          display={display}
          legend={legend}
        />
      )
    return <Empty text="Connect a Clean data tile and run it." />
  }
  if (kind === 'enrich') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as EnrichConfig
    const source = cfg.source ?? 'go'
    const method = cfg.method ?? 'ora'
    // 'ridge' is GSEA-only; fall back to dot if a persisted ridge style meets ORA.
    const style = cfg.style === 'ridge' && method !== 'gsea' ? 'dot' : (cfg.style ?? 'dot')
    const styleOpts = method === 'gsea' ? ['dot', 'bar', 'ridge'] : ['dot', 'bar']
    const ann = upstream.annotationMap ?? {}
    const unmet = unmetRequirement('enrich', { ...cfg, source }, factsOf(upstream))
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'method') && (
              <SwitchBar
                label="method"
                value={method}
                options={['ora', 'gsea']}
                onChange={(v) => patchConfig({ method: v })}
              />
            )}
            {quickOn(cfg, 'source') && (
              <SwitchBar
                label="terms"
                value={source}
                options={['go', 'kegg']}
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
        {(rows) => (
          <Built
            build={() =>
              buildEnrichment(rows, {
                method,
                source,
                topTerms: cfg.topTerms,
                annotationMap: ann,
                displayMap: upstream.displayMap,
                keggCategories: source === 'kegg' ? (upstream.keggCategories ?? NO_CATS) : undefined
              })
            }
            deps={[
              rows,
              method,
              source,
              cfg.topTerms,
              ann,
              upstream.displayMap,
              upstream.keggCategories
            ]}
          >
            {(enrich) => <EnrichView enrich={enrich} style={style} />}
          </Built>
        )}
      </FacetedPlot>
    )
  }
  if (kind === 'string') {
    if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
    const cfg = cfgSource as StringConfig
    const confidence = cfg.confidence ?? 'medium'
    const maxGenes = cfg.maxGenes > 0 ? cfg.maxGenes : 40
    const addInteractors = cfg.addInteractors ?? false
    const scoreOf = { low: 150, medium: 400, high: 700, highest: 900 } as const
    // Species: a manual override, else the dominant taxon learned from the annotation fetch.
    const ann = upstream.annotationMap ?? {}
    const species = cfg.species && cfg.species > 0 ? cfg.species : dominantTaxon(ann)
    const withBar = (body: ReactNode): ReactNode => (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {quickOn(cfg, 'confidence') && (
              <SwitchBar
                label="confidence"
                value={confidence}
                options={['low', 'medium', 'high', 'highest']}
                onChange={(v) => patchConfig({ confidence: v })}
              />
            )}
            {quickOn(cfg, 'maxGenes') && (
              <SwitchBar
                label="max genes"
                value={String(maxGenes)}
                // A custom cap set in the gear shows as its own option so the bar never lies.
                options={[...new Set(['20', '40', '80', String(maxGenes)])].sort(
                  (a, b) => Number(a) - Number(b)
                )}
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
        {(rows) => (
          <StringView
            rows={rows}
            displayMap={upstream.displayMap}
            annotationMap={ann}
            species={species}
            requiredScore={scoreOf[confidence]}
            maxGenes={maxGenes}
            addInteractors={addInteractors}
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
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
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
      return <Empty text="Connect a Clean data tile and run it." />
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
