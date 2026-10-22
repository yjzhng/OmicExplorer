/**
 * A result's condition contexts, without its rows: one small row per distinct context tuple — the
 * fields the facet helpers read (plotData's ContextRow: cmp_cond, comparison, feature, the term
 * flag, the conditions, and whether each contrast side has a value) — with the indices of the
 * result rows it stands for.
 *
 * The facet switchers and the faceted plots resolve their pick over these instead of over every
 * row: the helpers look only at which tuples exist (sets, some / every), never at how many rows
 * each has, so the answer is the same. Then only the picked facet's rows are built (rowsAt) — for
 * a large columnar result (lazyRows.ts), read straight from its columns, so a facet switcher never
 * builds the whole table.
 */
import { contrastYRange, rowOnScale, type ContrastResultRow } from './contrast'
import { facetCompareRows, facetDims, type ContextRow, type FacetGroup } from './plotData'
import type { ValueScale } from './scale'
import type { ConditionKey, NumericConds } from './types'
import { holderTable, lazyCopy, rowsAt } from './lazyRows'
import { keyIn, nestedColumn, subTable, tableColumn, type Table } from './wire'

export interface ContextIndex {
  /** one per distinct context tuple, in first-seen order */
  rows: ContextRow[]
  /** each context row's result-row indices, ascending */
  idx: ReadonlyMap<ContextRow, Int32Array>
  /** how many result rows */
  n: number
}

/** The plain-valued fields copied as they are. */
const PLAIN = [
  'cmp_cond',
  'comparison',
  'feature',
  'featureId',
  'cell',
  'cmpd',
  'dose',
  'time',
  'cmp1',
  'cmp2'
] as const
/** The contrast sides' values: only whether each is there (key present) and non-null matters. */
const SIDES = ['FC1', 'FC2'] as const

type Get = (field: string, r: number) => unknown
type Has = (field: string, r: number) => boolean

/** A canonical string of an `extra` bag (its keys sorted), '' for none. */
function extraKey(e: unknown): string {
  if (e == null || typeof e !== 'object') return e === undefined ? '' : `!${String(e)}`
  const keys = Object.keys(e).sort()
  return keys.map((k) => `${k}=${String((e as Record<string, unknown>)[k])}`).join('\u0001')
}

/** The axis a row's curve or response surface runs along (ContextRow.along), if it has one. */
function alongOf(get: Get, r: number): string | undefined {
  const a = get('curve.axis', r) ?? get('rs.axis', r)
  return typeof a === 'string' ? a : undefined
}

function build(n: number, get: Get, has: Has): ContextIndex {
  const byKey = new Map<string, { row: ContextRow; idx: number[] }>()
  const parts: string[] = new Array(PLAIN.length + SIDES.length + 3)
  for (let r = 0; r < n; r++) {
    let p = 0
    for (const f of PLAIN) {
      const v = get(f, r)
      // absent and undefined read alike everywhere the facets look (ctxValue: `?? null`)
      parts[p++] = v === undefined ? 'u' : v === null ? 'n' : `${typeof v}:${String(v)}`
    }
    for (const f of SIDES) parts[p++] = !has(f, r) ? '-' : get(f, r) == null ? 'n' : 'v'
    parts[p++] = get('term', r) != null ? 't' : ''
    parts[p++] = extraKey(get('extra', r))
    const along = alongOf(get, r)
    parts[p] = along ?? ''
    const key = parts.join('\u0000')
    let e = byKey.get(key)
    if (!e) {
      const row: Record<string, unknown> = {}
      for (const f of PLAIN) {
        const v = get(f, r)
        if (v !== undefined) row[f] = v
      }
      for (const f of SIDES) if (has(f, r)) row[f] = get(f, r) == null ? null : 0
      if (get('term', r) != null) row.term = true
      if (along !== undefined) row.along = along
      const extra = get('extra', r)
      if (extra !== undefined) row.extra = extra && typeof extra === 'object' ? { ...extra } : extra
      byKey.set(key, (e = { row: row as ContextRow, idx: [] }))
    }
    e.idx.push(r)
  }
  const rows: ContextRow[] = []
  const idx = new Map<ContextRow, Int32Array>()
  for (const { row, idx: at } of byKey.values()) {
    rows.push(row)
    idx.set(row, Int32Array.from(at))
  }
  return { rows, idx, n }
}

