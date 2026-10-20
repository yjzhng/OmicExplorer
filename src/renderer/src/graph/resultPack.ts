/**
 * How a workflow's computed results are stored in a project file — packed, then unpacked on open
 * into exactly the objects the app had (everything JSON can carry is restored as it was):
 *
 *  - Row tables become columns: every array of row objects (a Clean data table, a Compare's rows)
 *    is stored as one array per field, so a field name is written once rather than once per row.
 *    A column of strings is stored as its distinct values plus an index per row; a column whose
 *    value never changes (a Compare's threshold label, an unused condition) is stored once.
 *  - Annotation tables (`annotationMap`, the per-gene GO / KEGG / … records a Clean data result
 *    carries and every Compare downstream copies) are pooled: identical tables are stored once per
 *    workflow and referenced.
 *
 * The in-memory results never change shape; this is only the file's representation.
 */
import { attachLazyRows, LAZY_MIN_ROWS } from '../engine/lazyRows'
import {
  encodeColumn,
  encodeTable as encodeTableImpl,
  T_MAIN,
  T_NULL,
  T_OTHER,
  type Column as WireColumn,
  type Pool,
  type Table as WireTable
} from '../engine/wire'
import type { NodeResult } from './types'

/** Marks a workflow's `results` as packed (absent = the plain objects of older files). */
const PACKED = '$packed'
/** Arrays of row objects shorter than this stay as they are (not worth the indirection). */
const MIN_ROWS = 32

type Json = null | boolean | number | string | Json[] | { [k: string]: Json }
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)

/** One column of a packed table. Row indices listed in `a` lack the field entirely (as opposed to
 *  holding null). */
type Column =
  | { c: Json; a?: number[] } // the same value in every row that has the field
  | { s: string[]; i: number[]; a?: number[] } // strings: distinct values + an index per row (−1 = null)
  | { v: Json[]; a?: number[] } // numbers / booleans / null
  | { o: Table; p: number[]; a?: number[] } // nested objects: a table of the rows `p` holding one
  | { j: Json[]; a?: number[] } // anything else, as is

interface Table {
  $rows: number
  cols: Record<string, Column>
}

/** JSON's view of a value (NaN / ±Infinity → null, undefined → absent), so packing stays exactly
 *  as lossless as JSON.stringify was. */
function jsonValue(v: unknown): Json | undefined {
  if (v === undefined || typeof v === 'function') return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return v as Json
}

function packTable(rows: Obj[]): Table {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
  const cols: Record<string, Column> = {}
  for (const k of keys) {
    const absent: number[] = []
    const vals: Array<Json | undefined> = rows.map((r, i) => {
      const v = jsonValue(r[k])
      if (v === undefined) absent.push(i)
      return v
    })
    const a = absent.length ? { a: absent } : null
    const present = vals.filter((v): v is Json => v !== undefined)
    const first = JSON.stringify(present[0] ?? null)
    if (present.every((v) => JSON.stringify(v) === first)) {
      cols[k] = { c: present[0] ?? null, ...a }
      continue
    }
    const nonNull = present.filter((v) => v !== null)
    if (nonNull.every((v) => typeof v === 'string')) {
      const dict: string[] = []
      const at = new Map<string, number>()
      const i = vals.map((v) => {
        if (v === undefined || v === null) return -1
        let n = at.get(v as string)
        if (n === undefined) {
          n = dict.length
          at.set(v as string, n)
          dict.push(v as string)
        }
        return n
      })
      cols[k] = { s: dict, i, ...a }
    } else if (nonNull.every((v) => typeof v === 'number' || typeof v === 'boolean')) {
      cols[k] = { v: vals.map((v) => (v === undefined ? null : v)), ...a }
    } else if (nonNull.every(isObj)) {
      // Nested records (a curve fit's parameters, custom conditions): a table of their own over
      // the rows that hold one; the rest are null (or absent, listed in `a`).
      const p: number[] = []
      const objs: Obj[] = []
      vals.forEach((v, idx) => {
        if (isObj(v)) {
          p.push(idx)
          objs.push(v)
        }
      })
      cols[k] = { o: packTable(objs), p, ...a }
    } else {
      cols[k] = { j: vals.map((v) => (v === undefined ? null : v)), ...a }
    }
  }
  return { $rows: rows.length, cols }
}

