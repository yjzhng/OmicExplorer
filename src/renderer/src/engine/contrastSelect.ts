/** A Contrast in select mode (Contrast's run): the input's rows pooled, split into the two
 *  selections (num → FC1, den → FC2), each row made a side row of every feature, and the features
 *  contrasted and stacked (contrastStack.ts). Here in the engine so none of it — every Clean data
 *  row read, every side row made and packed to send — runs on the UI thread.
 *
 *  A Compare input: each row's value is its log₂FC, with each replicate's log₂ ratio to the control
 *  mean for the plots' points. Clean data inputs: one pseudo row per gene × condition context, its
 *  mean log₁₀ abundance with the replicate SE (the plots' error band). */
import { withBatchCond } from './batch'
import { combineStandardize } from './combine'
import type { ContrastFeatureId, ContrastPairInput, ContrastResult, ValueCutoffs } from './contrast'
import {
  compareFeatureValue,
  isSurfaceRow,
  stdFeatureValue,
  stdGroupsOf,
  surfaceSideRows,
  surfaceSliceCond,
  type CompareFeatureCtx
} from './contrastSides'
import { stackContrasts } from './contrastStack'
import { replicateLog2FCs, stdByGene } from './curvePoints'
import {
  condsIn,
  termless,
  type CompareResultRow,
  type CondSelector,
  type ConditionKey,
  type StandardizeResult,
  type StandardRow
} from './types'
import { ctxValue } from './plotData'
import { decodeValue, type Table } from './wire'
import type { ContrastSideRow } from './contrast'

export interface ContrastSelectInput {
  /** Clean data inputs (an abundance contrast): their results */
  stds: StandardizeResult[]
  /** Compare inputs: each one's rows, and the Clean data its replicates come from (its inputs,
   *  pooled; per batch when it ran per batch) */
  compares: Array<{
    /** (its table as the client sends it — a table stays one on the way — or its rows) */
    rows: CompareResultRow[] | Table
    std?: StandardizeResult[]
    splitBatch?: boolean
  }>
  num: CondSelector
  den: CondSelector
  /** the features to contrast, in switcher order; `tagOne`: tag a lone feature's rows too (a
   *  curve fit's curve log₂FC is named even alone) */
  features: Array<{ id: ContrastFeatureId; label: string }>
  tagOne: boolean
  /** how a Compare reads its features */
  selCtx: CompareFeatureCtx
  /** each feature's linear cutoffs, from the Compare's threshold */
  cutoffs: Partial<Record<ContrastFeatureId, Partial<ValueCutoffs>>>
  match: ConditionKey[]
  pair: Pick<ContrastPairInput, 'relationship' | 'stat' | 'nameConds'>
}