function fromTable(t: Table): ContextIndex {
  const cols = new Map<string, ((r: number) => unknown) | undefined>()
  const keys = new Map<string, (r: number) => boolean>()
  const col = (f: string): ((r: number) => unknown) | undefined => {
    if (!cols.has(f)) {
      // a nested record's one field (`curve.axis`), read off its own column (nestedColumn)
      const dot = f.indexOf('.')
      cols.set(f, dot < 0 ? tableColumn(t, f) : nestedColumn(t, f.slice(0, dot), f.slice(dot + 1))?.at)
    }
    return cols.get(f)
  }
  return build(
    t.n,
    (f, r) => col(f)?.(r),
    (f, r) => {
      let k = keys.get(f)
      if (!k) keys.set(f, (k = keyIn(t, f)))
      return k(r)
    }
  )
}

function fromRows(rows: readonly ContextRow[]): ContextIndex {
  return build(
    rows.length,
    (f, r) => {
      const row = rows[r] as unknown as Record<string, unknown>
      const dot = f.indexOf('.')
      if (dot < 0) return row[f]
      return (row[f.slice(0, dot)] as Record<string, unknown> | null | undefined)?.[f.slice(dot + 1)]
    },
    (f, r) => f in rows[r]
  )
}

const ofTable = new WeakMap<Table, ContextIndex>()
const ofRows = new WeakMap<readonly ContextRow[], ContextIndex>()

/** A result's context index (cached: per table for a columnar result — its rows never built —
 *  else per rows array). */
export function contextOf(holder: { rows: readonly ContextRow[] }): ContextIndex {
  const t = holderTable(holder)
  if (t) {
    let ix = ofTable.get(t)
    if (!ix) ofTable.set(t, (ix = fromTable(t)))
    return ix
  }
  const rows = holder.rows
  let ix = ofRows.get(rows)
  if (!ix) ofRows.set(rows, (ix = fromRows(rows)))
  return ix
}

/** The result-row indices behind some of an index's context rows, ascending (the rows' order). */
export function contextIndices(ix: ContextIndex, ctx: readonly ContextRow[]): Int32Array {
  const parts = ctx.map((c) => ix.idx.get(c)).filter((a): a is Int32Array => !!a)
  if (parts.length === 1) return parts[0]
  let len = 0
  for (const a of parts) len += a.length
  const out = new Int32Array(len)
  let o = 0
  for (const a of parts) {
    out.set(a, o)
    o += a.length
  }
  return out.sort()
}

/** The result rows behind some context rows — only those built (rowsAt) — in the rows' order. */
export function rowsOfContexts<T extends ContextRow>(
  holder: { rows: readonly T[] },
  ix: ContextIndex,
  ctx: readonly ContextRow[]
): T[] {
  if (ctx.length === ix.rows.length) return holder.rows as T[]
  return rowsAt(holder, contextIndices(ix, ctx))
}

const distinctByTable = new WeakMap<Table, Map<string, ReadonlySet<unknown>>>()
const distinctByRows = new WeakMap<readonly unknown[], Map<string, ReadonlySet<unknown>>>()

/** A column's distinct values over a result's rows (absent → undefined), without building them
 *  when it's columnar. Cached per table (or rows array) and key. */
export function distinctOf<T>(holder: { rows: readonly T[] }, key: string): ReadonlySet<unknown> {
  const t = holderTable(holder)
  const rows = t ? null : holder.rows
  const cache = t ? distinctByTable : distinctByRows
  const at = (t ?? rows) as Table & readonly unknown[]
  let m = cache.get(at)
  if (!m) cache.set(at, (m = new Map()))
  let set = m.get(key)
  if (!set) {
    const out = new Set<unknown>()
    if (t) {
      const col = tableColumn(t, key)
      for (let r = 0; r < t.n; r++) out.add(col?.(r))
    } else for (const row of rows!) out.add((row as Record<string, unknown>)[key])
    m.set(key, (set = out))
  }
  return set
}

/** The rows whose `key` passes `keep`, in order — only those built when the result is columnar. */
export function rowsWhere<T>(
  holder: { rows: readonly T[] },
  key: string,
  keep: (v: unknown) => boolean
): T[] {
  const t = holderTable(holder)
  if (!t) return holder.rows.filter((r) => keep((r as Record<string, unknown>)[key]))
  const col = tableColumn(t, key)
  const idx: number[] = []
  for (let r = 0; r < t.n; r++) if (keep(col?.(r))) idx.push(r)
  return rowsAt(holder, idx)
}

