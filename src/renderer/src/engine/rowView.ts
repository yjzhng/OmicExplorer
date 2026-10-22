/**
 * A result's rows seen through their columns (Phase 2 of the columnar store: the hot readers read
 * columns). A view is `n` rows — all of a result's, or a selection of them (`sel`, e.g. one
 * feature's) — with a reader per field and `rows(idx)` to build just the rows something shows.
 *
 * A reader that scans a large result (a table's columns, a pivot, which fields carry values) goes
 * through a view instead of `rows`: on a columnar result (lazyRows.ts) it reads the fields it needs
 * straight off their columns and never builds a row object; on a plain array it reads the objects.
 * Either way the answer is the one `rows` gives.
 */
import { holderTable, rowsAt } from './lazyRows'
import { nestedColumn, tableColumn, type Table } from './wire'

export interface RowView<T> {
  /** how many rows the view holds */
  n: number
  /** field `key`'s value by view row (absent → undefined) */
  col: (key: string) => (i: number) => unknown
  /** the view rows at `idx`, built (only those) — the same objects the result's `rows` holds */
  rows: (idx: ArrayLike<number>) => T[]
  /** the result row behind view row i */
  at: (i: number) => number
}

/** A view of a result's rows — all of them, or those at `sel` (ascending result-row indices). */
export function rowView<T>(holder: { rows: readonly T[] }, sel?: ArrayLike<number>): RowView<T> {
  const t: Table | undefined = holderTable(holder)
  const n = sel ? sel.length : t ? t.n : holder.rows.length
  const at = sel ? (i: number): number => sel[i] : (i: number): number => i
  const readers = new Map<string, (i: number) => unknown>()
  const col = (key: string): ((i: number) => unknown) => {
    let read = readers.get(key)
    if (!read) {
      if (t) {
        const c = tableColumn(t, key)
        read = c ? (i) => c(at(i)) : (): undefined => undefined
      } else {
        const all = holder.rows
        read = (i) => (all[at(i)] as Record<string, unknown>)[key]
      }
      readers.set(key, read)
    }
    return read
  }
  return {
    n,
    col,
    at,
    rows: (idx) => rowsAt(holder, sel ? Array.from(idx, (i) => sel[i]) : idx)
  }
}

/** A view of plain rows (what a reader that takes a view is handed an array as). */
export const arrayView = <T>(rows: readonly T[]): RowView<T> => rowView({ rows })

/**
 * A one-pass scan of a result's rows for a reader that keeps none of them (a QC summary, a
 * heatmap's cells): a columnar result yields ONE object, refilled with `keys` for each row in
 * turn (absent fields read as undefined) — so the scan builds nothing — and a plain one yields its
 * rows. The reader must copy what it keeps; the yielded object is overwritten by the next row.
 */
export function* scanRows<T>(holder: { rows: readonly T[] }, keys: readonly string[]): Generator<T> {
  const t = holderTable(holder)
  if (!t) {
    yield* holder.rows
    return
  }
  const cols = keys.map((k) => [k, tableColumn(t, k)] as const)
  const o: Record<string, unknown> = {}
  for (let r = 0; r < t.n; r++) {
    for (const [k, c] of cols) o[k] = c ? c(r) : undefined
    yield o as T
  }
}

/** One field's values over a result's rows, in order — read off its column when it's columnar
 *  (a plain array of values: no row built). */
export function valuesOf<T>(holder: { rows: readonly T[] }, key: string): unknown[] {
  const v = rowView(holder)
  const col = v.col(key)
  return Array.from({ length: v.n }, (_, i) => col(i))
}

/** Whether any row passes `test(present, sub)` on a nested record field — `present` is the record's
 *  truthiness (`!!r[key]`), `sub` its field (`r[key]?.[sub]`) — read off the nested table's column
 *  when the result is columnar (nestedColumn), so no record or row is built. */
export function someNested<T>(
  holder: { rows: readonly T[] },
  key: string,
  sub: string,
  test: (present: boolean, value: unknown) => boolean
): boolean {
  const t = holderTable(holder)
  if (!t)
    return holder.rows.some((r) => {
      const rec = (r as Record<string, unknown>)[key] as Record<string, unknown> | null | undefined
      return test(!!rec, rec?.[sub])
    })
  const c = nestedColumn(t, key, sub)
  if (!c) return false
  for (let r = 0; r < t.n; r++) if (test(c.has(r), c.at(r))) return true
  return false
}

/** A nested record field's values by row (`r[key]?.[sub]`), read off the nested table's column
 *  when the result is columnar (nestedColumn) — no record or row built. */
export function nestedCol<T>(
  holder: { rows: readonly T[] },
  key: string,
  sub: string
): (r: number) => unknown {
  const t = holderTable(holder)
  if (!t) {
    const rows = holder.rows
    return (r) =>
      ((rows[r] as Record<string, unknown>)[key] as Record<string, unknown> | null | undefined)?.[
        sub
      ]
  }
  return nestedColumn(t, key, sub)?.at ?? ((): undefined => undefined)
}

/** Whether each row's nested record field is there (`!!r[key]`), read off its column when the
 *  result is columnar — no record or row built. */
export function nestedPresent<T>(holder: { rows: readonly T[] }, key: string): (r: number) => boolean {
  const t = holderTable(holder)
  if (!t) {
    const rows = holder.rows
    return (r) => !!(rows[r] as Record<string, unknown>)[key]
  }
  const col = tableColumn(t, key)
  const c = t.cols[key]
  if (c && (c.k === 'o' || c.k === 'O')) return nestedColumn(t, key, '')!.has
  return col ? (r) => !!col(r) : (): boolean => false
}
