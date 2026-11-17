/** The table a results tile shows right now — its view's columns and rows as the table draws them —
 *  so its Download writes exactly that (the same columns, headed the same, in the same order),
 *  rather than a separate export of the result that can drift from it. A tile's table registers it
 *  while on show (tableOnShow below); the download reads it back by the tile's key. */
import type { Column, TableSource } from '../ui/DataTableView'

export interface ShownTable {
  columns: Column[]
  rows: ReadonlyArray<Record<string, unknown>> | TableSource
  /** what it is, for its file name — its view ("Comparison matrix (log₂FC)", "Comparison table") */
  name?: string
}

const shown = new Map<string, ShownTable>()

/** Register `key`'s table on show; returns the unregistering (an effect's cleanup). */
export function showTable(key: string, table: ShownTable): () => void {
  shown.set(key, table)
  return () => {
    if (shown.get(key) === table) shown.delete(key)
  }
}

/** The table `key` shows now, if it registered one. */
export const tableOnShow = (key: string): ShownTable | undefined => shown.get(key)

type Cell = string | number | null

/** A shown table as a file's columns and rows: each column under its header (a header's ` · `
 *  parts kept as they read), every row in the table's own order. A number stays a number (full
 *  precision — the on-screen rounding is display only); anything else is written as the table
 *  shows it (its column's format: an effect's name, a condition's value). */
export function shownTableExport(t: ShownTable): { columns: string[]; rows: Cell[][] } {
  const src: TableSource = Array.isArray(t.rows)
    ? {
        n: t.rows.length,
        cell: (k, i) => (t.rows as ReadonlyArray<Record<string, unknown>>)[i][k],
        row: (i) => (t.rows as ReadonlyArray<Record<string, unknown>>)[i]
      }
    : (t.rows as TableSource)
  const cellOf = (c: Column, v: unknown): Cell => {
    if (v == null) return null
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    return c.format ? c.format(v) : String(v)
  }
  const rows: Cell[][] = []
  for (let i = 0; i < src.n; i++) rows.push(t.columns.map((c) => cellOf(c, src.cell(c.key, i))))
  return { columns: t.columns.map((c) => c.label), rows }
}