const yRanges = new WeakMap<object, Map<string, [number, number] | null>>()

/** A contrast's shared y range (contrast.ts contrastYRange) over the feature `like` shows (as
 *  rowsOfFeature picks it), an abundance contrast's on `scale` (as abundanceOnScale puts it) —
 *  read off its columns when it's columnar, so no row is built. Cached per table (or rows), feature,
 *  scale and look. */
export function contrastYRangeOf(
  holder: { rows: readonly ContrastResultRow[] },
  like: { featureId?: string } | undefined,
  scale: ValueScale | undefined,
  errors: boolean,
  points: boolean
): [number, number] | null {
  const t = holderTable(holder)
  const at: object = t ?? holder.rows
  let m = yRanges.get(at)
  if (!m) yRanges.set(at, (m = new Map()))
  const f = like?.featureId
  const key = `${f ?? ''}\u0000${scale ?? ''}\u0000${errors}\u0000${points}`
  if (m.has(key)) return m.get(key)!
  const onScale = (r: SideRow): SideRow => (scale ? rowOnScale(r, scale) : r)
  let range: [number, number] | null
  if (!t) {
    const rows = f ? holder.rows.filter((r) => r.featureId === f) : holder.rows
    range = contrastYRange(
      rows.map((r) => onScale(r)),
      errors,
      points
    )
  } else {
    const col = (k: string): ((r: number) => unknown) =>
      tableColumn(t, k) ?? ((): undefined => undefined)
    const fid = col('featureId')
    const [a, b, ae, be, ar, br] = ['FC1', 'FC2', 'FC1err', 'FC2err', 'FC1reps', 'FC2reps'].map(col)
    function* sides(): Generator<SideRow> {
      for (let r = 0; r < t!.n; r++) {
        const id = fid(r) as string | undefined
        if (f && id !== f) continue
        yield onScale({
          featureId: id as SideRow['featureId'],
          FC1: a(r) as number | null,
          FC2: b(r) as number | null,
          FC1err: ae(r) as number | null,
          FC2err: be(r) as number | null,
          FC1reps: ar(r) as number[] | undefined,
          FC2reps: br(r) as number[] | undefined
        })
      }
    }
    range = contrastYRange(sides(), errors, points)
  }
  m.set(key, range)
  return range
}

type SideRow = Pick<
  ContrastResultRow,
  'featureId' | 'FC1' | 'FC2' | 'FC1err' | 'FC2err' | 'FC1reps' | 'FC2reps'
>

const rowCtx = new WeakMap<ContextIndex, ContextRow[]>()
/** Each result row's context row, by result-row index (cached per index). */
export function contextRowAt(ix: ContextIndex): readonly ContextRow[] {
  let out = rowCtx.get(ix)
  if (!out) {
    out = new Array(ix.n)
    for (const [c, at] of ix.idx) for (const r of at) out[r] = c
    rowCtx.set(ix, out)
  }
  return out
}

/** Whether a result has a two-way ANOVA's term rows (isTermRow) — off its context index, no row
 *  built. */
export const hasTermRows = (holder: { rows: readonly ContextRow[] }): boolean =>
  contextOf(holder).rows.some((c) => c.term)

/** Parts by holder (a columnar one: its rows are never held here) or, for a plain holder, by its
 *  rows array — so once a plain result is compacted (lazyRows compactRows) its old rows go with
 *  the array, not kept for the result's lifetime by a cached part. */
const parts = new WeakMap<object, Map<string, object>>()
const partKey = (holder: { rows: readonly object[] }): object =>
  holderTable(holder) ? holder : holder.rows

/**
 * A copy of `holder` with only the rows whose context passes `keep` (`holder` itself when every
 * row does): its other fields as they are, its rows in order — for a columnar result a lazy view
 * of a slice of its table (subTable), so neither the rows left out nor the ones kept are built
 * until read. What a reader that wants a part of a result as a result of its own is handed (a
 * two-way ANOVA's signed rows, one `show` kind). Cached per holder and `key` (which names `keep`).
 */
