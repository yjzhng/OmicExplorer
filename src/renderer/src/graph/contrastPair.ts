/** Contrast-input helpers shared by the run path (store), the selector window, and the canvas. */
import {
  condPresent,
  condsIn,
  curveDescribed,
  replicateLog2FCs,
  stdByGene,
  type CompareResultRow,
  type ConditionKey,
  type ContrastFeatureId,
  type ContrastSideRow,
  type StandardRow
} from '../engine'
import { resolveContrastSource, type ContrastConfig, type NodeResult } from './types'

/** One feature a Contrast can compare (see ContrastFeatureId) and its name on the switcher. */
export interface ContrastFeature {
  id: ContrastFeatureId
  label: string
}

/** How a Compare side reads its features: its significance (p or q, as it calls by) and, for a
 *  curve fit over dose, the dose unit's size in molar (pEC50 in molar, as CurveCurator reports
 *  it; 1 = the dose's own units). */
export interface CompareFeatureCtx {
  statType: 'pP' | 'pQ'
  doseScale: number
}

/** A curve fit's row as a curve along one axis: CurveCurator's / the 4PL's, or the response
 *  surface method's (a surface — dose × time — is no one curve). */
const curveAxisOf = (r: CompareResultRow): 'dose' | 'time' | null => {
  const a = r.curve?.axis ?? (r.rs && r.rs.axis !== 'surface' ? r.rs.axis : undefined)
  return a === 'dose' || a === 'time' ? a : null
}

/** A dose × time surface's row (the response surface method over dose × time): one gene, every
 *  dose and time at once. */
export const isSurfaceRow = (r: CompareResultRow): boolean => r.rs?.axis === 'surface'

/** A surface's row as one side row per time point, for one feature — a surface has no single
 *  fold change or EC50, so it's contrasted time by time (the run matches the sides on time):
 *  - its fold change: the surface fit's peak at that time — the largest fitted effect across the
 *    doses, signed — for every gene;
 *  - its pEC50: that time's dose curve's midpoint (the description's slices), for the genes the
 *    Curve fit described. */
export function surfaceSideRows(
  r: CompareResultRow,
  f: ContrastFeatureId,
  ctx: CompareFeatureCtx
): ContrastSideRow[] {
  const base = {
    uniqID: r.uniqID,
    cell: r.cell ?? null,
    cmpd: r.cmpd,
    dose: null,
    ...(r.extra ? { extra: r.extra } : null),
    signf: r.signf,
    effect: r.effect,
    pP: r.pP,
    pQ: r.pQ
  }
  if (f === 'pec50')
    return (r.rs?.surface?.byTime ?? []).map((sl) => {
      const v = sl.mid > 0 ? -Math.log10(sl.mid * ctx.doseScale) : NaN
      return { ...base, time: sl.at, value: Number.isFinite(v) ? v : null }
    })
  const peak = new Map<number, number>()
  for (const c of r.rs?.cells ?? []) {
    const cur = peak.get(c.time)
    if (Number.isFinite(c.fitted) && (cur === undefined || Math.abs(c.fitted) > Math.abs(cur)))
      peak.set(c.time, c.fitted)
  }
  return [...peak].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ ...base, time, value }))
}

/** A Compare row's value of one feature. */
export function compareFeatureValue(
  r: CompareResultRow,
  f: ContrastFeatureId,
  ctx: CompareFeatureCtx
): number | null {
  if (f === 'p') return ctx.statType === 'pQ' ? r.pQ : r.pP
  if (f === 'pec50') {
    // EC50 in the axis's units — the 4PL's, or the description midpoint — as the potency plot reads
    // it; pEC50 = −log₁₀ EC50 (in molar over dose, where the unit says how).
    const axis = curveAxisOf(r)
    // (an undescribed 4PL curve — responders only, not one — has none)
    const ec50 = r.curve
      ? curveDescribed(r.curve)
        ? 10 ** -r.curve.pec50
        : undefined
      : r.rs?.desc?.mid
    if (!axis || ec50 == null || !(ec50 > 0)) return null
    const v = -Math.log10(ec50 * (axis === 'dose' ? ctx.doseScale : 1))
    return Number.isFinite(v) ? v : null
  }
  return r.log2FC
}

/** A Clean data group's value of one feature, from its replicates' log₁₀ abundances: their mean,
 *  their SD (log₁₀), or the CV of the abundances themselves (%). A spread needs two replicates. */
