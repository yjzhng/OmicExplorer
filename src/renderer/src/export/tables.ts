/** Pure table-export planning: turn a standardize/compare/contrast result into the same
 *  columns the dashboard shows, as a cell matrix ready for CSV/XLSX writing. Mirrors the
 *  column logic in dashboard/PanelBody so exports match what the user sees — but emits raw
 *  (full-precision) values, not the 3-decimal display format. No React imports. */
import type { Edge } from '@xyflow/react'

import {
  condLabel,
  condPresent,
  curveMetrics,
  CURVE_METRICS,
  responseMetrics,
  RESPONSE_METRICS,
  customCondsIn,
  customSlug,
  isCustomCond,
  isInteractionRow,
  isSlopeRow,
  type ConditionKey,
  type CustomConditionKey,
  contextOf,
  presentStd,
  presentScaleOf,
  rowView,
  type RowView
} from '../engine'
import { deriveGroups } from '../graph/groups'
import {
  condUnitsFor,
  curveDoseUnit,
  isStep,
  type CompareConfig,
  type GraphNode,
  type NodeResult,
  type StandardizeConfig,
  type StepNode
} from '../graph/types'

/** A cell is a raw string/number, or null for a blank. */
export type Cell = string | number | null

export interface TableExport {
  /** node id — unique component of the filename */
  key: string
  /** analysis label (folder / sheet name), e.g. the comparison names */
  analysis: string
  /** table-kind label, e.g. "Comparison" */
  label: string
  /** column headers, in order */
  columns: string[]
  /** one array of cells per row, aligned to `columns` */
  rows: Cell[][]
}

const b = (v: boolean): string => (v ? 'true' : 'false')
const present = (rows: readonly unknown[], c: string): boolean =>
  rows.some((r) => {
    const v = (r as Record<string, unknown>)[c]
    return v !== '' && v != null
  })

/** The custom condition columns these rows carry. The internal column id is the condition key
 *  (`@slug`) so it can't collide with a result column; the exported HEADER is the plain name. */
function customCols(rows: ReadonlyArray<{ extra?: Record<string, string> }>): string[] {
  return customCondsIn(rows).filter((c) => condPresent(rows as never, c))
}

/** One exported cell for column `c`. A custom condition lives in the row's `extra` bag rather
 *  than as a column of its own, so it can't simply be indexed. */
function cellOf(r: object, c: string): Cell {
  if (isCustomCond(c as ConditionKey))
    return (
      (r as { extra?: Record<string, string> }).extra?.[customSlug(c as CustomConditionKey)] ?? null
    )
  return (r as unknown as Record<string, Cell>)[c] ?? null
}

/** cellOf by row index, read off a view's columns (no row built). */
function cellReader(view: RowView<unknown>, c: string): (i: number) => Cell {
  if (isCustomCond(c as ConditionKey)) {
    const extra = view.col('extra')
    const slug = customSlug(c as CustomConditionKey)
    return (i) => (extra(i) as Record<string, string> | undefined)?.[slug] ?? null
  }
  const col = view.col(c)
  return (i) => (col(i) as Cell | undefined) ?? null
}

/** A table's rows as cells, read off the result's columns (no row built): `cell(c)` overrides a
 *  column's reader. */
function cellRows(
  view: RowView<unknown>,
  cols: readonly string[],
  cell: (c: string) => ((i: number) => Cell) | undefined
): Cell[][] {
  const readers = cols.map((c) => cell(c) ?? cellReader(view, c))
  const rows: Cell[][] = new Array(view.n)
  for (let i = 0; i < view.n; i++) rows[i] = readers.map((read) => read(i))
  return rows
}

/** Standardized table → columns + rows (cell shown only when the data carries it). */
function standardizeTable(
  result: Extract<NodeResult, { kind: 'standardize' }>,
  logTransform?: StandardizeConfig['logTransform']
): {
  columns: string[]
  rows: Cell[][]
} {
  const dm = result.std.displayMap
  // On Clean data's presented scale (its chosen log-transform), as its table shows them.
  const std = presentStd(result.std, presentScaleOf(result.std, logTransform))
  // which columns: off the context tuples (every condition value the rows carry); the cells off
  // the columns — no row built
  const ctx = contextOf(std).rows
  const showCell = present(ctx, 'cell')
  const cols = [
    'uniqID',
    'gene',
    ...(showCell ? ['cell'] : []),
    'cmpd',
    'dose',
    'time',
    ...customCols(ctx),
    'rep',
    'value'
  ]
  const view = rowView(std)
  const uid = view.col('uniqID')
  const rows = cellRows(view, cols, (c) =>
    c === 'gene' ? (i) => dm[uid(i) as string] ?? '' : undefined
  )
  return { columns: cols.map((c) => condLabel(c as ConditionKey)), rows }
}

