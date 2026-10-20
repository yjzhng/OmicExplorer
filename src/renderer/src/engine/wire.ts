/**
 * Columnar wire format for engine messages. A result's row tables (a Clean data table's gene ×
 * sample rows, a Compare's result rows) cross the worker boundary as columns instead of as
 * hundreds of thousands of separate objects:
 *
 *  - numbers / booleans go as typed arrays, TRANSFERRED (moved, not copied);
 *  - strings go as their distinct values plus an index per row, so the receiver holds ONE copy of
 *    each repeated string ("E28 | DMSO", a uniqID across every sample) instead of one per row;
 *  - nested records (a curve fit, custom conditions) go as a table of their own;
 *  - lists of records (a surface's cells, its slices) go as one table of every row's items, with
 *    each row's range of it.
 *
 * Structured clone rebuilds every row object generically and copies every string; decoding here
 * builds the rows in a plain loop. The rows that come out are the ones that went in — same keys in
 * the same order, NaN / ±Infinity / −0 / undefined / an absent field all kept apart — so nothing
 * downstream can tell the difference.
 *
 * The same tables are how the UI thread keeps its large results (lazyRows.ts): decoded lazily, a
 * table's `rows` is built only when read, and a long list (a surface's 49 cells) only when its
 * row's field is read.
 */
import { attachLazyRows, holderTable, LAZY_MIN_ROWS, rowsTable } from './lazyRows'

/** Arrays of row objects shorter than this go as they are (not worth the indirection). */
const MIN_ROWS = 64
/** A list column decodes lazily (each row's list built when read) from this many items per row on
 *  average — a surface's cells and slices, not a curve's two axis maps. */
const LAZY_LIST_PER_ROW = 4

type Obj = Record<string, unknown>

const isPlain = (v: unknown): v is Obj => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** Value tags for the rows of a column that don't hold its main kind. */
export const T_MAIN = 0
export const T_NULL = 1
export const T_UNDEF = 2
export const T_OTHER = 3

export type Column =
  // `t` tags the rows not holding the column's kind (T_*); `x` holds the T_OTHER values in order
  | { k: 'f'; v: Float64Array; t?: Uint8Array; x?: unknown[] } // numbers
  | { k: 'b'; v: Uint8Array; t?: Uint8Array; x?: unknown[] } // booleans
  | { k: 's'; d: string[]; i: Int32Array; t?: Uint8Array; x?: unknown[] } // strings, dictionary
  | { k: 'o'; i: Int32Array; t?: Uint8Array; x?: unknown[] } // nested records, as rows of the table's `nest`
  // lists of records: row r's items are rows off[r] … off[r + 1] − 1 of `items`
  | { k: 'l'; off: Int32Array; items: Table; t?: Uint8Array; x?: unknown[] }
  // nested records with a table of their own (a project file's sub-tables — see resultPack.ts;
  // the encoder pools them in `nest` instead)
  | { k: 'O'; i: Int32Array; table: Table; t?: Uint8Array; x?: unknown[] }
  | { k: 'a'; v: unknown[] } // anything else, as is

export interface Table {
  $wire: 1
  n: number
  /** every distinct key sequence among the rows, and which one each row has */
  shapes: string[][]
  shape: Uint16Array | Uint32Array
  cols: Record<string, Column>
  /** the nested records every 'o' column points into — one pool per table, so a record shared by
   *  several rows, or by several columns, stays one object */
  nest?: Table
}

/** The nested records of the table being encoded, by identity. */
export interface Pool {
  list: Obj[]
  at: Map<Obj, number>
}

export const isTable = (v: unknown): v is Table =>
  isPlain(v) && (v as { $wire?: unknown }).$wire === 1
/** The wrapper that carries a plain object which would otherwise read as one of ours. */
const isEscape = (v: unknown): v is { $wireEscape: unknown } =>
  isPlain(v) && '$wireEscape' in v && Object.keys(v).length === 1

/** An array every item of which is a plain object (a list a column can hold as a table). */
const isRecordList = (v: unknown): v is Obj[] => Array.isArray(v) && allRows(v)

/** A column over every row (rows that lack the key contribute `undefined`; the shape says they
 *  lack it, so the value is never read back). */