export function stdFeatureValue(logs: number[], f: ContrastFeatureId): number | null {
  const n = logs.length
  if (!n) return null
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
  const sd = (a: number[]): number => {
    const m = mean(a)
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
  }
  if (f === 'sd') return n >= 2 ? sd(logs) : null
  if (f === 'cv') {
    if (n < 2) return null
    const lin = logs.map((v) => 10 ** v)
    const m = mean(lin)
    return m > 0 ? (sd(lin) / m) * 100 : null
  }
  return mean(logs)
}

/** The features a Contrast of this input can switch between, in switcher order (the sides' own
 *  value first). Clean data: abundance, SD, CV. A Compare: log₂FC and its significance (p or q, as
 *  it calls by). A curve fit: its curve fold change — the peak, by the response surface method —
 *  and its pEC50, where any curve has one. */
export function contrastFeatures(r: NodeResult | undefined): ContrastFeature[] {
  if (r?.kind === 'standardize')
    return [
      { id: 'value', label: 'abundance' },
      { id: 'sd', label: 'SD' },
      { id: 'cv', label: 'CV %' }
    ]
  if (r?.kind !== 'compare') return []
  const rows = r.cmp.rows
  const axes = new Set(rows.map(curveAxisOf).filter((a) => a != null))
  // Surfaces: both per time point (see surfaceSideRows) — pEC50 where any gene was described.
  if (rows.some(isSurfaceRow)) {
    const fc: ContrastFeature = { id: 'value', label: 'peak log₂FC' }
    return rows.some((x) => x.rs?.surface?.byTime.length)
      ? [fc, { id: 'pec50', label: 'pEC50' }]
      : [fc]
  }
  if (rows.some((x) => x.curve || x.rs)) {
    const fc: ContrastFeature = {
      id: 'value',
      label: rows.some((x) => x.rs) ? 'peak log₂FC' : 'curve log₂FC'
    }
    if (!axes.size) return [fc]
    return [fc, { id: 'pec50', label: axes.has('dose') ? 'pEC50' : 'pEC50 (time)' }]
  }
  const q = (r.cmp.threshold?.statType ?? 'pQ') === 'pQ'
  return [
    { id: 'value', label: 'log₂FC' },
    { id: 'p', label: q ? '−log₁₀ q' : '−log₁₀ p' }
  ]
}

/** Clean data rows gathered per gene × condition context — a group's replicates together — with
 *  their log₁₀ abundances (a non-positive value has none). */
export function stdGroups(rows: StandardRow[]): Array<{ row: StandardRow; logs: number[] }> {
  const groups = new Map<string, { row: StandardRow; logs: number[] }>()
  for (const row of rows) {
    if (row.value == null || !(row.value > 0)) continue
    // Custom conditions join the key — without them two distinct contexts would pool together.
    const extraKey = Object.keys(row.extra ?? {})
      .sort()
      .map((k) => `${k}=${row.extra![k]}`)
      .join('¦')
    const key = `${row.uniqID}¦${row.cell ?? ''}¦${row.cmpd ?? ''}¦${row.dose ?? ''}¦${row.time ?? ''}¦${extraKey}`
    let g = groups.get(key)
    if (!g) groups.set(key, (g = { row, logs: [] }))
    g.logs.push(Math.log10(row.value))
  }
  return [...groups.values()]
}

/** A result as one side of a paired contrast: Compare → log2FC (+ significance); Standardize →
 *  per-sample log10 abundance (the engine averages replicates + unmatched dims to the matched
 *  context). Anything else can't be a side. A side's replicates ride along for the DR's points:
 *  a sample's own value, or — given the Clean data a Compare ran on (`cleanStd`) — each
 *  replicate's log2 ratio to the control mean (previews leave it out). */
