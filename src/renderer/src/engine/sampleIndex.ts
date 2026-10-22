/**
 * A Clean data table's samples and genes as integers, worked out once per table and shared by every
 * builder that pivots it (the QC plot, the heatmap, the sample correlation, the gene bars, the
 * matrix view).
 *
 * Each of those used to scan every row and build the row's sample label from its condition fields
 * and replicate — the same few dozen strings, rebuilt half a million times per builder. Here every
 * row gets a sample id (rows with the same cell, cmpd, dose, time, rep and custom conditions — the
 * fields any sample label or condition meta is made of — share one) and a gene id, and each sample
 * keeps one representative row's fields. A builder then makes ITS OWN label once per sample, from
 * the representative, and its row loop reads only typed arrays.
 *
 * Ids follow first appearance in the rows, so a builder walking rows in order meets samples and
 * genes in the order it did before. A columnar result (lazyRows.ts) is read off its columns —
 * dictionary codes where it can — and a plain one off its rows; both give the same ids.
 */
import { holderTable, rowsAt } from './lazyRows'
import { stdByGene } from './curvePoints'
import type { StandardRow } from './types'
import { keyIn, tableColumn, T_MAIN, type Table } from './wire'

export interface SampleIndex {
  $sampleIndex: 1
  /** rows */
  n: number
  /** row → sample id (by first appearance) */
  sample: Int32Array
  /** sample id → its condition fields (cell, cmpd, dose, time, rep, extra) as a row has them, copied
   *  off its first row — for the builders' label functions and condition metas. `uniqID` is '' and
   *  `value` null: they aren't the sample's. */
  reps: StandardRow[]
  /** sample id → its first row */
  firstRow: Int32Array
  /** row → gene id (by first appearance) */
  gene: Int32Array
  /** gene id → its uniqID */
  genes: string[]
  /** uniqID → gene id */
  geneOf: Map<unknown, number>
  /** row → its value when that's a finite number, else NaN (null, absent, NaN, ±Infinity, …) */
  value: Float64Array
  /** row → its value as the row holds it (what a non-finite one is) */
  rawValue: (r: number) => unknown
  /** row → 1 when `imputed` is truthy */
  imputed: Uint8Array
}

export const isSampleIndex = (v: unknown): v is SampleIndex =>
  typeof v === 'object' && v !== null && (v as { $sampleIndex?: unknown }).$sampleIndex === 1

/** The fields a sample is made of, in the order its id is built. */
const SAMPLE_KEYS = ['cell', 'cmpd', 'dose', 'time', 'rep', 'extra'] as const

/** A value as a key that tells apart what a label or a meta copy would: SameValueZero on
 *  primitives with −0 kept apart from 0, and records / arrays by their content (keys in order). */
