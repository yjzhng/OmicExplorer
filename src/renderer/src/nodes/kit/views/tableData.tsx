import type { CSSProperties } from 'react'
import {
  quantityLabel,
  valueUnitOf,
  buildStdMatrix,
  condLabel,
  condPresent,
  condsIn,
  contextIndices,
  contextOf,
  contextRowAt,
  ctxValue,
  curveHasLof,
  curveIsFlat,
  curveMetrics,
  customCond,
  customSlug,
  distinctOf,
  isCustomCond,
  isInteractionRow,
  isNumericCond,
  isSlopeRow,
  nestedCol,
  nestedPresent,
  numericOf,
  plainLogOf,
  tableScaleOf,
  responseMetrics,
  rowView,
  rowsAt,
  rowsOfFeatureNamed,
  sampleQc,
  someNested,
  type CompareResultRow,
  type ConditionKey,
  type ContextRow,
  type ContrastResultRow,
  type NumericConds,
  type RowView,
  type StandardizeResult,
  type ThresholdConfig
} from '../../../engine'
import { holderTable } from '../../../engine/lazyRows'
import {
  axisTitle,
  type CompareConfig,
  type CondUnits,
  type EffectLabels
} from '../../../graph/types'
import { divergeStyle, heatStyle, valueRange } from '../../../ui/colormap'
import { type Column, fixed, type HeaderLine, type TableSource } from '../../../ui/DataTableView'
import { fmtPlain } from '../../../ui/quantityAxis'
import { type PaletteRef, ROLE_DEFAULTS } from '../../../ui/palettes'
import { type PivotSource } from './common'
import {
  contrastValueName,
  ctxLabel,
  ctxLines,
  effectName,
  groupByGene,
  makeValueHeat,
  sig3,
  valueLabel
} from './helpers'
import { type CompareTableData, type MatrixField, type TableData } from './tables'

/** A table row's custom condition values hoisted to flat `@slug` keys. DataTableView addresses a
 *  cell by one column key, and the `@` prefix (the custom condition key itself) can't collide with
 *  a result column's name the way a bare slug like `effect` could. */
export function flatConds(r: { extra?: Record<string, string> }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(r.extra ?? {}).map(([k, v]) => [customCond(k), v]))
}
/** Add `gene` and the flat custom condition keys to each row, ready for DataTableView. */
export function tableRows<T extends { uniqID: string; extra?: Record<string, string> }>(
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
export function condColumns(
  rows: Array<{ extra?: Record<string, string> }>,
  numeric: NumericConds,
  only?: ConditionKey[],
  /** the imported units: a numeric condition's column says its unit — `dose (nM)` */
  units?: CondUnits
): Column[] {
  return condsIn(rows)
    .filter((c) => (only ? only.includes(c) || isCustomCond(c) : true) && condPresent(rows, c))
    .map((c) => ({
      key: c,
      label: units ? axisTitle(c, units) : condLabel(c),
      ...(isNumericCond(c, numeric) ? { align: 'right' as const } : null)
    }))
}
/** A plain value cell (a logged value shown as itself — tableScaleOf): three significant figures,
 *  as the plots' hovers read, so a small fraction isn't 0.000. Missing reads "NaN" (as `fixed`). */
const plainCell = (v: unknown): string => {
  if (v == null || v === '') return 'NaN'
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? fmtPlain(n) : 'NaN'
}
/** A Clean data table's value cells: plain when its logged values are shown so, else 3 decimals. */
const valueCell = (std: StandardizeResult): ((v: unknown) => string) =>
  plainLogOf(std) ? plainCell : fixed(3)

/** stdColumns for a Clean data result, worked out from its context tuples and its rep column —
 *  no row built. */
export function stdColumnsOf(
  std: StandardizeResult,
  numeric: NumericConds,
  units?: CondUnits
): Column[] {
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...condColumns(contextOf(std).rows, numeric, undefined, units)
  ]
  if ([...distinctOf(std, 'rep')].some((v) => v != null))
    cols.push({ key: 'rep', label: 'rep', align: 'right' })
  cols.push({ key: 'value', label: 'value', align: 'right', format: valueCell(std) })
  return cols
}
/** Pivot the tidy standardized rows into a gene × sample matrix: one row per uniqID, one column
 *  per sample. The samplesheet's sample names aren't retained in the standardized rows, so a
 *  sample is identified (and labelled) by its condition combination + replicate. */