export function toContrastSide(
  r: NodeResult | undefined,
  cleanStd?: StandardRow[],
  feature: ContrastFeatureId = 'value',
  ctx: CompareFeatureCtx = { statType: 'pQ', doseScale: 1 },
  /** the run: a dose × time surface's rows per time point (surfaceSideRows); the selector's
   *  preview keeps one per gene */
  surfacesPerTime = false
): ContrastSideRow[] {
  if (r?.kind === 'compare' && surfacesPerTime && r.cmp.rows.some(isSurfaceRow))
    return r.cmp.rows.flatMap((row) =>
      isSurfaceRow(row) ? surfaceSideRows(row, feature, ctx) : []
    )
  if (r?.kind === 'compare' && feature !== 'value')
    // Another feature of the same rows: its value alone (no SE or replicates — those are the fold
    // change's), the side's own calls kept for the divergence mask.
    return r.cmp.rows.map((row) => ({
      uniqID: row.uniqID,
      cell: row.cell ?? null,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      ...(row.extra ? { extra: row.extra } : null),
      value: compareFeatureValue(row, feature, ctx),
      signf: row.signf,
      effect: row.effect,
      pP: row.pP,
      pQ: row.pQ
    }))
  if (r?.kind === 'standardize' && feature !== 'value')
    // A spread is a group's, not a sample's: one row per gene × condition context.
    return stdGroups(r.std.rows).map(({ row, logs }) => ({
      uniqID: row.uniqID,
      cell: row.cell,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      ...(row.extra ? { extra: row.extra } : null),
      value: stdFeatureValue(logs, feature)
    }))
  if (r?.kind === 'compare') {
    const byGene = cleanStd ? stdByGene(cleanStd) : undefined
    return r.cmp.rows.map((row) => {
      const reps = byGene ? replicateLog2FCs(row, byGene.get(row.uniqID) ?? []) : []
      return {
        uniqID: row.uniqID,
        cell: row.cell ?? null,
        cmpd: row.cmpd,
        dose: row.dose,
        time: row.time,
        ...(row.extra ? { extra: row.extra } : null),
        value: row.log2FC,
        signf: row.signf,
        effect: row.effect,
        pP: row.pP,
        pQ: row.pQ,
        se: row.fcSE ?? null,
        ...(reps.length ? { reps } : null)
      }
    })
  }
  if (r?.kind === 'standardize')
    return r.std.rows.map((row) => {
      const value = row.value != null && row.value > 0 ? Math.log10(row.value) : null
      return {
        uniqID: row.uniqID,
        cell: row.cell,
        cmpd: row.cmpd,
        dose: row.dose,
        time: row.time,
        ...(row.extra ? { extra: row.extra } : null),
        value,
        ...(value != null ? { reps: [value] } : null)
      }
    })
  return []
}

/** Can this result be a side of a paired contrast? */
export const isPairable = (r: NodeResult | undefined): boolean =>
  r?.kind === 'compare' || r?.kind === 'standardize'

/** Which two of the wired inputs form dataset A (y) and B (x): the configured pick when both are
 *  still wired, else the first two edges in order. */
export function pairSides(cfg: ContrastConfig, upstreamIds: string[]): [string, string] | null {
  if (upstreamIds.length < 2) return null
  const a = cfg.pairA && upstreamIds.includes(cfg.pairA) ? cfg.pairA : undefined
  const b = cfg.pairB && upstreamIds.includes(cfg.pairB) && cfg.pairB !== a ? cfg.pairB : undefined
  const rest = upstreamIds.filter((u) => u !== a && u !== b)
  return [a ?? rest.shift()!, b ?? rest.shift()!]
}

/** Intra-dataset mode: which wired input the two groups are selected from — the configured pick
 *  while still wired, else the first edge. */
export function selectSource(cfg: ContrastConfig, upstreamIds: string[]): string | undefined {
  if (cfg.selectFrom && upstreamIds.includes(cfg.selectFrom)) return cfg.selectFrom
  return upstreamIds[0]
}

/** The wired inputs the tile actually consumes in its current mode — the rest are wired but idle
 *  (drawn dashed on the canvas). */
export function usedInputs(cfg: ContrastConfig, upstreamIds: string[]): Set<string> {
  if (resolveContrastSource(cfg, upstreamIds.length) === 'pair') {
    const s = pairSides(cfg, upstreamIds)
    return new Set(s ?? [])
  }
  const one = selectSource(cfg, upstreamIds)
  return new Set(one ? [one] : [])
}

/** A result's rows in the shape the group selector reads (uniqID + conditions), plus which
 *  conditions carry values. Compare rows are one per gene × comparison context; Standardize rows
 *  one per gene × sample. */
export function selectorRowsOf(r: NodeResult | undefined): {
  rows: StandardRow[]
  present: ConditionKey[]
} {
  const raw: Array<Record<string, unknown>> =
    r?.kind === 'compare'
      ? r.cmp.rows.map((x) => ({
          uniqID: x.uniqID,
          cell: x.cell ?? '',
          cmpd: x.cmpd,
          dose: x.dose,
          time: x.time,
          ...(x.extra ? { extra: x.extra } : null)
        }))
      : r?.kind === 'standardize'
        ? r.std.rows.map((x) => ({
            uniqID: x.uniqID,
            cell: x.cell,
            cmpd: x.cmpd,
            dose: x.dose,
            time: x.time,
            ...(x.extra ? { extra: x.extra } : null)
          }))
        : []
  const rows = raw as unknown as StandardRow[]
  const present = condsIn(rows).filter((c) => condPresent(rows, c))
  return { rows, present }
}