/** Comparison table → columns + rows (two-way's log2FC is an interaction term). */
function compareTable(
  result: Extract<NodeResult, { kind: 'compare' }>,
  analysis: CompareConfig['analysis'],
  dose: { unit?: string; scale: number } = { scale: 1 }
): { columns: string[]; rows: Cell[][] } {
  const dm = result.displayMap
  const src = result.cmp.rows
  const multiCmp = new Set(src.map((r) => r.comparison)).size > 1
  const t = result.cmp.threshold
  // A curve fit's metrics: CurveCurator's (curveMetrics), or the response surface method's
  // (responseMetrics) — whichever the rows carry.
  const response = src.some((r) => r.rs)
  const metrics: Array<Partial<Record<string, Cell | undefined>> | undefined> = src.map((r) =>
    r.curve
      ? curveMetrics(r.log2FC, r.curve, t, dose.scale)
      : r.rs
        ? responseMetrics(r, dose.scale, t)
        : undefined
  )
  const keys: readonly string[] = response ? RESPONSE_METRICS : CURVE_METRICS
  const curveCols =
    analysis === 'curve_fit' || metrics.some(Boolean)
      ? keys.filter((k) => metrics.some((m) => m?.[k] != null))
      : []
  const cols = [
    'uniqID',
    'gene',
    ...(multiCmp ? ['comparison'] : []),
    ...(present(src, 'cell') ? ['cell'] : []),
    ...(present(src, 'cmpd') ? ['cmpd'] : []),
    ...(present(src, 'dose') ? ['dose'] : []),
    ...(present(src, 'time') ? ['time'] : []),
    ...customCols(src),
    'log2FC',
    // A curve fit's metrics, as CurveCurator lists them (see curveMetrics); those it has.
    ...curveCols,
    'pP',
    'pQ',
    'signf',
    'effect',
    // A curve fit's final model: the 4PL, or M0 (flat) where its F-test doesn't reject flat.
    ...(src.some((r) => r.model) ? ['model'] : [])
  ]
  const label =
    analysis === 'anova' && src.some(isSlopeRow)
      ? 'slope'
      : analysis === 'anova' && src.some(isInteractionRow)
        ? 'interaction'
        : response
          ? 'peak_log2FC'
          : analysis === 'curve_fit'
            ? 'curve_log2FC'
            : 'log2FC'
  const headers = cols.map((c) =>
    c === 'log2FC'
      ? label
      : c === 'EC50' && dose.unit
        ? `EC50_${dose.unit.replace('µ', 'u')}`
        : condLabel(c as ConditionKey)
  )
  const curveSet = new Set<string>(curveCols)
  const rows = src.map((r, i) => {
    const gene = dm[r.uniqID] ?? ''
    return cols.map((c): Cell => {
      if (c === 'gene') return gene
      if (c === 'signf') return b(r.signf)
      if (curveSet.has(c)) return metrics[i]?.[c] ?? null
      return cellOf(r, c)
    })
  })
  return { columns: headers, rows }
}

/** Contrast (compare-vs-compare) table → columns + rows. */
function contrastTable(result: Extract<NodeResult, { kind: 'contrast' }>): {
  columns: string[]
  rows: Cell[][]
} {
  const dm = result.displayMap
  // which columns: off the context tuples (they carry the feature and every condition value);
  // the cells off the columns — no row built
  const ctx = contextOf(result.ctr).rows
  const cols = [
    // every feature the contrast offers, each row saying which
    ...(ctx.some((r) => r.feature) ? ['feature'] : []),
    'uniqID',
    'gene',
    ...(present(ctx, 'cell') ? ['cell'] : []),
    ...(present(ctx, 'dose') ? ['dose'] : []),
    ...(present(ctx, 'time') ? ['time'] : []),
    ...customCols(ctx),
    'FC1',
    'FC2',
    'FCdiff',
    'signf1',
    'signf2',
    'signf',
    'effect'
  ]
  const view = rowView(result.ctr)
  const uid = view.col('uniqID')
  const rows = cellRows(view, cols, (c) => {
    if (c === 'gene') return (i) => dm[uid(i) as string] ?? ''
    if (c === 'signf' || c === 'signf1' || c === 'signf2') {
      const col = view.col(c)
      return (i) => b(col(i) as boolean)
    }
    return undefined
  })
  return { columns: cols.map((c) => condLabel(c as ConditionKey)), rows }
}

const KIND_LABEL: Record<string, string> = {
  standardize: 'Clean data',
  compare: 'Comparison',
  contrast: 'Contrast'
}

/** Prefer the concrete comparison names for the folder/sheet label. */
function analysisLabel(node: StepNode, result: NodeResult): string {
  if (result.kind === 'compare') return result.cmp.comparisons.join(', ')
  if (result.kind === 'contrast') return result.ctr.comparisons.join(', ')
  return `Clean data ${node.id}`
}

/**
 * Enumerate exportable tables: every standardize/compare/contrast node that has produced
 * a result. When `only` is given, restrict to nodes whose id is in the set.
 */
export function collectTableExports(
  nodes: GraphNode[],
  edges: Edge[],
  results: Record<string, NodeResult>,
  only?: Set<string>
): TableExport[] {
  const out: TableExport[] = []
  // deriveGroups gives a stable, root-ordered listing of the analyses.
  for (const g of deriveGroups(nodes, edges)) {
    if (only && !only.has(g.rootId)) continue
    const node = nodes.find((n) => n.id === g.rootId)
    const result = results[g.rootId]
    if (!node || !isStep(node) || !result) continue
    let built: { columns: string[]; rows: Cell[][] } | null = null
    if (result.kind === 'standardize')
      built = standardizeTable(result, (node.data.config as StandardizeConfig).logTransform)
    else if (result.kind === 'compare')
      built = compareTable(
        result,
        (node.data.config as CompareConfig).analysis,
        curveDoseUnit(node.data.config as CompareConfig, condUnitsFor({ nodes, edges }, node.id))
      )
    else if (result.kind === 'contrast') built = contrastTable(result)
    if (!built) continue
    out.push({
      key: g.rootId,
      analysis: analysisLabel(node, result),
      label: KIND_LABEL[result.kind] ?? 'Table',
      columns: built.columns,
      rows: built.rows
    })
  }
  return out
}
