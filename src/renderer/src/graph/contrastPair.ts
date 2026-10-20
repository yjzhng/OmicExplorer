/** Contrast-input helpers shared by the run path (store), the selector window, and the canvas. */
import {
  condLabel,
  condValue,
  condPresent,
  condsIn,
  CURVE_FC_FEATURE,
  curveDescribed,
  customSlug,
  isCustomCond,
  replicateLog2FCs,
  stdByGene,
  termless,
  xUnits,
  type CompareResultRow,
  type CondSelector,
  type ConditionKey,
  type ContrastFeatureId,
  type ContrastSideRow,
  type StandardRow
} from '../engine'
import {
  isMolar,
  resolveContrastSource,
  unitOf,
  type CondUnits,
  type ContrastConfig,
  type NodeResult
} from './types'

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
const curveAxisOf = (r: CompareResultRow): ConditionKey | null =>
  r.curve?.axis ?? (r.rs && r.rs.axis !== 'surface' ? r.rs.axis : null)

/** A curve fit's row on a linear axis (see axisModel.ts): its potency is EC50, not pEC50. */
const isLinearRow = (r: CompareResultRow): boolean =>
  r.curve?.scale === 'linear' || r.rs?.scale === 'linear'

/** A dose × time surface's row (the response surface method over dose × time): one gene, every
 *  dose and time at once. */
export const isSurfaceRow = (r: CompareResultRow): boolean => r.rs?.axis === 'surface'

/** How a surface is contrasted slice by slice: along the axis its curves run along — testing
 *  response changes, the response axis; else its first (its dose curves) — one slice per level of
 *  the other axis, `at`, the condition its side rows carry and the run matches the sides on. */
export function surfaceSlicing(r: CompareResultRow): {
  k: 0 | 1
  along: ConditionKey
  at: ConditionKey
} {
  const pair = r.rs?.pair ?? (['dose', 'time'] as [ConditionKey, ConditionKey])
  const k: 0 | 1 = r.rs?.shift && r.rs.shift.response === pair[1] ? 1 : 0
  return { k, along: pair[k], at: pair[1 - k] }
}

/** The condition a set of rows' surfaces are contrasted per level of (surfaceSlicing), if any. */
export const surfaceSliceCond = (rows: readonly CompareResultRow[]): ConditionKey | undefined => {
  const r = rows.find(isSurfaceRow)
  return r ? surfaceSlicing(r).at : undefined
}

/** A side row's condition set to a level: a preset's column, a custom one's `extra` text. */
function withCond(row: ContrastSideRow, c: ConditionKey, v: number): ContrastSideRow {
  if (isCustomCond(c)) return { ...row, extra: { ...row.extra, [customSlug(c)]: String(v) } }
  return { ...row, [c]: v }
}

/** A surface's row as one side row per slice, for one feature — a surface has no single fold change
 *  or EC50, so it's contrasted slice by slice (the run matches the sides on the slice's level):
 *  - its fold change: at each level, the fit's largest effect along the curve, signed — against the
 *    vehicle (capturing the shape), or, testing response changes, against the reference curve (the
 *    base level's, so what every level shares — a melt — isn't counted);
 *  - its pEC50: that level's curve's midpoint (the description's slices) — EC50 itself on a linear
 *    axis — for the genes the Curve fit described. */