function unpackTable(t: Table): Obj[] {
  const rows: Obj[] = Array.from({ length: t.$rows }, () => ({}))
  for (const [k, col] of Object.entries(t.cols)) {
    const absent = new Set(col.a ?? [])
    if ('c' in col) {
      rows.forEach((r, i) => {
        if (!absent.has(i)) r[k] = col.c
      })
    } else if ('s' in col) {
      rows.forEach((r, i) => {
        if (!absent.has(i)) r[k] = col.i[i] < 0 ? null : col.s[col.i[i]]
      })
    } else if ('v' in col || 'j' in col) {
      const vs = 'v' in col ? col.v : col.j
      rows.forEach((r, i) => {
        if (!absent.has(i)) r[k] = vs[i]
      })
    } else {
      const objs = unpackTable(col.o)
      const at = new Map(col.p.map((row, n) => [row, n]))
      rows.forEach((r, i) => {
        if (absent.has(i)) return
        const n = at.get(i)
        r[k] = n === undefined ? null : objs[n]
      })
    }
  }
  return rows
}

/** A packed table as the engine's columnar table (engine/wire.ts) — straight from its columns,
 *  without building its rows: what a large table is kept as once open (lazyRows.ts). Its rows,
 *  built from it, are exactly unpackTable's. */
function wireTable(t: Table): WireTable {
  const n = t.$rows
  const keys = Object.keys(t.cols)
  // Each row's keys in the columns' order, less the ones it lacks — one shape per pattern.
  const lacks = new Map<number, Set<string>>()
  for (const k of keys)
    for (const i of t.cols[k].a ?? []) {
      let s = lacks.get(i)
      if (!s) lacks.set(i, (s = new Set()))
      s.add(k)
    }
  const shapes: string[][] = [keys]
  const shapeOf = new Map<string, number>([[keys.join('\u0000'), 0]])
  const shape = new Uint32Array(n)
  for (const [i, gone] of lacks) {
    const ks = keys.filter((k) => !gone.has(k))
    const sig = ks.join('\u0000')
    let s = shapeOf.get(sig)
    if (s === undefined) {
      s = shapes.length
      shapeOf.set(sig, s)
      shapes.push(ks)
    }
    shape[i] = s
  }
  const pool: Pool = { list: [], at: new Map() }
  const cols: Record<string, WireColumn> = {}
  for (const k of keys) cols[k] = wireColumn(t.cols[k], n, pool)
  const table: WireTable = {
    $wire: 1,
    n,
    shapes,
    shape: shapes.length <= 0xffff ? Uint16Array.from(shape) : shape,
    cols
  }
  // (the pool of any record a raw column holds — see encodeColumn)
  if (pool.list.length) table.nest = encodeTableOf(pool.list)
  return table
}

/** One packed column as a columnar one (rows the column lacks hold anything: their shape skips it). */
function wireColumn(col: Column, n: number, pool: Pool): WireColumn {
  if ('c' in col) {
    const c = col.c
    if (typeof c === 'number') return { k: 'f', v: new Float64Array(n).fill(c) }
    if (typeof c === 'string') return { k: 's', d: [c], i: new Int32Array(n) }
    if (typeof c === 'boolean') return { k: 'b', v: new Uint8Array(n).fill(c ? 1 : 0) }
    if (c === null) return { k: 'f', v: new Float64Array(n), t: new Uint8Array(n).fill(T_NULL) }
    // the same object or array in every row, shared — as unpackTable shares it
    return { k: 'a', v: new Array(n).fill(c) }
  }
  if ('s' in col) {
    const i = Int32Array.from(col.i)
    let t: Uint8Array | undefined
    for (let r = 0; r < n; r++)
      if (i[r] < 0) {
        t ??= new Uint8Array(n)
        t[r] = T_NULL
        i[r] = 0
      }
    return t ? { k: 's', d: col.s, i, t } : { k: 's', d: col.s, i }
  }
  if ('o' in col) {
    const i = new Int32Array(n)
    const t = new Uint8Array(n).fill(T_NULL)
    col.p.forEach((row, at) => {
      i[row] = at
      t[row] = T_MAIN
    })
    return { k: 'O', i, table: wireTable(col.o), t }
  }
  if ('v' in col) {
    // numbers or booleans (and nulls): the commoner kind as the column, the rest tagged
    let nums = 0
    let bools = 0
    for (const v of col.v) {
      if (typeof v === 'number') nums++
      else if (typeof v === 'boolean') bools++
    }
    const isNum = nums >= bools
    const v = isNum ? new Float64Array(n) : new Uint8Array(n)
    let t: Uint8Array | undefined
    const x: unknown[] = []
    for (let r = 0; r < n; r++) {
      const val = col.v[r]
      if (isNum ? typeof val === 'number' : typeof val === 'boolean') v[r] = Number(val)
      else {
        t ??= new Uint8Array(n)
        if (val === null || val === undefined) t[r] = T_NULL
        else {
          t[r] = T_OTHER
          x.push(val)
        }
      }
    }
    const extra = t ? (x.length ? { t, x } : { t }) : {}
    return isNum
      ? { k: 'f', v: v as Float64Array, ...extra }
      : { k: 'b', v: v as Uint8Array, ...extra }
  }
  // anything else (a surface's cells — lists of records — among them): columnised as the engine
  // would (encodeColumn), so long lists become list columns
  return encodeColumn(
    col.j.map((v) => (v === null ? null : v)),
    [],
    pool
  )
}