export function standardizeMatrix(
  std: StandardizeResult,
  palette?: PaletteRef
): {
  columns: Column[]
  rows: Record<string, unknown>[]
} {
  // the pivot off the shared sample index (each sample's label made once, no row built)
  const { samples, rows } = buildStdMatrix(std)
  // Global viridis heat scale across every value cell (matches the Heatmap tile's colour map).
  const heat = makeValueHeat(std, palette)
  const columns: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...samples.map((c): Column => ({
      key: c.key,
      label: c.label,
      labelLines: c.lines,
      align: 'right',
      format: valueCell(std),
      cellStyle: heat
    }))
  ]
  return { columns, rows }
}
/** The Clean data table's QC view: one row per sample — its conditions and replicate, then how
 *  many proteins it measured / had imputed / missed, its measured abundances' median and quartiles
 *  (on the plots' scale) and its condition group's median CV. Numbers coloured per column. */
export function sampleQcTable(
  std: StandardizeResult,
  palette: PaletteRef,
  units?: CondUnits
): { columns: Column[]; rows: Record<string, unknown>[] } {
  // as the Clean data table shows its values: plain when they're shown plain (tableScaleOf)
  const scale = tableScaleOf(std)
  const qc = sampleQc(std, scale)
  const rows: Record<string, unknown>[] = qc.map((q) => ({
    ...q.meta,
    ...flatConds(q.meta),
    measured: q.measured,
    imputed: q.imputed,
    missing: q.missing,
    missingPct: q.missingPct,
    median: q.median,
    q1: q.q1,
    q3: q.q3,
    groupCv: q.groupCv
  }))
  const num = (key: string, label: string, digits: number, plain = false): Column => ({
    key,
    label,
    align: 'right',
    format: plain ? plainCell : fixed(digits),
    cellStyle: heatStyle(valueRange(rows.map((r) => r[key] as number | null)), palette)
  })
  const unit = quantityLabel(scale, valueUnitOf(std))
  return {
    columns: [
      ...condColumns(contextOf(std).rows, numericOf(std), undefined, units),
      ...(qc.some((q) => q.meta.rep != null)
        ? [{ key: 'rep', label: 'rep', align: 'right' as const }]
        : []),
      num('measured', 'measured', 0),
      // only when anything was imputed
      ...(qc.some((q) => q.imputed) ? [num('imputed', 'imputed', 0)] : []),
      num('missing', 'missing', 0),
      num('missingPct', 'missing %', 1),
      num('median', `median · ${unit}`, 3, plainLogOf(std)),
      num('q1', `Q1 · ${unit}`, 3, plainLogOf(std)),
      num('q3', `Q3 · ${unit}`, 3, plainLogOf(std)),
      num('groupCv', 'group CV %', 1)
    ],
    rows
  }
}
/** Columns for a comparison table, adapted to which conditions the rows carry
 *  and to the analysis (two-way's log2FC is an interaction term). */