/** The stacked result, or why there's none (said as the run's error). */
export function contrastSelect(input: ContrastSelectInput): ContrastResult | { error: string } {
  const { stds, selCtx } = input
  const compares = input.compares.map((c) => ({
    ...c,
    rows: (Array.isArray(c.rows) ? c.rows : decodeValue(c.rows)) as CompareResultRow[]
  }))
  const isQuantity = !compares.length
  // Each pooled row's replicates (on its value's scale), for the DR's points.
  const repsOf = new WeakMap<CompareResultRow, number[]>()
  const pooled: CompareResultRow[] = isQuantity
    ? stdGroupsOf(stds.map(withBatchCond)).map(({ row, logs }) => {
        const out = poolRow(row, logs)
        repsOf.set(out, logs)
        return out
      })
    : compares.flatMap((c) => termless(c.rows))
  // A Compare's rows: each replicate's log2 ratio to the control mean.
  if (!isQuantity)
    for (const c of compares) {
      if (!c.std?.length) continue
      const pooledStd = combineStandardize(c.std)
      const byGene = stdByGene((c.splitBatch ? withBatchCond(pooledStd) : pooledStd).rows)
      for (const row of termless(c.rows)) {
        const reps = replicateLog2FCs(row, byGene.get(row.uniqID) ?? [])
        if (reps.length) repsOf.set(row, reps)
      }
    }
  if (!pooled.length) return { error: 'The upstream tile has no results.' }
  // Each side is an EXPLICIT cond-value selection. A pooled row belongs to a side when it matches
  // every pinned condition of that side's selector (others are free). The two are then joined on
  // the chosen match context (runContrastPair), so nothing about the context is inferred.
  const selConds = condsIn(pooled)
  const matchesSel = (row: CompareResultRow, sel: CondSelector): boolean =>
    selConds.every((c) => {
      const want = sel[c]
      if (!want || want.length === 0) return true
      const v = ctxValue(row, c)
      return v != null && v !== '' && want.map(String).includes(String(v))
    })
  const selLabel = (sel: CondSelector): string => {
    const parts = selConds
      .filter((c) => (sel[c]?.length ?? 0) > 0)
      .map((c) => (sel[c] as string[]).join('/'))
    return parts.length ? parts.join(' · ') : 'all'
  }
  // A surface is contrasted slice by slice (surfaceSideRows), matched on the slices' condition.
  const surf = isQuantity ? undefined : surfaceSliceCond(pooled)
  const match = surf && !input.match.includes(surf) ? [...input.match, surf] : input.match
  const toSideRow = (row: CompareResultRow, f: ContrastFeatureId): ContrastSideRow => ({
    uniqID: row.uniqID,
    cell: row.cell ?? null,
    cmpd: row.cmpd,
    dose: row.dose,
    time: row.time,
    ...(row.extra ? { extra: row.extra } : null),
    value:
      f === 'value'
        ? row.log2FC
        : isQuantity
          ? stdFeatureValue(repsOf.get(row) ?? [], f)
          : compareFeatureValue(row, f, selCtx),
    signf: row.signf,
    effect: row.effect,
    pP: row.pP,
    pQ: row.pQ,
    ...(f === 'value'
      ? { se: row.fcSE ?? null, ...(repsOf.has(row) ? { reps: repsOf.get(row) } : null) }
      : null)
  })
  const toSideRows = (row: CompareResultRow, f: ContrastFeatureId): ContrastSideRow[] =>
    isSurfaceRow(row) ? surfaceSideRows(row, f, selCtx) : [toSideRow(row, f)]
  const rowsA = pooled.filter((r) => matchesSel(r, input.num))
  const rowsB = pooled.filter((r) => matchesSel(r, input.den))
  if (!rowsA.length || !rowsB.length)
    return { error: 'One contrast side matched no rows — adjust the FC1/FC2 selections.' }
  const one = input.features.length <= 1
  const list = one ? [input.features[0] ?? { id: 'value' as const, label: '' }] : input.features
  return stackContrasts(
    list.map((f) => ({
      input: {
        sideA: rowsA.flatMap((r) => toSideRows(r, f.id)),
        sideB: rowsB.flatMap((r) => toSideRows(r, f.id)),
        match,
        ...input.pair,
        feature: f.id,
        cutoffDefaults: input.cutoffs[f.id],
        labelA: selLabel(input.num),
        labelB: selLabel(input.den),
        // Abundance slices carry no per-side significance, so the band is the only divergence
        // call.
        driverMask: !isQuantity
      },
      ...(!one || input.tagOne ? { tag: { featureId: f.id, feature: f.label } } : null)
    }))
  )
}

/** One abundance group as a pseudo primary row: its mean log10 abundance, with the replicate SE
 *  carried as fcSE (the DR error band). */
function poolRow(row: StandardRow, logs: number[]): CompareResultRow {
  const mean = logs.reduce((s, v) => s + v, 0) / logs.length
  // SE of the mean abundance = SD / √n (matches the fold-change SE convention).
  const sd =
    logs.length >= 2
      ? Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (logs.length - 1)) /
        Math.sqrt(logs.length)
      : null
  return {
    uniqID: row.uniqID,
    cmpd: row.cmpd,
    dose: row.dose,
    time: row.time,
    cell: row.cell,
    ...(row.extra ? { extra: row.extra } : null),
    cmp_cond: '',
    comparison: '',
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC: mean,
    fcSE: sd,
    pP: null,
    pQ: null,
    thrsh: '',
    signf: false,
    effect: 'none'
  }
}
