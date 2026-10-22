/**
 * The Contrast dialog's model, apart from its UI: per condition, contrasted (group A at one value,
 * group B at one value — two different ones, or the same one) or matched (one contrast per value both
 * sides have; values can be left out). Genes pair by ID. Nothing is pooled: the engine only matches a
 * condition or fixes it to one value per side (engine/contrast.ts runContrastPair), and this compiles
 * to exactly that — intra-dataset as num / den / match, inter-dataset as match / pairFix.
 */
import {
  condLabel,
  orderConds,
  type CondSelector,
  type ConditionKey,
  type NumericConds,
  type PairFix,
  type StandardRow
} from '../engine'
import { cv, valuesOf } from './compareModel'

export type SliceMode = 'slice' | 'match'

export interface ContrastState {
  /** each condition's mode as picked (absent = the dialog's default for its kind) */
  cmode: Partial<Record<ConditionKey, SliceMode>>
  /** a contrasted condition's value per side */
  sl: Partial<Record<ConditionKey, { a?: string; b?: string }>>
  /** a matched condition's values left out */
  drop: Partial<Record<ConditionKey, string[]>>
}

export interface SliceInfo {
  c: ConditionKey
  /** the effective mode: matched needs a value on both sides; one value alike on both is 'single' */
  m: SliceMode | 'single'
  va: string[]
  vb: string[]
  sl: { a: string; b: string }
  drop: Set<string>
  /** a matched condition's values both sides have, less those left out */
  kept: string[]
}

export interface ContrastModel {
  rows: SliceInfo[]
  /** one contrast per combination of the matched values both groups have */
  keys: string[]
  ga: Map<string, StandardRow[]>
  gb: Map<string, StandardRow[]>
  /** the groups differ on some contrasted condition (or are two datasets) */
  differs: boolean
}

const groupBy = (
  rows: StandardRow[],
  key: (r: StandardRow) => string
): Map<string, StandardRow[]> => {
  const m = new Map<string, StandardRow[]>()
  for (const r of rows) {
    const k = key(r)
    const g = m.get(k)
    if (g) g.push(r)
    else m.set(k, [r])
  }
  return m
}

/** The two groups (A from `RA`, B from `RB`) and the contrasts they make. `defMode` is a condition's
 *  mode until picked: matched (intra-dataset's conditions, inter-dataset's every one). */
export function contrastModel(
  state: ContrastState,
  RA: readonly StandardRow[],
  RB: readonly StandardRow[],
  conds: readonly ConditionKey[],
  numeric: NumericConds,
  defMode: SliceMode = 'match'
): ContrastModel {
  const rows: SliceInfo[] = orderConds(conds).map((c) => {
    const va = valuesOf(RA, c, numeric)
    const vb = valuesOf(RB, c, numeric)
    const single = va.length <= 1 && vb.length <= 1 && va[0] === vb[0]
    let m: SliceInfo['m'] = single ? 'single' : (state.cmode[c] ?? defMode)
    if (m === 'match' && !va.some((v) => vb.includes(v))) m = 'slice'
    const s = state.sl[c] ?? {}
    const sl = {
      a: s.a != null && va.includes(s.a) ? s.a : va[0],
      b: s.b != null && vb.includes(s.b) ? s.b : vb[0]
    }
    const drop = new Set(state.drop[c] ?? [])
    return { c, m, va, vb, sl, drop, kept: va.filter((v) => vb.includes(v) && !drop.has(v)) }
  })
  const keep = (x: SliceInfo, r: StandardRow, side: 'a' | 'b'): boolean =>
    x.m === 'slice'
      ? cv(r, x.c) === x.sl[side]
      : x.m === 'match'
        ? x.kept.includes(cv(r, x.c) ?? '')
        : true
  const A = RA.filter((r) => rows.every((x) => keep(x, r, 'a')))
  const B = RB.filter((r) => rows.every((x) => keep(x, r, 'b')))
  const key = (r: StandardRow): string =>
    rows
      .filter((x) => x.m === 'match')
      .map((x) => cv(r, x.c) ?? '')
      .join('\u0001')
  const ga = groupBy(A, key)
  const gb = groupBy(B, key)
  return {
    rows,
    keys: [...ga.keys()].filter((k) => gb.has(k)),
    ga,
    gb,
    differs: rows.some((x) => x.m === 'slice' && x.sl.a !== x.sl.b)
  }
}

/** Intra-dataset: each contrasted condition pinned to one value per side, a matched one with values
 *  left out pinned to the kept ones on both sides. */
export function compileIntra(m: ContrastModel): {
  num: CondSelector
  den: CondSelector
  match: ConditionKey[]
} {
  const num: CondSelector = {}
  const den: CondSelector = {}
  for (const x of m.rows) {
    if (x.m === 'slice') {
      num[x.c] = [x.sl.a]
      den[x.c] = [x.sl.b]
    } else if (x.m === 'match' && x.drop.size) num[x.c] = den[x.c] = x.kept
  }
  return { num, den, match: m.rows.filter((x) => x.m === 'match').map((x) => x.c) }
}

/** Inter-dataset: one value per dataset for each contrasted condition; a matched one with values
 *  left out, the kept list on both (applyFix honours a list on a matched condition). */