export function compareColumns(
  rows: CompareResultRow[],
  analysis: CompareConfig['analysis'],
  labels: EffectLabels,
  statType: 'pP' | 'pQ',
  numeric: NumericConds,
  threshold?: ThresholdConfig,
  doseUnit?: string,
  units?: CondUnits
): Column[] {
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' }
  ]
  // Always the comparison, one Compare or several: a row says what it compares ("drugA | DMSO";
  // a curve fit, what each curve is against), and every table has the same columns — downloads
  // too (export/tables.ts), so they line up when combined.
  cols.push({ key: 'comparison', label: 'comparison' })
  cols.push(...condColumns(rows, numeric, undefined, units))
  // The response surface method (a Curve fit with detection model Spline): its own columns below.
  const response = analysis === 'curve_fit' && rows.some((r) => r.rs)
  // A two-way ANOVA's term rows: their unsigned effect size in its own column, beside the 2×2s'
  // interaction (see the table's cell rows).
  const terms = rows.some((r) => r.term)
  cols.push({
    key: 'log2FC',
    label:
      analysis === 'anova' && rows.some(isSlopeRow)
        ? 'slope'
        : analysis === 'anova' && rows.some(isInteractionRow)
          ? 'interaction'
          : response
            ? 'peak log₂FC'
            : analysis === 'curve_fit'
              ? 'curve log₂FC'
              : 'log₂FC',
    align: 'right',
    format: fixed(3)
  })
  if (terms)
    cols.push({ key: 'effectSize', label: 'effect size', align: 'right', format: fixed(3) })
  // a two-way ANOVA's F-test, every row's (a 2×2's: F = t²)
  if (rows.some((r) => r.ftest))
    cols.push({ key: 'F', label: 'F', align: 'right', format: sig3 }, { key: 'df', label: 'df' })
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
        : []),
      // testing response changes: what kind of change, and its sizes
      ...(rows.some((r) => r.rs?.shift)
        ? [
            { key: 'change', label: 'change' },
            { key: 'drift', label: 'drift (log₂)', align: 'right' as const, format: fixed(3) },
            { key: 'shape', label: 'shape (log₂)', align: 'right' as const, format: fixed(3) },
            {
              key: 'mid_shift',
              label: 'Δ midpoint',
              align: 'right' as const,
              format: sig3
            },
            {
              key: 'plateau_shift',
              label: 'Δ plateau (log₂)',
              align: 'right' as const,
              format: fixed(3)
            }
          ]
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
/** Pivot result rows into a gene × column matrix showing ONE field per cell. `colOf` names the
 *  column a row belongs to (comparison + context, or the contrast's context tuple); columns keep
 *  first-seen order unless `order` sorts them. Numeric fields are heat-coloured: a diverging RdBu
 *  scale when the values are signed (fold changes, differences), the sequential scale otherwise
 *  (−log p/q, means, SDs). Read through a PivotSource — a large columnar result off its columns
 *  (rowView), its rows never built. */
export function pivotOver<T>(
  src: PivotSource<T>,
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
  },
  /** a column whose values are unsigned (a two-way ANOVA term's effect sizes): listed first, and
   *  coloured on their own sequential scale rather than the signed columns' diverging one */
  unsignedOf?: (r: T) => boolean
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const colKeys: string[] = []
  const colSeen = new Set<string>()
  const colLines = new Map<string, HeaderLine[]>()
  const byUid = new Map<string, Record<string, unknown>>()
  const uidOrder: string[] = []
  const values: number[] = []
  const unsignedValues: number[] = []
  const unsignedCols = new Set<string>()
  for (let i = 0; i < src.n; i++) {
    const r = src.ctx(i)
    const col = colOf(r)
    if (!colSeen.has(col)) {
      colSeen.add(col)
      colKeys.push(col)
      if (linesOf) colLines.set(col, linesOf(r))
      if (unsignedOf?.(r)) unsignedCols.add(col)
    }
    const uid = src.uid(i)
    let row = byUid.get(uid)
    if (!row) {
      row = { uniqID: uid, gene: displayMap[uid] ?? '' }
      byUid.set(uid, row)
      uidOrder.push(uid)
    }
    const v = src.value(i)
    row[`c¦${col}`] = v
    if (!field.text && typeof v === 'number' && Number.isFinite(v))
      (unsignedCols.has(col) ? unsignedValues : values).push(v)
  }
  if (order) colKeys.sort(order)
  // a column with nothing under this field leaves the matrix (a 2×2 has no effect size, a term no
  // log₂FC)
  const filled = new Set<string>()
  for (let i = 0; i < src.n; i++) {
    const r = src.ctx(i)
    const v = src.value(i)
    if (v != null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)))
      filled.add(colOf(r))
  }
  for (let i = colKeys.length - 1; i >= 0; i--) if (!filled.has(colKeys[i])) colKeys.splice(i, 1)
  // the unsigned columns first (a two-way ANOVA's terms, ahead of its 2×2s)
  if (unsignedCols.size)
    colKeys.sort((a, b) => Number(unsignedCols.has(b)) - Number(unsignedCols.has(a)))
  let cell: ((v: unknown) => CSSProperties | undefined) | undefined
  let unsignedCell: ((v: unknown) => CSSProperties | undefined) | undefined
  if (!field.text) {
    const signed = values.some((v) => v < 0)
    cell = signed
      ? divergeStyle(
          values.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
          palettes.fc
        )
      : heatStyle(valueRange(values), palettes.data)
    if (unsignedValues.length) unsignedCell = heatStyle(valueRange(unsignedValues), palettes.data)
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
      cellStyle: unsignedCols.has(col) ? unsignedCell : cell
    }))
  ]
  return { columns, rows: uidOrder.map((u) => byUid.get(u)!) }
}
export const contrastTables = new WeakMap<object, Map<string, TableData<ContrastResultRow>>>()
/** A contrast's rows of the feature on the switcher (rowsOfFeatureNamed), for its table — cached
 *  per result and feature, so the table's memos hold across renders. */