export function surfaceSideRows(
  r: CompareResultRow,
  f: ContrastFeatureId,
  ctx: CompareFeatureCtx
): ContrastSideRow[] {
  const { k, at } = surfaceSlicing(r)
  const base: ContrastSideRow = {
    uniqID: r.uniqID,
    cell: r.cell ?? null,
    cmpd: r.cmpd,
    dose: null,
    time: null,
    ...(r.extra ? { extra: r.extra } : null),
    value: null,
    signf: r.signf,
    effect: r.effect,
    pP: r.pP,
    pQ: r.pQ
  }
  const rs = r.rs
  if (f === 'pec50') {
    const slices = (k === 1 ? rs?.surface?.byDose : rs?.surface?.byTime) ?? []
    const linear = rs?.maps?.[k]?.scale === 'linear'
    // the molar scale is the dose's (the first axis's unit) — any other axis in its own units
    const scale = k === 0 ? ctx.doseScale : 1
    return slices.map((sl) => {
      const v = linear ? sl.mid : sl.mid > 0 ? -Math.log10(sl.mid * scale) : NaN
      return withCond({ ...base, value: Number.isFinite(v) ? v : null }, at, sl.at)
    })
  }
  // a cell's level along the curve and of its slice (the cells' two slots)
  const along = (c: { dose: number; time: number }): number => (k === 1 ? c.time : c.dose)
  const level = (c: { dose: number; time: number }): number => (k === 1 ? c.dose : c.time)
  const cells = rs?.cells ?? []
  // testing changes: the reference curve — the fit along the curve at the compared axis's control
  // level as the Curve fit set it (the lowest on a result from before it was kept)
  const ref = new Map<number, number>()
  if (rs?.shift && cells.length) {
    const ctl = rs.maps?.[1 - k]?.base
    const lo = cells.some((c) => level(c) === ctl) ? ctl! : Math.min(...cells.map(level))
    for (const c of cells) if (level(c) === lo) ref.set(along(c), c.fitted)
  }
  const peak = new Map<number, number>()
  for (const c of cells) {
    const e = rs?.shift ? c.fitted - (ref.get(along(c)) ?? NaN) : c.fitted
    const cur = peak.get(level(c))
    if (Number.isFinite(e) && (cur === undefined || Math.abs(e) > Math.abs(cur)))
      peak.set(level(c), e)
  }
  return [...peak]
    .sort((a, b) => a[0] - b[0])
    .map(([lv, value]) => withCond({ ...base, value }, at, lv))
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
    // it; pEC50 = −log₁₀ EC50 (in molar where the axis's unit is molar: ctx.doseScale, from
    // curveDoseUnit — 1 for any other unit). On a linear axis the EC50 itself.
    const axis = curveAxisOf(r)
    // (an undescribed 4PL curve — responders only, not one — has none)
    const ec50 = r.curve
      ? curveDescribed(r.curve)
        ? xUnits(r.curve, -r.curve.pec50)
        : undefined
      : r.rs?.desc?.mid
    if (isLinearRow(r)) return axis && ec50 != null && Number.isFinite(ec50) ? ec50 : null
    if (!axis || ec50 == null || !(ec50 > 0)) return null
    const v = -Math.log10(ec50 * ctx.doseScale)
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

/** A curve fit's potency feature, named with its unit: EC50 in the axis's unit on a linear axis;
 *  pEC50 on a log one — −log₁₀ molar where the unit is molar (as compareFeatureValue reads it),
 *  else of the unit. Without a unit, named by its axis (unless that's dose). */
function potencyLabel(linear: boolean, axis: ConditionKey, units: CondUnits | undefined): string {
  const unit = unitOf(units, axis)
  const what = linear ? 'EC50' : 'pEC50'
  if (unit)
    return linear ? `EC50 (${unit})` : isMolar(unit) ? 'pEC50 (M)' : `pEC50 (−log₁₀ ${unit})`
  return axis === 'dose' ? what : `${what} (${condLabel(axis)})`
}

/** The features a Contrast of this input can switch between, in switcher order (the sides' own
 *  value first). Clean data: abundance, SD, CV. A Compare: log₂FC and its significance (p or q, as
 *  it calls by). A curve fit: its curve fold change — the peak, by the response surface method;
 *  the shift from the reference curve, testing changes — and its potency, where any curve has one
 *  (named with its unit: `units`, the input's condition units). */
export function contrastFeatures(r: NodeResult | undefined, units?: CondUnits): ContrastFeature[] {
  if (r?.kind === 'standardize')
    return [
      { id: 'value', label: 'abundance' },
      { id: 'sd', label: 'SD' },
      { id: 'cv', label: 'CV %' }
    ]
  if (r?.kind !== 'compare') return []
  const rows = termless(r.cmp.rows)
  const axes = new Set(rows.map(curveAxisOf).filter((a) => a != null))
  // Surfaces: both per slice (see surfaceSideRows) — the potency where any gene's curves along
  // their axis were described: EC50 on a linear axis, pEC50 on a log one, named with its unit.
  if (rows.some(isSurfaceRow)) {
    // one value per slice (the switcher picks it): the largest effect along that slice's curve —
    // against the vehicle, or testing changes, the shift from the reference curve
    const fc: ContrastFeature = { id: 'value', label: CURVE_FC_FEATURE }
    const r0 = rows.find(
      (x) =>
        isSurfaceRow(x) &&
        (surfaceSlicing(x).k === 1 ? x.rs?.surface?.byDose : x.rs?.surface?.byTime)?.length
    )
    if (!r0) return [fc]
    const { k, along } = surfaceSlicing(r0)
    const linear = r0.rs?.maps?.[k]?.scale === 'linear'
    return [fc, { id: 'pec50', label: potencyLabel(linear, along, units) }]
  }
  if (rows.some((x) => x.curve || x.rs)) {
    const fc: ContrastFeature = { id: 'value', label: CURVE_FC_FEATURE }
    if (!axes.size) return [fc]
    // the potency: pEC50 on a log axis, EC50 on a linear one (see axisModel.ts)
    const axis = [...axes][0]
    return [fc, { id: 'pec50', label: potencyLabel(rows.some(isLinearRow), axis, units) }]
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
  /** the run: a surface's rows per slice (surfaceSideRows); the selector's preview keeps one per
   *  gene */
  surfacesPerSlice = false
): ContrastSideRow[] {
  if (r?.kind === 'compare' && surfacesPerSlice && cmpRows(r).some(isSurfaceRow))
    return cmpRows(r).flatMap((row) =>
      isSurfaceRow(row) ? surfaceSideRows(row, feature, ctx) : []
    )
  if (r?.kind === 'compare' && feature !== 'value')
    // Another feature of the same rows: its value alone (no SE or replicates — those are the fold
    // change's), the side's own calls kept for the divergence mask.
    return cmpRows(r).map((row) => ({
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
    return cmpRows(r).map((row) => {
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

/**
 * A Contrast's two sides as Curve fit curves over `axis`, when both are: each side's curve rows,
 * renamed to the side (`names` — the contrast's own, its cmp1 / cmp2) so a plot tells them apart.
 * Pair mode: the two inputs' results (each a Curve fit). Select mode: the one input's rows each
 * side's selection picks (compound A vs B of one fit). Null when a side isn't curves over `axis`
 * (a t-test, Clean data, a surface) — the plot then draws the contrast's own per-level values.
 */
export function contrastCurveSides(
  cfg: ContrastConfig,
  upstreamIds: string[],
  results: Record<string, NodeResult | undefined>,
  axis: ConditionKey,
  names: [string, string]
): [CompareResultRow[], CompareResultRow[]] | null {
  const curvesOf = (r: NodeResult | undefined): CompareResultRow[] | null => {
    if (r?.kind !== 'compare') return null
    const rows = r.cmp.rows.filter((x) => curveAxisOf(x) === axis)
    return rows.length ? rows : null
  }
  const named = (rows: CompareResultRow[], name: string): CompareResultRow[] =>
    rows.map((x) => ({ ...x, comparison: name }))
  if (resolveContrastSource(cfg, upstreamIds.length) === 'pair') {
    const sides = pairSides(cfg, upstreamIds)
    if (!sides) return null
    const a = curvesOf(results[sides[0]])
    const b = curvesOf(results[sides[1]])
    return a && b ? [named(a, names[0]), named(b, names[1])] : null
  }
  const from = selectSource(cfg, upstreamIds)
  const all = from ? curvesOf(results[from]) : null
  if (!all || !cfg.num || !cfg.den) return null
  // a row in a selection: every condition it pins takes one of its values
  const pick = (sel: CondSelector): CompareResultRow[] =>
    all.filter((x) =>
      (Object.entries(sel) as Array<[ConditionKey, string[] | undefined]>).every(
        ([c, vs]) => !vs?.length || vs.some((v) => String(condValue(x, c) ?? '') === String(v))
      )
    )
  const a = pick(cfg.num)
  const b = pick(cfg.den)
  return a.length && b.length ? [named(a, names[0]), named(b, names[1])] : null
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

/** A Compare's rows a Contrast side reads: those with a signed fold change (a two-way ANOVA's
 *  term rows are unsigned — see termless). */
const cmpRows = (r: Extract<NodeResult, { kind: 'compare' }>): CompareResultRow[] =>
  termless(r.cmp.rows)

/** A result's rows in the shape the group selector reads (uniqID + conditions), plus which
 *  conditions carry values. Compare rows are one per gene × comparison context; Standardize rows
 *  one per gene × sample. */
export function selectorRowsOf(r: NodeResult | undefined): {
  rows: StandardRow[]
  present: ConditionKey[]
} {
  const raw: Array<Record<string, unknown>> =
    r?.kind === 'compare'
      ? termless(r.cmp.rows).map((x) => ({
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