export function encodeColumn(vals: unknown[], transfer: Transferable[], pool: Pool): Column {
  const n = vals.length
  let nums = 0
  let bools = 0
  let strs = 0
  let objs = 0
  let lists = 0
  let other = 0
  for (const v of vals) {
    if (v === null || v === undefined) continue
    const t = typeof v
    if (t === 'number') nums++
    else if (t === 'boolean') bools++
    else if (t === 'string') strs++
    else if (isPlain(v)) objs++
    else if (isRecordList(v)) lists++
    else other++
  }
  const main = Math.max(nums, bools, strs, objs, lists)
  // A column that's mostly something we don't columnise (arrays, typed arrays) goes as is.
  if (main === 0 || other > main) return { k: 'a', v: vals.map((v) => encodeValue(v, transfer)) }
  const kind =
    main === nums ? 'f' : main === strs ? 's' : main === objs ? 'o' : main === lists ? 'l' : 'b'
  const isMain = (v: unknown): boolean =>
    kind === 'f'
      ? typeof v === 'number'
      : kind === 's'
        ? typeof v === 'string'
        : kind === 'b'
          ? typeof v === 'boolean'
          : kind === 'l'
            ? isRecordList(v)
            : isPlain(v)
  let tags: Uint8Array | undefined
  const x: unknown[] = []
  const tagAt = (i: number, v: unknown): void => {
    if (isMain(v)) return
    tags ??= new Uint8Array(n)
    if (v === null) tags[i] = T_NULL
    else if (v === undefined) tags[i] = T_UNDEF
    else {
      tags[i] = T_OTHER
      x.push(encodeValue(v, transfer))
    }
  }
  const extra = (): { t?: Uint8Array; x?: unknown[] } => {
    if (!tags) return {}
    transfer.push(tags.buffer)
    return x.length ? { t: tags, x } : { t: tags }
  }
  if (kind === 'f') {
    const v = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const val = vals[i]
      if (typeof val === 'number') v[i] = val
      else tagAt(i, val)
    }
    transfer.push(v.buffer)
    return { k: 'f', v, ...extra() }
  }
  if (kind === 'b') {
    const v = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const val = vals[i]
      if (typeof val === 'boolean') v[i] = val ? 1 : 0
      else tagAt(i, val)
    }
    transfer.push(v.buffer)
    return { k: 'b', v, ...extra() }
  }
  if (kind === 's') {
    const d: string[] = []
    const at = new Map<string, number>()
    const i32 = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      const val = vals[i]
      if (typeof val === 'string') {
        let c = at.get(val)
        if (c === undefined) {
          c = d.length
          at.set(val, c)
          d.push(val)
        }
        i32[i] = c
      } else tagAt(i, val)
    }
    transfer.push(i32.buffer)
    return { k: 's', d, i: i32, ...extra() }
  }
  if (kind === 'l') {
    // Every row's items in one table; a row that holds no list keeps an empty range.
    const off = new Int32Array(n + 1)
    const items: Obj[] = []
    for (let i = 0; i < n; i++) {
      const val = vals[i]
      off[i] = items.length
      if (isRecordList(val)) for (const it of val) items.push(it)
      else tagAt(i, val)
    }
    off[n] = items.length
    transfer.push(off.buffer)
    return { k: 'l', off, items: encodeTable(items, transfer), ...extra() }
  }
  // Nested records: each row an index into the table's pool of distinct records.
  const i32 = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const val = vals[i]
    if (isPlain(val)) {
      let c = pool.at.get(val)
      if (c === undefined) {
        c = pool.list.length
        pool.at.set(val, c)
        pool.list.push(val)
      }
      i32[i] = c
    } else tagAt(i, val)
  }
  transfer.push(i32.buffer)
  return { k: 'o', i: i32, ...extra() }
}

/** Rows as a columnar table; their typed arrays' buffers are added to `transfer` (pass a throwaway
 *  list to keep them). */
export function encodeTable(rows: Obj[], transfer: Transferable[]): Table {
  const n = rows.length
  const shapes: string[][] = []
  const shapeOf = new Map<string, number>()
  const shape = new Uint32Array(n)
  const cols = new Map<string, unknown[]>()
  for (let r = 0; r < n; r++) {
    const keys = Object.keys(rows[r])
    const sig = keys.join('\u0000')
    let s = shapeOf.get(sig)
    if (s === undefined) {
      s = shapes.length
      shapeOf.set(sig, s)
      shapes.push(keys)
    }
    shape[r] = s
    for (const k of keys) {
      let col = cols.get(k)
      if (!col) {
        col = new Array(n)
        cols.set(k, col)
      }
      col[r] = rows[r][k]
    }
  }
  const pool: Pool = { list: [], at: new Map() }
  const packed: Record<string, Column> = {}
  for (const [k, vals] of cols) packed[k] = encodeColumn(vals, transfer, pool)
  const small = shapes.length <= 0xffff ? Uint16Array.from(shape) : shape
  transfer.push(small.buffer)
  const table: Table = { $wire: 1, n, shapes, shape: small, cols: packed }
  if (pool.list.length) table.nest = encodeTable(pool.list, transfer)
  return table
}

/** `v` with every large array of plain row objects (at any depth) as a columnar table. Containers
 *  holding no table go through untouched (structured clone carries them as before). A table the
 *  UI thread already keeps (lazyRows.ts) is sent as it is — copied, never transferred. */
