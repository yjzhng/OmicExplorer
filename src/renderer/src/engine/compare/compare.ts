/**
 * Multi-condition comparison: vehicle-normalised (veh_norm) analysis.
 *
 * Pillar #2 of the omicViz concepts (see [[omicviz-conceptual-reuse]]): auto
 * condition-context alignment. Treatments are grouped by all active conditions
 * except the compared one (e.g. by cell, dose & time); every grouping dim is
 * carried onto the result row as context, so downstream FDR and plot faceting
 * partition by it. The vehicle denominator is matched on the same context but
 * with **dose excluded**, because the vehicle is always at dose 0. Reimplements
 * the concept of scripts/stats/comparisons.py `_normalise_cmpd_explicit` +
 * `_finalise`.
 */
import {
  applyThreshold,
  adjustPValues,
  fdrMethodOf,
  DEFAULT_THRESHOLD,
  thresholdLabel,
  welchTTest,
  type ThresholdConfig
} from '../stats/stats'
import type {
  CompareResultRow,
  ConditionKey,
  HasExtra,
  Pair,
  StandardRow,
  VehNormInput,
  VehNormResult
} from '../types'
import { customCondsIn, customSlug, isCustomCond, VALID_CONDITIONS } from '../types'

/** Values that key like-to-like grouping. Numbers compared exactly (same parse origin).
 *  A custom condition lives in the row's `extra` bag and is always a string ('' = absent). */
export function condValue(row: StandardRow | HasExtra, key: ConditionKey): string | number | null {
  if (isCustomCond(key)) return row.extra?.[customSlug(key)] ?? ''
  return (row as unknown as Record<string, string | number | null>)[key] ?? null
}

/** A numeric condition's value as a number, by key — a preset's column or a custom value's text.
 *  Null where the row has none: null, '' (a custom condition's "absent") or anything that isn't a
 *  finite number — so an absent custom value is never read as 0. */