/** Records as a columnar table, their buffers kept (nothing is transferred). */
const encodeTableOf = (rows: Obj[]): WireTable => encodeTableImpl(rows, [])

/** Pack every large array of row objects inside a value (any depth). */
function packValue(v: unknown, pool: AnnotationPool): unknown {
  if (Array.isArray(v)) {
    if (v.length >= MIN_ROWS && v.every(isObj)) return { $table: packTable(v as Obj[]) }
    return v.map((x) => packValue(x, pool))
  }
  if (!isObj(v)) return v
  const out: Obj = {}
  for (const [k, x] of Object.entries(v)) {
    if (k === 'annotationMap' && isObj(x)) out[k] = { $pool: pool.add(x) }
    else out[k] = packValue(x, pool)
  }
  return out
}

function unpackValue(v: unknown, pool: Obj[]): unknown {
  if (Array.isArray(v)) return v.map((x) => unpackValue(x, pool))
  if (!isObj(v)) return v
  if ('$table' in v) return unpackTable(v.$table as Table)
  if ('$pool' in v && typeof v.$pool === 'number') return pool[v.$pool]
  const out: Obj = {}
  let lazy: Table | null = null
  for (const [k, x] of Object.entries(v)) {
    // A large `rows` table stays columnar: its rows are built when read (lazyRows.ts).
    if (k === 'rows' && isObj(x) && '$table' in x && (x.$table as Table).$rows >= LAZY_MIN_ROWS) {
      lazy = x.$table as Table
      out[k] = null
      continue
    }
    out[k] = unpackValue(x, pool)
  }
  if (lazy) attachLazyRows(out, wireTable(lazy))
  return out
}

/** Annotation tables seen so far in a workflow: the same table (by identity, else by content)
 *  gets the same slot. */
class AnnotationPool {
  readonly tables: Obj[] = []
  private byRef = new Map<Obj, number>()
  private byText = new Map<string, number>()
  add(t: Obj): number {
    const ref = this.byRef.get(t)
    if (ref !== undefined) return ref
    const text = JSON.stringify(t)
    let n = this.byText.get(text)
    if (n === undefined) {
      n = this.tables.length
      this.tables.push(t)
      this.byText.set(text, n)
    }
    this.byRef.set(t, n)
    return n
  }
}

/** A workflow's results as stored in the project file. */
export function packResults(results: Record<string, NodeResult>): unknown {
  const pool = new AnnotationPool()
  const packed: Obj = {}
  for (const [id, r] of Object.entries(results)) packed[id] = packValue(r, pool)
  return { [PACKED]: 1, annotations: pool.tables, results: packed }
}

/** A workflow's results from the project file — packed (this format) or plain (older files). */
export function unpackResults(stored: unknown): Record<string, NodeResult> {
  if (!isObj(stored) || stored[PACKED] !== 1) return (stored ?? {}) as Record<string, NodeResult>
  const pool = (stored.annotations as Obj[]) ?? []
  const out: Record<string, NodeResult> = {}
  for (const [id, r] of Object.entries((stored.results as Obj) ?? {}))
    out[id] = unpackValue(r, pool) as NodeResult
  return out
}

/** Rename results in a workflow's stored `results` — packed or plain — in place: each `from` id
 *  becomes its `to` (one already at `to` is kept). For upgrades that move a tile's result. */
export function renameStoredResults(stored: unknown, rename: Map<string, string>): void {
  if (!isObj(stored) || rename.size === 0) return
  const map = stored[PACKED] === 1 ? stored.results : stored
  if (!isObj(map)) return
  for (const [from, to] of rename)
    if (from in map) {
      if (!(to in map)) map[to] = map[from]
      delete map[from]
    }
}