export function encodeValue(v: unknown, transfer: Transferable[]): unknown {
  if (Array.isArray(v)) {
    const kept = rowsTable(v)
    if (kept) return kept
    if (v.length >= MIN_ROWS && allRows(v)) return encodeTable(v as Obj[], transfer)
    let out: unknown[] | null = null
    for (let i = 0; i < v.length; i++) {
      const e = encodeValue(v[i], transfer)
      if (e !== v[i]) (out ??= v.slice())[i] = e
    }
    return out ?? v
  }
  if (!isPlain(v)) return v
  const lazy = holderTable(v)
  let out: Obj | null = null
  for (const k of Object.keys(v)) {
    // a lazy `rows` goes as its table, without building the rows
    const e = lazy && k === 'rows' ? lazy : encodeValue(v[k], transfer)
    if (e !== v[k]) {
      out ??= { ...v }
      out[k] = e
    }
  }
  // A plain object that happens to look like a table must not be decoded as one.
  if (isTable(v) || isEscape(v)) return { $wireEscape: out ?? v }
  return out ?? v
}

/** Every slot a plain object (no holes — a hole would decode as an empty row). */
function allRows(v: unknown[]): boolean {
  for (let i = 0; i < v.length; i++) if (!(i in v) || !isPlain(v[i])) return false
  return true
}

/** One column's value getter by row. `lazy` is passed on to the tables a column holds. */
function columnReader(col: Column, nest: Obj[], lazy: boolean): (i: number) => unknown {
  if (col.k === 'a') {
    const vals = col.v.map((v) => decodeValue(v))
    return (i) => vals[i]
  }
  const t = col.t
  let others: unknown[] | undefined
  let otherAt: Map<number, number> | undefined
  if (col.x) {
    others = col.x.map((v) => decodeValue(v))
    otherAt = new Map()
    let n = 0
    for (let i = 0; i < t!.length; i++) if (t![i] === T_OTHER) otherAt.set(i, n++)
  }
  const side = (i: number): unknown =>
    t![i] === T_NULL ? null : t![i] === T_UNDEF ? undefined : others![otherAt!.get(i)!]
  if (col.k === 'f') {
    const v = col.v
    return t ? (i) => (t[i] === T_MAIN ? v[i] : side(i)) : (i) => v[i]
  }
  if (col.k === 'b') {
    const v = col.v
    return t ? (i) => (t[i] === T_MAIN ? v[i] === 1 : side(i)) : (i) => v[i] === 1
  }
  if (col.k === 's') {
    const { d, i: idx } = col
    return t ? (i) => (t[i] === T_MAIN ? d[idx[i]] : side(i)) : (i) => d[idx[i]]
  }
  if (col.k === 'l') {
    const { off } = col
    const items = decodeTable(col.items, lazy)
    const list = (i: number): Obj[] => items.slice(off[i], off[i + 1])
    return t ? (i) => (t[i] === T_MAIN ? list(i) : side(i)) : list
  }
  const objs = col.k === 'O' ? decodeTable(col.table, lazy) : nest
  const idx = col.i
  return t ? (i) => (t[i] === T_MAIN ? objs[idx[i]] : side(i)) : (i) => objs[idx[i]]
}

/** A long list column decoded lazily: row i's list built from the items' columns when its field is
 *  read, and the same array returned for as long as anything holds it. */
function lazyListColumn(
  col: Extract<Column, { k: 'l' }>
): (o: Obj, key: string, i: number) => void {
  const { off, items, t } = col
  let readers: Array<[string, (i: number) => unknown]>[] | null = null
  const plansOf = (): Array<[string, (i: number) => unknown]>[] => {
    if (readers) return readers
    // the items' nested records, once (a cell has none; kept small either way)
    const nest = items.nest ? decodeTable(items.nest, true) : []
    const byKey = new Map<string, (i: number) => unknown>()
    for (const [k, c] of Object.entries(items.cols)) byKey.set(k, columnReader(c, nest, true))
    readers = items.shapes.map((keys) => keys.map((k) => [k, byKey.get(k)!]))
    return readers
  }
  const cache: Array<WeakRef<Obj[]> | undefined> = new Array(off.length - 1)
  let others: unknown[] | undefined
  let otherAt: Map<number, number> | undefined
  const build = (i: number): unknown => {
    if (t && t[i] !== T_MAIN) {
      if (t[i] === T_NULL) return null
      if (t[i] === T_UNDEF) return undefined
      if (!others) {
        others = col.x!.map((v) => decodeValue(v))
        otherAt = new Map()
        let n = 0
        for (let j = 0; j < t.length; j++) if (t[j] === T_OTHER) otherAt.set(j, n++)
      }
      return others[otherAt!.get(i)!]
    }
    const hit = cache[i]?.deref()
    if (hit) return hit
    const plans = plansOf()
    const out: Obj[] = []
    for (let r = off[i]; r < off[i + 1]; r++) {
      const plan = plans[items.shape[r]]
      const o: Obj = {}
      for (let j = 0; j < plan.length; j++) o[plan[j][0]] = plan[j][1](r)
      out.push(o)
    }
    cache[i] = new WeakRef(out)
    return out
  }
  return (o, key, i) =>
    Object.defineProperty(o, key, {
      enumerable: true,
      configurable: true,
      get: () => build(i),
      set(v: unknown) {
        Object.defineProperty(o, key, {
          value: v,
          writable: true,
          enumerable: true,
          configurable: true
        })
      }
    })
}

