import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { plotCached } from '../../../ui/plot/plotCache'
import { SwitchBar, SwitchBarToggle } from '../../../dashboard/SwitchBar'
import { showTable } from '../../../dashboard/tableOnShow'
import {
  type CompareResultRow,
  type ContextRow,
  type ContrastResultRow,
  type NumericConds,
  type RowView,
  type StandardizeResult,
  type ThresholdConfig,
  comparisonOf,
  numericOf,
  rowView
} from '../../../engine'
import type { CompareConfig, EffectLabels } from '../../../graph/config/compare'
import type { CondUnits } from '../../../graph/config/units'
import { DataTableView } from '../../../ui/table/DataTableView'
import { type PaletteRef } from '../../../ui/color/palettes'
import { useRolePalette } from '../../../ui/app/useAppSettings'
import { type StdView } from './common'
import { NO_DOSE } from './context'
import { contrastValueName, makeValueHeat, valueLabel } from './helpers'
import {
  COMPARE_FIELDS,
  compareCellRow,
  compareColumns,
  compareMatrix,
  compareMatrixOver,
  compareTableData,
  CONTRAST_FIELDS,
  contrastColumns,
  contrastMatrix,
  longSource,
  namedMeanFields,
  presentFields,
  presentFieldsBy,
  presentFieldsOf,
  sampleQcTable,
  standardizeMatrix,
  stdColumnsOf,
  tableRows
} from './tableData'

/** A table's cell colouring when a Data table tile owns it (its settings): on / off, and the
 *  palette (unset = the table's default). Absent: the table keeps its own on/off switch. */