export function contrastTableData(
  holder: { rows: readonly ContrastResultRow[] },
  feature: string | undefined
): TableData<ContrastResultRow> {
  let m = contrastTables.get(holder)
  if (!m) contrastTables.set(holder, (m = new Map()))
  const key = feature ?? '\u0000'
  let d = m.get(key)
  if (!d) {
    const ix = contextOf(holder)
    const ctx = rowsOfFeatureNamed(ix.rows as ContrastResultRow[], feature) as ContextRow[]
    const view = rowView(
      holder,
      ctx.length === ix.rows.length ? undefined : contextIndices(ix, ctx)
    )
    const all = contextRowAt(ix)
    d = { view, ctx, ctxAt: (i) => all[view.at(i)] }
    m.set(key, d)
  }
  return d
}
/** presentFields over a view (its columns read, no row built). */
export function presentFieldsOf<T>(view: RowView<T>, all: MatrixField[]): MatrixField[] {
  return all.filter((f) => {
    const col = view.col(f.key)
    for (let i = 0; i < view.n; i++) {
      const v = col(i)
      if (v != null && v !== '' && (f.text || Number.isFinite(v as number))) return true
    }
    return false
  })
}
/** presentFields over cell readers (`cell(key)(i)` row i's value; no row built). */
export function presentFieldsBy(
  n: number,
  cell: (key: string) => (i: number) => unknown,
  all: MatrixField[]
): MatrixField[] {
  return all.filter((f) => {
    const col = cell(f.key)
    for (let i = 0; i < n; i++) {
      const v = col(i)
      if (v != null && v !== '' && (f.text || Number.isFinite(v as number))) return true
    }
    return false
  })
}
/** tableRows over a view, as a table source: the rows grouped by gene (groupByGene's order), each
 *  cell read off its column, and a display row built only for the rows the table shows. */
