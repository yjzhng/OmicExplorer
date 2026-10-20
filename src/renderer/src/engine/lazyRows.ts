/**
 * Large row tables kept as columns, their row objects built only while something reads them.
 *
 * A result's `rows` (a Clean data table's gene × sample rows, a Compare's or a Contrast's result
 * rows) is the one shape the whole app reads. Held as hundreds of thousands of separate objects it
 * is also most of the app's memory — and a heap that size makes every garbage collection slow. So
 * a large table is kept as a columnar table (wire.ts), and its holder's `rows` is a getter:
 *
 *  - the first read builds the row objects from the columns;
 *  - while they are in recent use (read within HOLD_MS) they are held, so every read returns the
 *    SAME array — views memoised on it don't redraw;
 *  - after that they are held only weakly: still the same array for as long as anything (a mounted
 *    plot, a memo) keeps it, and released once nothing does. The next read builds them again.
 *
 * Reading code never knows: `rows` is a plain array of plain objects, as before. Writing `rows`
 * replaces the getter with the value written. A rows array built here maps back to its table
 * (rowsTable), so sending it to the worker reuses the columns instead of encoding them again.
 */
import { decodeRowAt, decodeTable, encodeTable, type Table } from './wire'

/** Tables shorter than this stay plain arrays (not worth the indirection). */
export const LAZY_MIN_ROWS = 2000
/** How long rows built from a table are held after their last read. */
const HOLD_MS = 20000
const SWEEP_MS = 5000

type Obj = Record<string, unknown>

interface Slot {
  table: Table
  strong?: Obj[]
  weak?: WeakRef<Obj[]>
  last: number
  /** row 0 decoded on its own, for peeks while the rows aren't built */
  first?: Obj
}

/** A rows array built from (or compacted into) a table → that table. */
const tableOfRows = new WeakMap<object, Table>()
/** A holder whose `rows` is lazy → its slot. */
const slotOf = new WeakMap<object, Slot>()

/** Slots holding their rows strongly, released by the sweep once unread for HOLD_MS. */
const held = new Set<Slot>()
let sweeper: ReturnType<typeof setInterval> | null = null
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function sweep(): void {
  const t = now()
  for (const s of held)
    if (t - s.last > HOLD_MS) {
      s.strong = undefined
      held.delete(s)
    }
  if (!held.size && sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
}

function hold(slot: Slot, rows: Obj[]): void {
  slot.strong = rows
  slot.last = now()
  if (!held.has(slot)) {
    held.add(slot)
    sweeper ??= setInterval(sweep, SWEEP_MS)
  }
}

function rowsOf(slot: Slot): Obj[] {
  let rows = slot.strong ?? slot.weak?.deref()
  if (!rows) {
    rows = decodeTable(slot.table, true)
    slot.weak = new WeakRef(rows)
    tableOfRows.set(rows, slot.table)
  }
  hold(slot, rows)
  return rows
}

/** Make `holder.rows` a lazy view of `table`. `seed` (the table's rows as they already are, when
 *  compacting) is handed out until it is released, so nothing holding it sees a new array. */
export function attachLazyRows(holder: Obj, table: Table, seed?: Obj[]): void {
  const slot: Slot = { table, last: 0 }
  if (seed) {
    slot.weak = new WeakRef(seed)
    tableOfRows.set(seed, table)
    hold(slot, seed)
  }
  slotOf.set(holder, slot)
  Object.defineProperty(holder, 'rows', {
    enumerable: true,
    configurable: true,
    get: () => rowsOf(slot),
    set(v: unknown) {
      slotOf.delete(holder)
      Object.defineProperty(holder, 'rows', {
        value: v,
        writable: true,
        enumerable: true,
        configurable: true
      })
    }
  })
}

/** The table behind a lazy holder's `rows`, without building the rows. */
export const holderTable = (holder: object): Table | undefined => slotOf.get(holder)?.table

/** How many rows a holder has, without building them. */
export function rowCount(holder: { rows: readonly unknown[] }): number {
  const slot = slotOf.get(holder)
  return slot ? slot.table.n : holder.rows.length
}

/** A holder's first row, without building the others (a peek: what kind of rows these are). */
export function firstRow<T>(holder: { rows: readonly T[] }): T | undefined {
  const slot = slotOf.get(holder)
  if (!slot) return holder.rows[0]
  const built = slot.strong ?? slot.weak?.deref()
  if (built) return built[0] as T
  if (slot.table.n === 0) return undefined
  slot.first ??= decodeRowAt(slot.table, 0)
  return slot.first as T
}

/** The table a rows array was built from (or compacted into), if any. */
export const rowsTable = (rows: object): Table | undefined => tableOfRows.get(rows)

/** Whether every slot of `v` is a plain object (what a columnar table can hold). */
function allPlainRows(v: unknown[]): boolean {
  for (let i = 0; i < v.length; i++) {
    const r = v[i]
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return false
    const p = Object.getPrototypeOf(r)
    if (p !== Object.prototype && p !== null) return false
  }
  return true
}

/**
 * Turn a holder's plain `rows` array (one built on the UI thread: a project opened, a threshold
 * re-call) into a lazy view of a columnar table. `keep` hands the existing array out until it's
 * released (for rows something may already hold); without it the rows are rebuilt from the table
 * on the next read — which also packs a curve fit's surfaces (wire.ts list columns). Returns
 * whether it did anything.
 */
export function compactRows(holder: Obj, keep = false): boolean {
  const d = Object.getOwnPropertyDescriptor(holder, 'rows')
  if (!d || !('value' in d)) return false
  const rows = d.value as unknown
  if (!Array.isArray(rows) || rows.length < LAZY_MIN_ROWS || !allPlainRows(rows)) return false
  const known = tableOfRows.get(rows)
  // Its buffers stay here: nothing is transferred.
  const table = known ?? encodeTable(rows as Obj[], [])
  attachLazyRows(holder, table, keep ? (rows as Obj[]) : undefined)
  return true
}