export interface TableColour {
  on: boolean
  set: (on: boolean) => void
  palette?: PaletteRef
}
/** The standardized table with a Matrix (gene × sample) ⇆ Long ⇆ QC (per sample) view toggle. */
export function StdTable({
  std,
  view: tileView,
  setView: setTileView,
  maxChars,
  colour,
  units,
  showKey
}: {
  /** the imported units, for the numeric conditions' column headers */
  units?: CondUnits
  /** the tile's key (plotResultKey): the table on show is registered under it, so the tile's
   *  Download writes exactly it (see tableOnShow) */
  showKey?: string
  std: StandardizeResult
  /** the view on show — a Data table tile's setting, which its download follows; unset, the
   *  table's own */
  view?: StdView
  setView?: (view: StdView) => void
  /** the id / gene columns' display caps (characters, by column key) */
  maxChars?: Record<string, number>
  colour?: TableColour
}): ReactNode {
  const [localView, setLocalView] = useState<StdView>('matrix')
  const view = tileView ?? localView
  const setView = setTileView ?? setLocalView
  const [localColored, setLocalColored] = useState(true)
  const colored = colour?.on ?? localColored
  const setColored = colour?.set ?? setLocalColored
  // Abundance cells on the value palette (default viridis, as the Clean data heatmap).
  const dataPalette = useRolePalette('data')
  const palette = colour?.palette ?? dataPalette
  // Only the view on show is built, and kept app-wide by the result (ui/plot/plotCache): the matrix is a
  // full pivot, the long view's colours a scan of every value — switching back takes the one built.
  const long =
    view === 'long'
      ? plotCached('stdLong', [std, palette, units], () => {
          const heat = makeValueHeat(std, palette)
          return {
            // Colour the long view's `value` column with the same viridis heat scale as the matrix.
            columns: stdColumnsOf(std, numericOf(std), units).map((c) =>
              c.key === 'value' ? { ...c, cellStyle: heat } : c
            ),
            // the rows built only as the table shows them (longSource)
            rows: longSource(rowView(std), std.displayMap)
          }
        })
      : null
  const matrix =
    view === 'matrix'
      ? plotCached('stdMatrix', [std, palette], () => standardizeMatrix(std, palette))
      : null
  // built only once the QC view is opened
  const qc =
    view === 'qc'
      ? plotCached('stdQc', [std, palette, units], () => sampleQcTable(std, palette, units))
      : null
  const cur = (qc ?? matrix ?? long)!
  // What's on show is what the tile's Download writes: this view and its columns.
  useEffect(
    () =>
      showKey
        ? showTable(showKey, {
            columns: cur.columns,
            rows: cur.rows,
            name:
              view === 'qc'
                ? 'Sample QC'
                : view === 'long'
                  ? 'Clean data (long)'
                  : 'Clean data matrix'
          })
        : undefined,
    [showKey, cur, view]
  )
  // Drop the per-cell heat styling when colouring is off.
  const columns = colored
    ? cur.columns
    : cur.columns.map((c) => (c.cellStyle ? { ...c, cellStyle: undefined } : c))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
        <SwitchBar
          label="View"
          value={view === 'matrix' ? 'Matrix' : view === 'qc' ? 'QC' : 'Long'}
          options={['Matrix', 'Long', 'QC']}
          onChange={(v) => setView(v === 'Matrix' ? 'matrix' : v === 'QC' ? 'qc' : 'long')}
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
/** A value column a matrix view can show in its cells. */
export interface MatrixField {
  key: string
  label: string
  /** categorical (e.g. effect): shown as text, no heat colouring */
  text?: boolean
}
/** A large result's rows for a table (see rowView): the view, its context tuples, and each view
 *  row's tuple — what a table's columns, its matrix and its fields are worked out from without
 *  building a row. */
export interface TableData<T> {
  view: RowView<T>
  ctx: ContextRow[]
  ctxAt: (i: number) => ContextRow
}
/** A t-test's or an ANOVA's rows for its table, read off the result's columns: the cells as the
 *  table shows them (an ANOVA row's F-test, a term's effect size — see compareCellRow), its
 *  context tuples, and a few representative rows for the columns (compareColumns asks only which
 *  values and fields occur: one row per distinct context and field set answers alike). Null for
 *  rows with a fit along an axis (a curve fit's, a response fit): their cells come from each row's
 *  curve, so the table reads the rows. Cached per result. */
export interface CompareTableData {
  view: RowView<CompareResultRow>
  ctx: readonly ContextRow[]
  ctxAt: (i: number) => ContextRow
  cell: (key: string) => (i: number) => unknown
  reps: CompareResultRow[]
}
/** The comparison table with a Long ⇆ Matrix (gene × comparison, cells = log2FC) view toggle,
 *  mirroring the standardized table. Long is the stats view (log2FC, p, effect); Matrix is the
 *  wide fold-change pivot that reads like the Fc heatmap. */
export function CompareTable({
  cmp,
  analysis,
  effectLabels,
  displayMap,
  comparisons,
  statType,
  threshold,
  numeric,
  dose = NO_DOSE,
  initialView = 'matrix',
  maxChars,
  colour,
  showKey,
  units
}: {
  /** the imported units, for the numeric conditions' column headers */
  units?: CondUnits
  /** the tile's key (plotResultKey): the table on show is registered under it, so the tile's
   *  Download writes exactly it (see tableOnShow) */
  showKey?: string
  /** the Compare's result (or the part of it on show) */
  cmp: { rows: readonly CompareResultRow[] }
  /** the dataset's numeric conditions (numericOfResult): their columns align right */
  numeric: NumericConds
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
  // A t-test's or an ANOVA's rows are read off the result's columns (compareTableData); a curve
  // fit's are built, with each one's own cells alongside (pEC50, relevance…), for both views.
  const data = useMemo(() => compareTableData(cmp, analysis), [cmp, analysis])
  const cellRows = useMemo(
    () => (data ? null : cmp.rows.map((r) => compareCellRow(r, threshold, dose.scale))),
    [data, cmp, threshold, dose.scale]
  )
  const fields = useMemo(() => {
    const all = cellRows
      ? presentFields(cellRows, namedMeanFields(cellRows))
      : presentFieldsBy(data!.view.n, data!.cell, namedMeanFields(data!.ctx as CompareResultRow[]))
    return all.filter((f) => (f.key !== 'pP' && f.key !== 'pQ') || f.key === statType)
  }, [cellRows, data, statType])
  const [fieldKey, setFieldKey] = useState(COMPARE_FIELDS[0].key)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0] ?? COMPARE_FIELDS[0]
  const long = useMemo(
    () => ({
      columns: compareColumns(
        data ? data.reps : (cmp.rows as CompareResultRow[]),
        analysis,
        effectLabels,
        statType,
        numeric,
        threshold,
        dose.unit,
        units
      ),
      // a curve fit's comparison as the plots read it ("drugA | baseline"); the key itself
      // stays on the result rows
      rows: data
        ? longSource(data.view, displayMap, data.cell, (r) =>
            compareCellRow(r, threshold, dose.scale)
          )
        : tableRows(cellRows!, displayMap).map((t) =>
            analysis === 'curve_fit'
              ? {
                  ...t,
                  comparison:
                    comparisonOf([t as Parameters<typeof comparisonOf>[0][number]]) ?? t.comparison
                }
              : t
          )
    }),
    [
      cmp,
      data,
      cellRows,
      analysis,
      effectLabels,
      displayMap,
      statType,
      threshold,
      dose.unit,
      dose.scale,
      numeric,
      units
    ]
  )
  const matrix = useMemo(() => {
    if (!data) return compareMatrix(cellRows!, displayMap, field, palettes)
    const uid = data.view.col('uniqID')
    return compareMatrixOver(
      data.ctx,
      {
        n: data.view.n,
        uid: (i) => uid(i) as string,
        ctx: data.ctxAt,
        value: data.cell(field.key)
      },
      displayMap,
      field,
      palettes
    )
  }, [data, cellRows, displayMap, field, palettes])
  const cur = view === 'matrix' ? matrix : long
  // What's on show is what the tile's Download writes: this view, its columns, its "Show" field.
  useEffect(
    () =>
      showKey
        ? showTable(showKey, {
            columns: cur.columns,
            rows: cur.rows,
            name: view === 'matrix' ? `Comparison matrix (${field.label})` : 'Comparison table'
          })
        : undefined,
    [showKey, cur, view, field.label]
  )
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
/** The contrast table with a Long ⇆ Matrix (gene × context, cells = FC1/FC2/Δ) view toggle,
 *  mirroring the comparison table. */
export function ContrastTable({
  data,
  displayMap,
  comparisons,
  numeric,
  initialView = 'matrix',
  maxChars,
  colour,
  showKey,
  units
}: {
  /** the imported units, for the numeric conditions' column headers */
  units?: CondUnits
  /** the tile's key (plotResultKey): the table on show is registered under it, so the tile's
   *  Download writes exactly it (see tableOnShow) */
  showKey?: string
  /** its rows of the feature on show (contrastTableData) */
  data: TableData<ContrastResultRow>
  /** the dataset's numeric conditions (numericOfResult): their columns align right */
  numeric: NumericConds
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
  // the value fields named for the feature on show (EC50 1, EC50 diff, …)
  const fields = useMemo(() => {
    const name = contrastValueName(data.ctx)
    return presentFieldsOf(data.view, CONTRAST_FIELDS).map((f) => ({
      ...f,
      label: valueLabel(f.label, name)
    }))
  }, [data])
  const [fieldKey, setFieldKey] = useState(CONTRAST_FIELDS[0].key)
  const field = fields.find((f) => f.key === fieldKey) ?? fields[0] ?? CONTRAST_FIELDS[0]
  const long = useMemo(
    () => ({
      columns: contrastColumns(data.ctx, numeric, units),
      rows: longSource(data.view, displayMap)
    }),
    [data, displayMap, numeric, units]
  )
  const matrix = useMemo(
    () => contrastMatrix(data, displayMap, field, palettes),
    [data, displayMap, field, palettes]
  )
  const cur = view === 'matrix' ? matrix : long
  // What's on show is what the tile's Download writes: this view, its columns, its "Show" field.
  useEffect(
    () =>
      showKey
        ? showTable(showKey, {
            columns: cur.columns,
            rows: cur.rows,
            name: view === 'matrix' ? `Contrast matrix (${field.label})` : 'Contrast table'
          })
        : undefined,
    [showKey, cur, view, field.label]
  )
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
