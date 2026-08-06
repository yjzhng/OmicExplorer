/** Pure table-export planning: turn a standardize/compare/contrast result into the same
 *  columns the dashboard shows, as a cell matrix ready for CSV/XLSX writing. Mirrors the
 *  column logic in dashboard/PanelBody so exports match what the user sees — but emits raw
 *  (full-precision) values, not the 3-decimal display format. No React imports. */
import type { Edge } from '@xyflow/react'

import { deriveGroups } from '../graph/groups'
import {
  isStep,
  type CompareConfig,
  type GraphNode,
  type NodeResult,
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

/** Standardized table → columns + rows (strain shown only when the data carries it). */
function standardizeTable(result: Extract<NodeResult, { kind: 'standardize' }>): {
  columns: string[]
  rows: Cell[][]
} {
  const dm = result.std.displayMap
  const src = result.std.rows
  const showStrain = present(src, 'strain')
  const cols = [
    'uniqID',
    'gene',
    ...(showStrain ? ['strain'] : []),
    'cmpd',
    'dose',
    'time',
    'rep',
    'value'
  ]
  const rows = src.map((r) => {
    const gene = dm[r.uniqID] ?? ''
    return cols.map((c): Cell => {
      if (c === 'gene') return gene
      return (r as unknown as Record<string, Cell>)[c] ?? null
    })
  })
  return { columns: cols, rows }
}

/** Comparison table → columns + rows (two-way's log2FC is an interaction term). */
function compareTable(
  result: Extract<NodeResult, { kind: 'compare' }>,
  analysis: CompareConfig['analysis']
): { columns: string[]; rows: Cell[][] } {
  const dm = result.displayMap
  const src = result.cmp.rows
  const multiCmp = new Set(src.map((r) => r.comparison)).size > 1
  const cols = [
    'uniqID',
    'gene',
    ...(multiCmp ? ['comparison'] : []),
    ...(present(src, 'strain') ? ['strain'] : []),
    ...(present(src, 'cmpd') ? ['cmpd'] : []),
    ...(present(src, 'dose') ? ['dose'] : []),
    ...(present(src, 'time') ? ['time'] : []),
    'log2FC',
    'pP',
    'pQ',
    'signf',
    'effect'
  ]
  const label = analysis === 'two_way_anova' ? 'interaction' : 'log2FC'
  const headers = cols.map((c) => (c === 'log2FC' ? label : c))
  const rows = src.map((r) => {
    const gene = dm[r.uniqID] ?? ''
    return cols.map((c): Cell => {
      if (c === 'gene') return gene
      if (c === 'signf') return b(r.signf)
      return (r as unknown as Record<string, Cell>)[c] ?? null
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
  const src = result.ctr.rows
  const cols = [
    'uniqID',
    'gene',
    ...(present(src, 'strain') ? ['strain'] : []),
    ...(present(src, 'dose') ? ['dose'] : []),
    ...(present(src, 'time') ? ['time'] : []),
    'FC1',
    'FC2',
    'FCdiff',
    'signf1',
    'signf2',
    'signf',
    'effect'
  ]
  const rows = src.map((r) => {
    const gene = dm[r.uniqID] ?? ''
    return cols.map((c): Cell => {
      if (c === 'gene') return gene
      if (c === 'signf' || c === 'signf1' || c === 'signf2')
        return b((r as unknown as Record<string, boolean>)[c])
      return (r as unknown as Record<string, Cell>)[c] ?? null
    })
  })
  return { columns: cols, rows }
}

const KIND_LABEL: Record<string, string> = {
  standardize: 'Standardized',
  compare: 'Comparison',
  contrast: 'Contrast'
}

/** Prefer the concrete comparison names for the folder/sheet label. */
function analysisLabel(node: StepNode, result: NodeResult): string {
  if (result.kind === 'compare') return result.cmp.comparisons.join(', ')
  if (result.kind === 'contrast') return result.ctr.comparisons.join(', ')
  return `Standardize ${node.id}`
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
    if (result.kind === 'standardize') built = standardizeTable(result)
    else if (result.kind === 'compare')
      built = compareTable(result, (node.data.config as CompareConfig).analysis)
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