/** A table's rows. `lazy`: long list columns are decoded per row when read (see lazyListColumn),
 *  and nested tables likewise. */
export function decodeTable(t: Table, lazy = false): Obj[] {
  const nest = t.nest ? decodeTable(t.nest, lazy) : []
  const readers = new Map<string, (i: number) => unknown>()
  const lazyLists = new Map<string, (o: Obj, key: string, i: number) => void>()
  for (const [k, col] of Object.entries(t.cols)) {
    if (lazy && col.k === 'l' && col.items.n >= LAZY_LIST_PER_ROW * t.n)
      lazyLists.set(k, lazyListColumn(col))
    else readers.set(k, columnReader(col, nest, lazy))
  }
  // Per shape, its keys paired with their readers, so each row is one tight loop.
  type Step = readonly [
    string,
    ((i: number) => unknown) | null,
    ((o: Obj, key: string, i: number) => void) | null
  ]
  const plans: Step[][] = t.shapes.map((keys) =>
    keys.map((k) => [k, readers.get(k) ?? null, lazyLists.get(k) ?? null] as const)
  )
  const rows: Obj[] = new Array(t.n)
  for (let r = 0; r < t.n; r++) {
    const plan = plans[t.shape[r]]
    const o: Obj = {}
    for (let j = 0; j < plan.length; j++) {
      const [k, read, list] = plan[j]
      if (read) o[k] = read(r)
      else list!(o, k, r)
    }
    rows[r] = o
  }
  return rows
}

/** Inverse of encodeValue. `lazy` (the UI thread's results): a large table under a `rows` key is
 *  kept as columns, its rows built when read (lazyRows.ts), and long lists decode per row. */
export function decodeValue(v: unknown, lazy = false): unknown {
  if (Array.isArray(v)) {
    let out: unknown[] | null = null
    for (let i = 0; i < v.length; i++) {
      const d = decodeValue(v[i], lazy)
      if (d !== v[i]) (out ??= v.slice())[i] = d
    }
    return out ?? v
  }
  if (!isPlain(v)) return v
  if (isTable(v)) return decodeTable(v, lazy)
  if (isEscape(v)) return decodeChildren(v.$wireEscape as Obj, lazy)
  return decodeChildren(v, lazy)
}

function decodeChildren(v: Obj, lazy: boolean): Obj {
  let out: Obj | null = null
  let lazyRows: Table | null = null
  for (const k of Object.keys(v)) {
    const val = v[k]
    if (lazy && k === 'rows' && isTable(val) && val.n >= LAZY_MIN_ROWS) {
      out ??= { ...v }
      lazyRows = val
      continue
    }
    const d = decodeValue(val, lazy)
    if (d !== val) {
      out ??= { ...v }
      out[k] = d
    }
  }
  if (out && lazyRows) attachLazyRows(out, lazyRows)
  return out ?? v
}

/** One row of a table, decoded on its own (its nested records and lists too) — for a peek at a
 *  table without building all of its rows. */
export function decodeRowAt(t: Table, r: number): Obj {
  const o: Obj = {}
  for (const k of t.shapes[t.shape[r]]) o[k] = cellAt(t, t.cols[k], r)
  return o
}

function cellAt(t: Table, col: Column, r: number): unknown {
  if (col.k === 'a') return decodeValue(col.v[r])
  const tags = col.t
  if (tags && tags[r] !== T_MAIN) {
    if (tags[r] === T_NULL) return null
    if (tags[r] === T_UNDEF) return undefined
    let n = 0
    for (let i = 0; i < r; i++) if (tags[i] === T_OTHER) n++
    return decodeValue(col.x![n])
  }
  if (col.k === 'f') return col.v[r]
  if (col.k === 'b') return col.v[r] === 1
  if (col.k === 's') return col.d[col.i[r]]
  if (col.k === 'o') return decodeRowAt(t.nest!, col.i[r])
  if (col.k === 'O') return decodeRowAt(col.table, col.i[r])
  const out: Obj[] = []
  for (let j = col.off[r]; j < col.off[r + 1]; j++) out.push(decodeRowAt(col.items, j))
  return out
}
