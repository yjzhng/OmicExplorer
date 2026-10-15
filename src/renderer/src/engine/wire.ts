/**
 * Columnar wire format for engine messages. A result's row tables (a Clean data table's gene ×
 * sample rows, a Compare's result rows) cross the worker boundary as columns instead of as
 * hundreds of thousands of separate objects:
 *
 *  - numbers / booleans go as typed arrays, TRANSFERRED (moved, not copied);
 *  - strings go as their distinct values plus an index per row, so the receiver holds ONE copy of
 *    each repeated string ("E28 | DMSO", a uniqID across every sample) instead of one per row;
 *  - nested records (a curve fit, custom conditions) go as a table of their own.
 *
 * Structured clone rebuilds every row object generically and copies every string; decoding here
 * builds the rows in a plain loop. The rows that come out are the ones that went in — same keys in
 * the same order, NaN / ±Infinity / −0 / undefined / an absent field all kept apart — so nothing
 * downstream can tell the difference.
 */

/** Arrays of row objects shorter than this go as they are (not worth the indirection). */
const MIN_ROWS = 64

type Obj = Record<string, unknown>

const isPlain = (v: unknown): v is Obj => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}

/** Value tags for the rows of a column that don't hold its main kind. */
const T_MAIN = 0
const T_NULL = 1
const T_UNDEF = 2
const T_OTHER = 3

type Column =
  // `t` tags the rows not holding the column's kind (T_*); `x` holds the T_OTHER values in order
  | { k: 'f'; v: Float64Array; t?: Uint8Array; x?: unknown[] } // numbers
  | { k: 'b'; v: Uint8Array; t?: Uint8Array; x?: unknown[] } // booleans
  | { k: 's'; d: string[]; i: Int32Array; t?: Uint8Array; x?: unknown[] } // strings, dictionary
  | { k: 'o'; i: Int32Array; t?: Uint8Array; x?: unknown[] } // nested records, as rows of the table's `nest`
  | { k: 'a'; v: unknown[] } // anything else, as is

interface Table {
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
interface Pool {
  list: Obj[]
  at: Map<Obj, number>
}

const isTable = (v: unknown): v is Table => isPlain(v) && (v as { $wire?: unknown }).$wire === 1
/** The wrapper that carries a plain object which would otherwise read as one of ours. */
const isEscape = (v: unknown): v is { $wireEscape: unknown } =>
  isPlain(v) && '$wireEscape' in v && Object.keys(v).length === 1

/** A column over every row (rows that lack the key contribute `undefined`; the shape says they
 *  lack it, so the value is never read back). */
function encodeColumn(vals: unknown[], transfer: Transferable[], pool: Pool): Column {
  const n = vals.length
  let nums = 0
  let bools = 0
  let strs = 0
  let objs = 0
  let other = 0
  for (const v of vals) {
    if (v === null || v === undefined) continue
    const t = typeof v
    if (t === 'number') nums++
    else if (t === 'boolean') bools++
    else if (t === 'string') strs++
    else if (isPlain(v)) objs++
    else other++
  }
  const main = Math.max(nums, bools, strs, objs)
  // A column that's mostly something we don't columnise (arrays, typed arrays) goes as is.
  if (main === 0 || other > main) return { k: 'a', v: vals.map((v) => encodeValue(v, transfer)) }
  const kind = main === nums ? 'f' : main === strs ? 's' : main === objs ? 'o' : 'b'
  const isMain = (v: unknown): boolean =>
    kind === 'f'
      ? typeof v === 'number'
      : kind === 's'
        ? typeof v === 'string'
        : kind === 'b'
          ? typeof v === 'boolean'
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

function encodeTable(rows: Obj[], transfer: Transferable[]): Table {
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
 *  holding no table go through untouched (structured clone carries them as before). */
export function encodeValue(v: unknown, transfer: Transferable[]): unknown {
  if (Array.isArray(v)) {
    if (v.length >= MIN_ROWS && allRows(v)) return encodeTable(v as Obj[], transfer)
    let out: unknown[] | null = null
    for (let i = 0; i < v.length; i++) {
      const e = encodeValue(v[i], transfer)
      if (e !== v[i]) (out ??= v.slice())[i] = e
    }
    return out ?? v
  }
  if (!isPlain(v)) return v
  let out: Obj | null = null
  for (const k of Object.keys(v)) {
    const e = encodeValue(v[k], transfer)
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

/** One column's value getter by row. */
function columnReader(col: Column, nest: Obj[]): (i: number) => unknown {
  if (col.k === 'a') {
    const vals = col.v.map(decodeValue)
    return (i) => vals[i]
  }
  const t = col.t
  let others: unknown[] | undefined
  let otherAt: Map<number, number> | undefined
  if (col.x) {
    others = col.x.map(decodeValue)
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
  const objs = nest
  const idx = col.i
  return t ? (i) => (t[i] === T_MAIN ? objs[idx[i]] : side(i)) : (i) => objs[idx[i]]
}

function decodeTable(t: Table): Obj[] {
  const nest = t.nest ? decodeTable(t.nest) : []
  const readers = new Map<string, (i: number) => unknown>()
  for (const [k, col] of Object.entries(t.cols)) readers.set(k, columnReader(col, nest))
  // Per shape, its keys paired with their readers, so each row is one tight loop.
  const plans = t.shapes.map((keys) => keys.map((k) => [k, readers.get(k)!] as const))
  const rows: Obj[] = new Array(t.n)
  for (let r = 0; r < t.n; r++) {
    const plan = plans[t.shape[r]]
    const o: Obj = {}
    for (let j = 0; j < plan.length; j++) o[plan[j][0]] = plan[j][1](r)
    rows[r] = o
  }
  return rows
}

/** Inverse of encodeValue. */
export function decodeValue(v: unknown): unknown {
  if (Array.isArray(v)) {
    let out: unknown[] | null = null
    for (let i = 0; i < v.length; i++) {
      const d = decodeValue(v[i])
      if (d !== v[i]) (out ??= v.slice())[i] = d
    }
    return out ?? v
  }
  if (!isPlain(v)) return v
  if (isTable(v)) return decodeTable(v)
  if (isEscape(v)) return decodeChildren(v.$wireEscape as Obj)
  return decodeChildren(v)
}

function decodeChildren(v: Obj): Obj {
  let out: Obj | null = null
  for (const k of Object.keys(v)) {
    const d = decodeValue(v[k])
    if (d !== v[k]) {
      out ??= { ...v }
      out[k] = d
    }
  }
  return out ?? v
}
