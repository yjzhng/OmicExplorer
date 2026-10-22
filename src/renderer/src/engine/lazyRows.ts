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
import { decodeRowAt, encodeTable, rowDecoder, T_MAIN, T_NULL, type Table } from './wire'

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
  /** The row objects built so far, by row — shared by `rows` and every subset (rowsAt), so a row
   *  is one object however it's reached. Held like the rows (HOLD_MS after the last read). */
  objs?: Array<Obj | undefined>
  /** builds a row (and the nested records it points to, each once) — lives as long as `objs` */
  dec?: (r: number) => Obj
  /** the subsets handed out (weakly): rows still held through one keep their object when `objs`
   *  is rebuilt after a release */
  subsets: Array<{ idx: Int32Array; ref: WeakRef<Obj[]> }>
  /** how many subsets before the dead ones are next dropped (doubles past the live ones, so a
   *  burst of rowsAt calls — every gene's rows in turn — prunes in linear time) */
  prune: number
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
      s.objs = undefined
      s.dec = undefined
      s.subsets = s.subsets.filter((x) => x.ref.deref())
      held.delete(s)
    }
  if (!held.size && sweeper) {
    clearInterval(sweeper)
    sweeper = null
  }
}

/** Mark the slot read now (its built rows held another HOLD_MS); `rows`: the full array too. */
function hold(slot: Slot, rows?: Obj[]): void {
  if (rows) slot.strong = rows
  slot.last = now()
  if (!held.has(slot)) {
    held.add(slot)
    sweeper ??= setInterval(sweep, SWEEP_MS)
  }
}

/** The slot's row objects so far — after a release, whatever is still held elsewhere (the full
 *  array, a subset) taken back, so nothing holding a row ever sees a second object for it. */
function objsOf(slot: Slot): Array<Obj | undefined> {
  if (slot.objs) return slot.objs
  const full = slot.strong ?? slot.weak?.deref()
  if (full) return (slot.objs = full)
  const objs: Array<Obj | undefined> = new Array(slot.table.n)
  for (const { idx, ref } of slot.subsets) {
    const got = ref.deref()
    if (got) for (let k = 0; k < idx.length; k++) objs[idx[k]] ??= got[k]
  }
  return (slot.objs = objs)
}

function rowAt(slot: Slot, objs: Array<Obj | undefined>, r: number): Obj {
  return (objs[r] ??= (slot.dec ??= rowDecoder(slot.table, true))(r))
}

function rowsOf(slot: Slot): Obj[] {
  let rows = slot.strong ?? slot.weak?.deref()
  if (!rows) {
    const objs = objsOf(slot)
    rows = new Array(slot.table.n)
    for (let r = 0; r < rows.length; r++) rows[r] = rowAt(slot, objs, r)
    slot.objs = rows
    slot.weak = new WeakRef(rows)
    tableOfRows.set(rows, slot.table)
  }
  hold(slot, rows)
  return rows
}

/** Subsets kept track of per slot before the dead ones are dropped. */
const SUBSETS_KEPT = 64

/**
 * Some of a holder's rows, by index (ascending, as `rows` holds them): built from its table when
 * its `rows` is lazy — only these rows, and the same objects `rows` and every other subset hand
 * out — else picked from its plain `rows`. What a view reads when it shows a part of a large
 * result (one facet), so the rest are never built.
 */
export function rowsAt<T>(holder: { rows: readonly T[] }, idx: ArrayLike<number>): T[] {
  const slot = slotOf.get(holder)
  if (!slot) {
    const all = holder.rows
    return Array.from(idx, (r) => all[r])
  }
  const objs = objsOf(slot)
  const out = Array.from(idx, (r) => rowAt(slot, objs, r))
  hold(slot)
  if (slot.subsets.length >= slot.prune) {
    slot.subsets = slot.subsets.filter((x) => x.ref.deref())
    slot.prune = Math.max(SUBSETS_KEPT, 2 * slot.subsets.length)
  }
  slot.subsets.push({ idx: Int32Array.from(idx), ref: new WeakRef(out) })
  return out as T[]
}

/** Make `holder.rows` a lazy view of `table`. `seed` (the table's rows as they already are, when
 *  compacting) is handed out until it is released, so nothing holding it sees a new array. */
export function attachLazyRows(holder: Obj, table: Table, seed?: Obj[]): void {
  const slot: Slot = { table, last: 0, subsets: [], prune: SUBSETS_KEPT }
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

/** A copy of `holder` with `fields` set — its own fields copied as they are, a lazy `rows` left
 *  lazy over `table` (a spread would build every row) — or null when `holder` has no lazy rows. */
export function lazyCopy<T extends object>(
  holder: T,
  fields: Partial<T>,
  table: Table
): T | null {
  if (!slotOf.get(holder)) return null
  const out: Obj = {}
  for (const k of Object.keys(holder)) if (k !== 'rows') out[k] = (holder as Obj)[k]
  Object.assign(out, fields)
  attachLazyRows(out, table)
  return out as T
}

/** A holder's table with one plain-number column mapped (`f` null → the row's value is null; the
 *  rows that held null or lacked the key keep that) — what
 *  `rows.map((r) => ({ ...r, [key]: r[key] == null ? r[key] : f(r[key]) }))` reads as, without
 *  building a row. Null when the rows aren't lazy, or the column isn't one of plain numbers. */
export function tableWithNumbers(
  holder: object,
  key: string,
  f: (v: number) => number | null
): Table | null {
  const t = slotOf.get(holder)?.table
  const col = t?.cols[key]
  if (!t || !col || col.k !== 'f' || col.x) return null
  const v = new Float64Array(col.v.length)
  let tags = col.t
  for (let i = 0; i < v.length; i++) {
    if (tags && tags[i] !== T_MAIN) continue
    const y = f(col.v[i])
    if (y === null) {
      if (tags === col.t) tags = col.t ? col.t.slice() : new Uint8Array(v.length)
      tags![i] = T_NULL
    } else v[i] = y
  }
  return { ...t, cols: { ...t.cols, [key]: tags ? { k: 'f', v, t: tags } : { k: 'f', v } } }
}