export function compileInter(m: ContrastModel): { match: ConditionKey[]; pairFix: PairFix } {
  const pairFix: PairFix = { a: {}, b: {} }
  for (const x of m.rows) {
    if (x.m === 'slice') {
      pairFix.a[x.c] = x.sl.a
      pairFix.b[x.c] = x.sl.b
    } else if (x.m === 'match' && x.drop.size) pairFix.a[x.c] = pairFix.b[x.c] = x.kept
  }
  return { match: m.rows.filter((x) => x.m === 'match').map((x) => x.c), pairFix }
}

/** A fresh intra-dataset contrast: every condition matched, with cmpd (or the first condition that
 *  has two values) contrasted between its first two values. */
export function defaultIntra(
  rows: readonly StandardRow[],
  conds: readonly ConditionKey[],
  numeric: NumericConds
): ContrastState {
  const multi = orderConds(conds).filter((c) => valuesOf(rows, c, numeric).length > 1)
  const c = multi.includes('cmpd') ? 'cmpd' : multi[0]
  if (!c) return { cmode: {}, sl: {}, drop: {} }
  const [a, b] = valuesOf(rows, c, numeric)
  const state: ContrastState = { cmode: {}, sl: {}, drop: {} }
  state.cmode[c] = 'slice'
  state.sl[c] = { a, b }
  return state
}

const leftOut = (vals: string[], keep?: string[] | null): string[] =>
  keep && keep.length ? vals.filter((v) => !keep.includes(v)) : []

/** A saved intra-dataset config as dialog state: a condition pinned on both sides to one value each
 *  is contrasted; a matched one keeps its pinned values (the rest were left out). */
export function readIntra(
  cfg: { num?: CondSelector; den?: CondSelector; match?: ConditionKey[] },
  rows: readonly StandardRow[],
  conds: readonly ConditionKey[],
  numeric: NumericConds
): ContrastState {
  const num = cfg.num ?? {}
  const den = cfg.den ?? {}
  const pinned =
    Object.values(num).some((v) => v?.length) || Object.values(den).some((v) => v?.length)
  if (!pinned) return defaultIntra(rows, conds, numeric)
  const state: ContrastState = { cmode: {}, sl: {}, drop: {} }
  for (const c of conds) {
    const n = num[c]
    const d = den[c]
    if (cfg.match?.includes(c)) {
      state.cmode[c] = 'match'
      const out = leftOut(valuesOf(rows, c, numeric), n)
      if (out.length) state.drop[c] = out
    } else if (n?.length === 1 && d?.length === 1) {
      state.cmode[c] = 'slice'
      state.sl[c] = { a: n[0], b: d[0] }
    }
  }
  return state
}

/** A saved inter-dataset config as dialog state: matched conditions (a list in pairFix = the kept
 *  values), and each fixed one's value per dataset. */
export function readInter(
  cfg: { match?: ConditionKey[]; pairFix?: PairFix },
  RA: readonly StandardRow[],
  RB: readonly StandardRow[],
  conds: readonly ConditionKey[],
  numeric: NumericConds
): ContrastState {
  const state: ContrastState = { cmode: {}, sl: {}, drop: {} }
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? (v.length === 1 ? v[0] : undefined) : v || undefined
  for (const c of conds) {
    const fa = cfg.pairFix?.a[c]
    const fb = cfg.pairFix?.b[c]
    if (!cfg.match || cfg.match.includes(c)) {
      state.cmode[c] = 'match'
      const keep = Array.isArray(fa) ? fa : null
      const out = leftOut(
        [...new Set([...valuesOf(RA, c, numeric), ...valuesOf(RB, c, numeric)])],
        keep
      )
      if (out.length) state.drop[c] = out
    } else {
      state.cmode[c] = 'slice'
      state.sl[c] = { a: one(fa), b: one(fb) }
    }
  }
  return state
}

/** The Contrast line: what differs (A vs B), where both sit, and what is matched. */
export function contrastLine(m: ContrastModel, base?: { a: string; b: string }): string {
  const diff = m.rows.filter((x) => x.m === 'slice' && x.sl.a !== x.sl.b)
  const same = m.rows.filter((x) => x.m === 'slice' && x.sl.a === x.sl.b)
  const per = m.rows.filter((x) => x.m === 'match')
  const side = (s: 'a' | 'b'): string =>
    [base?.[s], ...diff.map((x) => x.sl[s])].filter(Boolean).join(' · ')
  if (!side('a') && !side('b'))
    return 'condition identical on both sides. Select different conditions.'
  return (
    `${side('a')} vs ${side('b')}` +
    (same.length ? `, at ${same.map((x) => x.sl.a).join(' · ')}` : '') +
    (per.length ? `, per ${per.map((x) => condLabel(x.c)).join(' per ')}` : '')
  )
}

/** A tail %'s arrow-key step: 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1 — then by 0.5 to 50. A value
 *  between two rungs steps to the next one in that direction. */
const TAIL_RUNGS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
export function tailStep(v: number, dir: 1 | -1): number {
  const eps = 1e-9
  if (dir > 0) {
    const r = TAIL_RUNGS.find((x) => x > v + eps)
    if (r != null) return r
    return Math.min(50, Math.floor((v + eps) / 0.5) * 0.5 + 0.5)
  }
  if (v > 1 + eps) return Math.max(1, Math.ceil((v - eps) / 0.5) * 0.5 - 0.5)
  const below = TAIL_RUNGS.filter((x) => x < v - eps)
  return below.length ? below[below.length - 1] : TAIL_RUNGS[0]
}