export function numValue(row: StandardRow | HasExtra, key: ConditionKey): number | null {
  const v = condValue(row, key)
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function groupKey(vals: Array<string | number | null>): string {
  return vals.map((v) => (v == null ? '\u0000' : String(v))).join('|')
}

export function log2Pos(v: number | null): number {
  return v != null && Number.isFinite(v) && v > 0 ? Math.log2(v) : NaN
}

/** One pre-FDR comparison record. Any condition key may be attached as context;
 *  `finaliseCompare` pools FDR by whichever conditions are actually present. */
export interface RawStatRow {
  uniqID: string
  cell?: string | null
  cmpd?: string | null
  dose?: number | null
  time?: number | null
  /** custom condition slug → value; attached as context exactly like the preset columns */
  extra?: Record<string, string>
  cmp_cond: string
  comparison: string
  mean1: number
  mean2: number
  sd1: number
  sd2: number
  log2FC: number
  pVal: number
  fcSE?: number
}

// ── shared data-access seam ─────────────────────────────────────────────────
// Every analysis reaches condition values ONLY through these helpers, so the
// physical row storage (array-of-objects today) can later be swapped for a
// columnar/typed backend without touching analysis logic. See
// [[engine-storage-strategy]].

/** Numeric-aware equality mirroring omicViz `_val_eq`. */
export function valEq(a: string | number | null, b: string | number): boolean {
  const fa = typeof a === 'number' ? a : Number(a)
  const fb = typeof b === 'number' ? b : Number(b)
  if (Number.isFinite(fa) && Number.isFinite(fb)) return Math.abs(fa - fb) < 1e-9
  return String(a) === String(b)
}

/** Whether a condition carries any real value (mirrors omicViz `notna().any()`). Categorical
 *  conditions (cell, cmpd, every custom one) count '' as absent; numeric ones count null. */
export function condPresent(rows: Array<StandardRow | HasExtra>, c: ConditionKey): boolean {
  if (c === 'cell' || c === 'cmpd' || isCustomCond(c))
    return rows.some((r) => condValue(r, c) !== '' && condValue(r, c) != null)
  return rows.some((r) => condValue(r, c) != null)
}

/** Store a condition value on a raw row with the right runtime type (numbers for dose/time,
 *  strings in the `extra` bag for a custom condition). */
export function setCond(
  row: RawStatRow | HasExtra,
  c: ConditionKey,
  val: string | number | null
): void {
  if (isCustomCond(c)) {
    const bag = (row.extra ??= {})
    bag[customSlug(c)] = val == null ? '' : String(val)
    return
  }
  const rec = row as unknown as Record<string, string | number | null>
  if ((c === 'dose' || c === 'time') && typeof val !== 'number' && val != null) {
    const n = Number(val)
    rec[c] = Number.isFinite(n) ? n : null
  } else {
    rec[c] = val
  }
}

/** Group rows by the given condition dims → key → rows (stable; key via groupKey). */
export function groupRowsBy(rows: StandardRow[], dims: ConditionKey[]): Map<string, StandardRow[]> {
  const groups = new Map<string, StandardRow[]>()
  for (const r of rows) {
    const k = groupKey(dims.map((d) => condValue(r, d)))
    let arr = groups.get(k)
    if (!arr) {
      arr = []
      groups.set(k, arr)
    }
    arr.push(r)
  }
  return groups
}

/** Run one vehicle-normalised comparison set and return finalised result rows. */
export function runVehNorm(input: VehNormInput): VehNormResult {
  const { rows, pairs, activeConditions } = input
  const transform = input.transform ?? true
  const method = input.method ?? 'ttest'
  const threshold: ThresholdConfig = input.threshold ?? { ...DEFAULT_THRESHOLD, statType: 'pQ' }
  const transformed = transform && method === 'ttest'

  // Treatment grouping dims: active conditions except cmpd, present with values.
  const trtDims = activeConditions.filter((c) => c !== 'cmpd' && condPresent(rows, c))
  // Vehicle matches on the same context minus dose (vehicle is always dose 0).
  const vehDims = trtDims.filter((c) => c !== 'dose')

  // Value used for the test: log2 space when transformed, raw otherwise.
  const statValue = (r: StandardRow): number => (transformed ? log2Pos(r.value) : (r.value ?? NaN))

  const raw: RawStatRow[] = []
  const comparisons: string[] = []

  for (const [numCmpd, denCmpd] of pairs as Pair[]) {
    const label = `${numCmpd} | ${denCmpd}`
    comparisons.push(label)
    const cmpdRows = rows.filter((r) => r.cmpd === numCmpd)
    const vehRows = rows.filter((r) => r.cmpd === denCmpd)
    if (cmpdRows.length === 0 || vehRows.length === 0) continue

    // Group treatment rows by trtDims
    const groups = new Map<string, StandardRow[]>()
    for (const r of cmpdRows) {
      const k = groupKey(trtDims.map((d) => condValue(r, d)))
      let arr = groups.get(k)
      if (!arr) {
        arr = []
        groups.set(k, arr)
      }
      arr.push(r)
    }

    for (const grp of groups.values()) {
      const rep = grp[0]
      // vehicle slice: match on vehDims values from this group
      const vehSlice = vehRows.filter((v) =>
        vehDims.every((d) => condValue(v, d) === condValue(rep, d))
      )
      if (grp.length === 0 || vehSlice.length === 0) continue

      const numAgg = grp.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const denAgg = vehSlice.map((r) => ({ uniqID: r.uniqID, value: statValue(r) }))
      const res = welchTTest(numAgg, denAgg, transformed)

      for (const w of res) {
        const row: RawStatRow = {
          uniqID: w.uniqID,
          cmp_cond: 'cmpd',
          comparison: label,
          mean1: w.mean1,
          mean2: w.mean2,
          sd1: w.sd1,
          sd2: w.sd2,
          log2FC: w.log2FC,
          pVal: w.pVal,
          fcSE: w.fcSE
        }
        setCond(row, 'cmpd', numCmpd) // numerator compound
        // Every treatment grouping dim (cell, dose, time — whichever are active)
        // is carried onto the row as context, so downstream FDR pools per context
        // and plots can facet by it. Previously only dose/time were kept and cell
        // was silently dropped, merging distinct cells into one comparison.
        for (const d of trtDims) setCond(row, d, condValue(rep, d))
        raw.push(row)
      }
    }
  }

  return { rows: finaliseCompare(raw, threshold), comparisons, threshold }
}

/**
 * FDR + thresholding shared by every t-test comparison (veh_norm, direct,
 * two_way_anova). BH is pooled per (cmp_cond, [present conditions], comparison)
 * group — matching omicViz `_apply_fdr`. "Present" = any condition key attached
 * to at least one raw row, so veh_norm pools by cmpd/dose/time exactly as before
 * while direct on cell pools by cell + context conds.
 */
export function finaliseCompare(raw: RawStatRow[], threshold: ThresholdConfig): CompareResultRow[] {
  const presentConds: ConditionKey[] = [
    ...VALID_CONDITIONS.filter((c) =>
      raw.some((r) => (r as unknown as Record<string, unknown>)[c] !== undefined)
    ),
    ...customCondsIn(raw)
  ]
  const cond = (r: RawStatRow, c: ConditionKey): string | number | null =>
    isCustomCond(c)
      ? (r.extra?.[customSlug(c)] ?? null)
      : ((r as unknown as Record<string, string | number | null>)[c] ?? null)

  // Group indices for BH
  const groups = new Map<string, number[]>()
  raw.forEach((r, i) => {
    const key = groupKey([r.cmp_cond, ...presentConds.map((c) => cond(r, c)), r.comparison])
    let arr = groups.get(key)
    if (!arr) {
      arr = []
      groups.set(key, arr)
    }
    arr.push(i)
  })

  // Adjusted p per comparison group by the configured method (BH unless told otherwise; with
  // raw-p calls the q column is still filled, by BH, for display).
  const method = fdrMethodOf(threshold)
  const qVals = new Array<number>(raw.length).fill(NaN)
  for (const idxs of groups.values()) {
    const ps = idxs.map((i) => raw[i].pVal)
    const qs = adjustPValues(ps, method === 'none' ? 'bh' : method)
    idxs.forEach((i, j) => (qVals[i] = qs[j]))
  }

  const negLog10 = (x: number): number =>
    Number.isFinite(x) ? -Math.log10(Math.max(x, 1e-300)) : NaN
  const label = thresholdLabel(threshold)

  return raw.map((r, i) => {
    const pP = negLog10(r.pVal)
    const pQ = negLog10(qVals[i])
    const stat = threshold.statType === 'pP' ? pP : pQ
    const { signf, effect } = applyThreshold(r.log2FC, stat, threshold)
    return {
      uniqID: r.uniqID,
      cell: r.cell ?? undefined,
      cmpd: r.cmpd ?? '',
      dose: r.dose ?? null,
      time: r.time ?? null,
      ...(r.extra ? { extra: r.extra } : null),
      cmp_cond: r.cmp_cond,
      comparison: r.comparison,
      mean1: Number.isFinite(r.mean1) ? r.mean1 : null,
      mean2: Number.isFinite(r.mean2) ? r.mean2 : null,
      sd1: Number.isFinite(r.sd1) ? r.sd1 : null,
      sd2: Number.isFinite(r.sd2) ? r.sd2 : null,
      log2FC: Number.isFinite(r.log2FC) ? r.log2FC : null,
      fcSE: r.fcSE != null && Number.isFinite(r.fcSE) ? r.fcSE : null,
      pP: Number.isFinite(pP) ? pP : null,
      pQ: Number.isFinite(pQ) ? pQ : null,
      thrsh: label,
      signf,
      effect
    }
  })
}