export function longSource<T extends { uniqID: string; extra?: Record<string, string> }>(
  view: RowView<T>,
  displayMap: Record<string, string>,
  /** a field's values by view row (default: its column) — for cells a table works out */
  cellOf: (key: string) => (i: number) => unknown = view.col,
  /** a built row as the table shows it (default: as it is) */
  shape: (o: T) => T = (o) => o
): TableSource {
  const uid = view.col('uniqID')
  const extra = view.col('extra')
  const blocks = new Map<unknown, number[]>()
  for (let i = 0; i < view.n; i++) {
    const u = uid(i)
    let b = blocks.get(u)
    if (!b) blocks.set(u, (b = []))
    b.push(i)
  }
  const order = Int32Array.from([...blocks.values()].flat())
  const built = new Map<number, Record<string, unknown>>()
  return {
    n: order.length,
    cell: (key, j) => {
      const i = order[j]
      if (key === 'gene') return displayMap[uid(i) as string] ?? ''
      const c = key as ConditionKey
      if (isCustomCond(c)) return (extra(i) as Record<string, string> | undefined)?.[customSlug(c)]
      return cellOf(key)(i)
    },
    row: (j) => {
      let r = built.get(j)
      if (!r) {
        const o = shape(view.rows([order[j]])[0])
        r = { ...o, gene: displayMap[o.uniqID] ?? '', ...flatConds(o) }
        built.set(j, r)
      }
      return r
    }
  }
}
/** The fields of `all` that carry at least one value in these rows, in `all`'s order. */
export function presentFields<T>(rows: T[], all: MatrixField[]): MatrixField[] {
  return all.filter((f) =>
    rows.some((r) => {
      const v = (r as unknown as Record<string, unknown>)[f.key]
      return v != null && v !== '' && (f.text || Number.isFinite(v as number))
    })
  )
}
/** Cell choices for the comparison matrix (log2FC first — the heatmap's field). */
export const COMPARE_FIELDS: MatrixField[] = [
  { key: 'log2FC', label: 'log₂FC' },
  // a two-way ANOVA term's unsigned effect size (its rows carry no log₂FC in the table)
  { key: 'effectSize', label: 'effect size' },
  { key: 'pP', label: '−log₁₀ P-value' },
  { key: 'pQ', label: '−log₁₀ Q-value' },
  { key: 'mean1', label: 'mean1' },
  { key: 'mean2', label: 'mean2' },
  // a curve fit's own (see curveMetrics)
  { key: 'pEC50', label: 'pEC50' },
  { key: 'R2', label: 'R²' },
  { key: 'relevance', label: 'relevance' },
  { key: 'q_decoy', label: 'q (decoy)' },
  // a two-way ANOVA term's F-test
  { key: 'F', label: 'F' },
  { key: 'effect', label: 'effect', text: true }
]
/** Cell choices for the contrast matrix (FCdiff first — the divergence). */
export const CONTRAST_FIELDS: MatrixField[] = [
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
export function namedMeanFields(rows: CompareResultRow[]): MatrixField[] {
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
export function compareMatrix(
  rows: CompareResultRow[],
  displayMap: Record<string, string>,
  field: MatrixField,
  palettes: { fc: PaletteRef; data: PaletteRef }
): { columns: Column[]; rows: Record<string, unknown>[] } {
  return compareMatrixOver(
    rows,
    {
      n: rows.length,
      uid: (i) => rows[i].uniqID,
      ctx: (i) => rows[i],
      value: (i) => (rows[i] as unknown as Record<string, unknown>)[field.key]
    },
    displayMap,
    field,
    palettes
  )
}
/** compareMatrix over a pivot source: the column dims worked out from `ctxRows` (the result's
 *  context tuples, or its rows), the cells read off the source. */
export function compareMatrixOver(
  ctxRows: readonly ContextRow[],
  src: PivotSource<ContextRow>,
  displayMap: Record<string, string>,
  field: MatrixField,
  palettes: { fc: PaletteRef; data: PaletteRef }
): { columns: Column[]; rows: Record<string, unknown>[] } {
  const rows = ctxRows as ContextRow[]
  const consumed = new Set<string>()
  for (const r of rows) for (const p of String(r.cmp_cond).split(':')) if (p) consumed.add(p)
  const ctxDims = condsIn(rows).filter(
    (c) => !consumed.has(c) && rows.some((r) => ctxValue(r, c) != null && ctxValue(r, c) !== '')
  )
  return pivotOver(
    src,
    displayMap,
    field,
    (r) => [r.comparison, ...ctxDims.map((c) => ctxLabel(c, ctxValue(r, c)))].join(' · '),
    undefined,
    (r) => [{ key: 'comparison', value: r.comparison ?? '' }, ...ctxLines(r, ctxDims)],
    palettes,
    (r) => r.term != null
  )
}
/** by result — or, for a plain one, by its rows array (the readers hold it: see partKey) */
export const compareTables = new WeakMap<object, CompareTableData | null>()
export function compareTableData(
  cmp: { rows: readonly CompareResultRow[] },
  analysis: CompareConfig['analysis']
): CompareTableData | null {
  if (analysis === 'curve_fit') return null
  const at: object = holderTable(cmp) ? cmp : cmp.rows
  if (compareTables.has(at)) return compareTables.get(at)!
  let out: CompareTableData | null = null
  if (!someNested(cmp, 'curve', 'axis', (on) => on) && !someNested(cmp, 'rs', 'axis', (on) => on)) {
    const ix = contextOf(cmp)
    const view = rowView(cmp)
    const all = contextRowAt(ix)
    const hasF = nestedPresent(cmp, 'ftest')
    const [F, df1, df2] = ['F', 'df1', 'df2'].map((k) => nestedCol(cmp, 'ftest', k))
    const term = view.col('term')
    const fc = view.col('log2FC')
    const slope = view.col('slope')
    const model = view.col('model')
    const cells = new Map<string, (i: number) => unknown>()
    const cell = (key: string): ((i: number) => unknown) => {
      let read = cells.get(key)
      if (!read) {
        const own = view.col(key)
        read =
          key === 'F'
            ? (i) => (hasF(i) ? F(i) : own(i))
            : key === 'df'
              ? (i) => (hasF(i) ? `${df1(i)}, ${Math.round(df2(i) as number)}` : own(i))
              : key === 'log2FC'
                ? (i) => (hasF(i) && term(i) ? null : own(i))
                : key === 'effectSize'
                  ? (i) => (hasF(i) && term(i) ? fc(i) : own(i))
                  : own
        cells.set(key, read)
      }
      return read
    }
    const ctxNo = new Map(ix.rows.map((c, k) => [c, k]))
    const seen = new Map<string, number>()
    for (let i = 0; i < view.n; i++) {
      const k = `${ctxNo.get(all[i])}|${slope(i) != null}|${hasF(i)}|${!!model(i)}`
      if (!seen.has(k)) seen.set(k, i)
    }
    out = {
      view,
      ctx: ix.rows,
      ctxAt: (i) => all[i],
      cell,
      reps: rowsAt(
        cmp,
        [...seen.values()].sort((a, b) => a - b)
      )
    }
  }
  compareTables.set(at, out)
  return out
}
/** A Compare row as its table shows it: a curve fit's metrics alongside (pEC50, relevance…), a
 *  response fit's, or a two-way ANOVA row's F-test and df — and a term's effect size in its own
 *  column (not a fold change). */
export function compareCellRow(
  r: CompareResultRow,
  threshold: ThresholdConfig | undefined,
  doseScale: number
): CompareResultRow {
  return r.curve
    ? ({
        ...r,
        ...curveMetrics(
          r.log2FC,
          r.curve,
          threshold,
          doseScale,
          // a flat curve has no midpoint: no potency (the plots can force it to 0)
          curveIsFlat(r, threshold) ? 'na' : undefined
        )
      } as CompareResultRow)
    : r.rs
      ? ({ ...r, ...responseMetrics(r, doseScale, threshold) } as CompareResultRow)
      : r.ftest
        ? ({
            ...r,
            ...(r.term ? { log2FC: null, effectSize: r.log2FC } : null),
            F: r.ftest.F,
            df: `${r.ftest.df1}, ${Math.round(r.ftest.df2)}`
          } as CompareResultRow)
        : r
}
/** Columns for a contrast (compare-vs-compare) table. */
export function contrastColumns(
  rows: ContextRow[],
  numeric: NumericConds,
  units?: CondUnits
): Column[] {
  const name = contrastValueName(rows)
  const cols: Column[] = [
    { key: 'uniqID', label: 'uniqID' },
    { key: 'gene', label: 'gene' },
    ...condColumns(rows, numeric, ['cell', 'dose', 'time'], units)
  ]
  cols.push(
    { key: 'FC1', label: valueLabel('FC1', name), align: 'right', format: fixed(3) },
    { key: 'FC2', label: valueLabel('FC2', name), align: 'right', format: fixed(3) },
    { key: 'FCdiff', label: valueLabel('FCdiff', name), align: 'right', format: fixed(3) },
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
export function contrastMatrix(
  data: TableData<ContrastResultRow>,
  displayMap: Record<string, string>,
  field: MatrixField,
  palettes: { fc: PaletteRef; data: PaletteRef }
): { columns: Column[]; rows: Record<string, unknown>[] } {
  // the column dims, from the context tuples; the cells, off the view's columns
  const rows = data.ctx
  const dims = condsIn(rows).filter((c) => condPresent(rows, c))
  // Column label → its raw context tuple, kept for the numeric-aware ordering below.
  const tupleOf = new Map<string, unknown[]>()
  const colOf = (r: ContextRow): string => {
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
  const uid = data.view.col('uniqID')
  return pivotOver(
    {
      n: data.view.n,
      uid: (i) => uid(i) as string,
      ctx: data.ctxAt,
      value: data.view.col(field.key)
    },
    displayMap,
    field,
    colOf,
    order,
    (r) => (dims.length ? ctxLines(r, dims) : [{ key: '', value: field.label }]),
    palettes
  )
}