export function holderWhere<H extends { rows: readonly ContextRow[] }>(
  holder: H,
  key: string,
  keep: (c: ContextRow) => boolean
): H {
  return partOf(holder, key, () => {
    const ix = contextOf(holder)
    const ctx = ix.rows.filter(keep)
    return ctx.length === ix.rows.length ? null : contextIndices(ix, ctx)
  })
}

/** The uniqIDs of the rows whose context passes `keep`, in first-seen order — off the context
 *  index and the uniqID column, no row built (nor a part made). */
export function idsWhere(
  holder: { rows: readonly ContextRow[] },
  keep: (c: ContextRow) => boolean
): Set<string> {
  const ix = contextOf(holder)
  const idx = contextIndices(ix, ix.rows.filter(keep))
  const t = holderTable(holder)
  const uid = t
    ? (tableColumn(t, 'uniqID') ?? ((): undefined => undefined))
    : (r: number): unknown => (holder.rows[r] as unknown as { uniqID?: unknown }).uniqID
  const out = new Set<string>()
  for (let k = 0; k < idx.length; k++) out.add(uid(idx[k]) as string)
  return out
}

/** holderWhere's twin for a test on nested record fields (`specs`: [key, sub] pairs, as
 *  someNested reads them): `test(present, values)` gets each record's truthiness (`!!r[key]`)
 *  and its field (`r[key]?.[sub]`), read off the nested tables' columns when columnar — no row
 *  built. Cached alike (`key` names the test). */
export function holderWhereNested<H extends { rows: readonly object[] }>(
  holder: H,
  key: string,
  specs: ReadonlyArray<readonly [string, string]>,
  test: (present: boolean[], values: unknown[]) => boolean
): H {
  return partOf(holder, key, () => {
    const t = holderTable(holder)
    const n = t ? t.n : holder.rows.length
    const readers = specs.map(([k, sub]) => {
      if (t) {
        const c = nestedColumn(t, k, sub)
        return c ?? { has: (): boolean => false, at: (): undefined => undefined }
      }
      const rec = (r: number): Record<string, unknown> | null | undefined =>
        (holder.rows[r] as Record<string, unknown>)[k] as Record<string, unknown> | null | undefined
      return { has: (r: number) => !!rec(r), at: (r: number) => rec(r)?.[sub] }
    })
    const present = new Array<boolean>(specs.length)
    const values = new Array<unknown>(specs.length)
    const idx: number[] = []
    for (let r = 0; r < n; r++) {
      for (let j = 0; j < readers.length; j++) {
        present[j] = readers[j].has(r)
        values[j] = readers[j].at(r)
      }
      if (test(present, values)) idx.push(r)
    }
    return idx.length === n ? null : idx
  })
}

/** The cached part `key` of a holder: `pick` gives its row indices (ascending; null for every
 *  row — the holder itself). */
function partOf<H extends { rows: readonly object[] }>(
  holder: H,
  key: string,
  pick: () => ArrayLike<number> | null
): H {
  const at = partKey(holder)
  let m = parts.get(at)
  if (!m) parts.set(at, (m = new Map()))
  let out = m.get(key) as H | undefined
  if (!out) {
    const idx = pick()
    if (!idx) out = holder
    else {
      const t = holderTable(holder)
      out =
        (t && lazyCopy(holder, {} as Partial<H>, subTable(t, idx))) ||
        ({ ...holder, rows: Array.from(idx, (i) => holder.rows[i]) } as H)
    }
    m.set(key, out)
  }
  return out
}

/** A facet of a result (facetCompareRows' group) with its result-row indices (ascending) in place
 *  of its rows. */
export interface FacetIndexGroup extends Omit<FacetGroup, 'rows'> {
  idx: Int32Array
}

/** `facetCompareRows(rows, facetDims(rows, exclude), numeric)` over a result's rows that pass
 *  `keep` (all, without it), resolved over the context tuples (contextOf) — the same groups in the
 *  same order, each with its rows' indices instead of its rows, so none is built. */
export function facetGroupsOf(
  holder: { rows: readonly ContextRow[] },
  numeric: NumericConds,
  keep?: (c: ContextRow) => boolean,
  exclude?: ConditionKey[]
): FacetIndexGroup[] {
  const ix = contextOf(holder)
  const ctx = keep ? ix.rows.filter(keep) : ix.rows
  return facetCompareRows(ctx, facetDims(ctx, exclude), numeric).map((g) => ({
    key: g.key,
    values: g.values,
    idx: contextIndices(ix, g.rows)
  }))
}