const NEG_ZERO = Symbol('-0')
function canon(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === null || typeof v !== 'object')
    return `${typeof v}:${Object.is(v, -0) ? '-0' : String(v)}`
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
    .join(',')}}`
}

/** Dense codes for values, in the order first seen: equal codes ⇔ equal values (see canon). */
class Coder {
  private prim = new Map<unknown, number>()
  private obj = new Map<string, number>()
  vals: unknown[] = []
  code(v: unknown): number {
    if (v !== null && typeof v === 'object') return this.key(canon(v), v)
    const k = v === 0 && Object.is(v, -0) ? NEG_ZERO : v
    let c = this.prim.get(k)
    if (c === undefined) {
      c = this.vals.length
      this.prim.set(k, c)
      this.vals.push(v)
    }
    return c
  }
  /** a code for a value already reduced to a string key (a nested record's content) — never equal
   *  to a primitive's */
  key(k: string, v: unknown): number {
    let c = this.obj.get(k)
    if (c === undefined) {
      c = this.vals.length
      this.obj.set(k, c)
      this.vals.push(v)
    }
    return c
  }
  get size(): number {
    return this.vals.length
  }
  /** the primitives seen → their codes */
  get map(): Map<unknown, number> {
    return this.prim
  }
}

/** Per row of `t`, a code for its `key` value (absent reads as undefined) — dictionary codes off a
 *  string column, a nested record's code off its own table's columns, so no value is built. */
function columnCodes(t: Table, key: string, coder: Coder): Int32Array {
  const out = new Int32Array(t.n)
  const col = t.cols[key]
  if (!col) {
    out.fill(coder.code(undefined))
    return out
  }
  const has = keyIn(t, key)
  const read = tableColumn(t, key)!
  const tags = 't' in col ? col.t : undefined
  const plain = (r: number): boolean => has(r) && (!tags || tags[r] === T_MAIN)
  if (col.k === 's') {
    const remap = new Int32Array(col.d.length).fill(-1)
    for (let r = 0; r < t.n; r++) {
      if (!plain(r)) {
        out[r] = coder.code(read(r))
        continue
      }
      const d = col.i[r]
      out[r] = remap[d] >= 0 ? remap[d] : (remap[d] = coder.code(col.d[d]))
    }
    return out
  }
  if (col.k === 'f') {
    for (let r = 0; r < t.n; r++) out[r] = plain(r) ? coder.code(col.v[r]) : coder.code(read(r))
    return out
  }
  if (col.k === 'o' && t.nest) {
    // a record's code is its key sequence plus each field's code, read off the nested table
    const nest = t.nest
    const rec = recordCodes(nest)
    const memo = new Int32Array(nest.n).fill(-1)
    for (let r = 0; r < t.n; r++) {
      if (!plain(r)) {
        out[r] = coder.code(read(r))
        continue
      }
      const j = col.i[r]
      // the record itself is never built: its code is all a sample id needs
      if (memo[j] < 0) memo[j] = coder.key(`rec${rec[j]}`, undefined)
      out[r] = memo[j]
    }
    return out
  }
  for (let r = 0; r < t.n; r++) out[r] = coder.code(read(r))
  return out
}

/** Per row of `t`, a code for the whole row: equal ⇔ same keys in the same order, equal values. */
function recordCodes(t: Table): Int32Array {
  const coder = new Coder()
  const keys = Object.keys(t.cols)
  const codes = keys.map((k) => columnCodes(t, k, coder))
  const id = new Int32Array(t.n)
  for (let r = 0; r < t.n; r++) id[r] = t.shape[r]
  let count = t.shapes.length
  // each key of the row's shape folds in that column's code, in the shape's order (keys a shape
  // lacks fold in nothing: they're told apart by the shape)
  const pos = new Map(keys.map((k, i) => [k, i]))
  const plans = t.shapes.map((s) => s.map((k) => pos.get(k)!))
  const width = Math.max(0, ...t.shapes.map((s) => s.length))
  for (let step = 0; step < width; step++) {
    const pair = new Pairs(count, coder.size + 1)
    for (let r = 0; r < t.n; r++) {
      const plan = plans[t.shape[r]]
      id[r] = pair.of(id[r], step < plan.length ? codes[plan[step]][r] : coder.size)
    }
    count = pair.count
  }
  return id
}

/** Dense ids for (a, b) pairs in the order first seen, a < `na`, b < `nb`. */
class Pairs {
  private table?: Int32Array
  private map?: Map<number, number>
  count = 0
  constructor(
    na: number,
    private nb: number
  ) {
    if (na * nb <= 1 << 22) this.table = new Int32Array(na * nb).fill(-1)
    else this.map = new Map()
  }
  of(a: number, b: number): number {
    const k = a * this.nb + b
    if (this.table) {
      const c = this.table[k]
      return c >= 0 ? c : (this.table[k] = this.count++)
    }
    let c = this.map!.get(k)
    if (c === undefined) this.map!.set(k, (c = this.count++))
    return c
  }
}

/** Fold per-row field codes into a per-row tuple id, dense by first appearance. */
function tupleIds(
  n: number,
  fields: Array<{ codes: Int32Array; size: number }>
): {
  id: Int32Array
  count: number
} {
  const id = new Int32Array(n)
  let count = n > 0 ? 1 : 0
  for (const { codes, size } of fields) {
    const pair = new Pairs(count, size)
    for (let r = 0; r < n; r++) id[r] = pair.of(id[r], codes[r])
    count = pair.count
  }
  return { id, count }
}

const copyOf = (v: unknown): unknown =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? { ...(v as object) } : v

function build(holder: { rows: readonly StandardRow[] }, t: Table | undefined): SampleIndex {
  const rows = t ? null : holder.rows
  const n = t ? t.n : rows!.length
  const readerOf = (key: string): ((r: number) => unknown) => {
    if (t) return tableColumn(t, key) ?? ((): undefined => undefined)
    return (r) => (rows![r] as unknown as Record<string, unknown>)[key]
  }
  const codesOf = (key: string): { codes: Int32Array; coder: Coder } => {
    const coder = new Coder()
    if (t) return { codes: columnCodes(t, key, coder), coder }
    const read = readerOf(key)
    const codes = new Int32Array(n)
    for (let r = 0; r < n; r++) codes[r] = coder.code(read(r))
    return { codes, coder }
  }

  const fields = SAMPLE_KEYS.map((k) => {
    const { codes, coder } = codesOf(k)
    return { codes, size: coder.size }
  })
  const { id: sample, count } = tupleIds(n, fields)
  const firstRow = new Int32Array(count).fill(-1)
  for (let r = 0; r < n; r++) if (firstRow[sample[r]] < 0) firstRow[sample[r]] = r
  const read = Object.fromEntries(SAMPLE_KEYS.map((k) => [k, readerOf(k)]))
  const reps = Array.from(firstRow, (r): StandardRow => {
    const o = {
      uniqID: '',
      cell: read.cell(r),
      cmpd: read.cmpd(r),
      dose: read.dose(r),
      time: read.time(r),
      rep: read.rep(r),
      value: null
    } as Record<string, unknown>
    const extra = read.extra(r)
    if (extra !== undefined) o.extra = copyOf(extra)
    return o as unknown as StandardRow
  })

  const g = codesOf('uniqID')
  const rawValue = readerOf('value')
  const value = new Float64Array(n)
  const vcol = t?.cols.value
  if (t && vcol?.k === 'f') {
    const has = keyIn(t, 'value')
    for (let r = 0; r < n; r++) {
      const v = vcol.v[r]
      value[r] = has(r) && (!vcol.t || vcol.t[r] === T_MAIN) && Number.isFinite(v) ? v : NaN
    }
  } else
    for (let r = 0; r < n; r++) {
      const v = rawValue(r)
      value[r] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
  const imputed = new Uint8Array(n)
  const icol = t?.cols.imputed
  if (t && icol?.k === 'b') {
    const has = keyIn(t, 'imputed')
    const readI = readerOf('imputed')
    for (let r = 0; r < n; r++)
      imputed[r] = has(r) && (!icol.t || icol.t[r] === T_MAIN) ? icol.v[r] : readI(r) ? 1 : 0
  } else if (!t || icol) {
    const readI = readerOf('imputed')
    for (let r = 0; r < n; r++) imputed[r] = readI(r) ? 1 : 0
  }

  return {
    $sampleIndex: 1,
    n,
    sample,
    reps,
    firstRow,
    gene: g.codes,
    genes: g.coder.vals as string[],
    geneOf: g.coder.map,
    value,
    rawValue,
    imputed
  }
}

/** Built indexes, by the columnar table (a lazy result) or the rows array (a plain one). */
const cache = new WeakMap<object, SampleIndex>()

/** A Clean data result's sample index — built on first use, then the same one for as long as its
 *  table (or rows array) lives. */
export function sampleIndex(holder: { rows: readonly StandardRow[] }): SampleIndex {
  const t = holderTable(holder)
  const key: object = t ?? holder.rows
  let ix = cache.get(key)
  if (!ix) cache.set(key, (ix = build(holder, t)))
  return ix
}

/**
 * Samples grouped by a builder's own label (made once per sample, from its representative):
 * `of[sample]` is the label's id, `labels[id]` the label — ids in sample order, which is the
 * order the labels first appear in the rows.
 */
export function labelGroups(
  ix: SampleIndex,
  label: (rep: StandardRow) => string
): { of: Int32Array; labels: string[] } {
  const of = new Int32Array(ix.reps.length)
  const at = new Map<string, number>()
  const labels: string[] = []
  ix.reps.forEach((rep, s) => {
    const l = label(rep)
    let k = at.get(l)
    if (k === undefined) {
      k = labels.length
      at.set(l, k)
      labels.push(l)
    }
    of[s] = k
  })
  return { of, labels }
}

/** A gene's Clean data rows by uniqID — what stdByGene's map answers, for the readers that look up
 *  one gene at a time (a DR curve's replicates, a Curve MAD point). */
export type StdLookup = Pick<Map<string, StandardRow[]>, 'get'>

const lookups = new WeakMap<object, StdLookup>()

/** A Clean data result's rows by gene: for a columnar result only the genes asked for are built
 *  (rowsAt: the same objects `rows` holds; a gene's array the same one while anything keeps it),
 *  off the sample index's gene ids; for a plain one, stdByGene. Cached per table (or rows
 *  array). */
export function stdLookupOf(holder: { rows: readonly StandardRow[] }): StdLookup {
  const t = holderTable(holder)
  if (!t) return stdByGene(holder.rows as StandardRow[])
  let l = lookups.get(t)
  if (!l) {
    const ix = sampleIndex(holder)
    // each gene's rows as a run of `order` (counting sort by gene id: rows stay ascending)
    const start = new Int32Array(ix.genes.length + 1)
    for (let r = 0; r < ix.n; r++) start[ix.gene[r] + 1]++
    for (let g = 0; g < ix.genes.length; g++) start[g + 1] += start[g]
    const order = new Int32Array(ix.n)
    const fill = start.slice(0, -1)
    for (let r = 0; r < ix.n; r++) order[fill[ix.gene[r]]++] = r
    // held weakly: a lookup lives as long as its table, the rows only while something reads them
    const built = new Map<string, WeakRef<StandardRow[]>>()
    l = {
      get: (id) => {
        let rows = built.get(id)?.deref()
        if (!rows) {
          const g = ix.geneOf.get(id)
          if (g === undefined) return undefined
          rows = rowsAt(holder, order.subarray(start[g], start[g + 1]))
          built.set(id, new WeakRef(rows))
        }
        return rows
      }
    }
    lookups.set(t, l)
  }
  return l
}
