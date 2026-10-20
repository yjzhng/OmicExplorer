/**
 * The Curve fit window's model, apart from its UI. Four parts:
 *  - Model: the curve model, its axis (any numeric condition, or a dose × time surface), a
 *    surface's fit, and what the baseline is to the curve: a control off it (the vehicle) or its own
 *    first point (t₀, the lowest temperature: "ratio to the lowest level").
 *  - Filter: each condition's values kept (the rest are gone from everything below).
 *  - Baseline: picked on a grid of the curve's axis and its partner (another numeric condition that
 *    varies — time beside dose, dose beside time, or the next one), by their header chips: a level of
 *    the axis (each level of the partner matched), or that and one level of the partner (that one
 *    position). Without a partner, a row of the axis's chips.
 *  - Context: every other condition, its values' curves left out by clicking their chips.
 * It compiles to the num / den / match / curveAxis / surface config the engine already runs
 * (store.ts → curveFit / responseSurface), and offers only the baselines the engine supports there;
 * the rest (pooled baselines, a partner level on its own, one position on a surface) are disabled
 * with the reason.
 */
import {
  condLabel,
  detectAxisScale,
  isNumericCond,
  orderConds,
  presetModel,
  type AxisBaseline,
  type AxisFit,
  type AxisScale,
  type CondSelector,
  type NumericConds,
  type ConditionKey,
  type ScaleGuess,
  type StandardRow
} from '../engine'
import { cv, valuesOf } from './compareModel'
import type { CurveAxisPick, CurveModel, SurfaceFit, SurfaceIntent } from './curveSettings'

export interface CurveState {
  detection: CurveModel
  axis: CurveAxisPick
  /** a surface: capture its shape or test its changes */
  intent: SurfaceIntent
  /** testing changes: the axis the curves run along, as the user set it (absent: the default) */
  responseAxis?: ConditionKey
  /** each condition's values filtered out */
  filter: Partial<Record<ConditionKey, string[]>>
  /** each context condition's values whose curves are left out */
  drop: Partial<Record<ConditionKey, string[]>>
  /** the baseline's picked levels, per condition — the curve's axis and its partner (see
   *  `baselineShape`) */
  base: Partial<Record<ConditionKey, string[]>>
  /** each axis's scale as the user set it (absent: the detected one — scaleOf) */
  scales?: Partial<Record<ConditionKey, AxisScale>>
  /** each axis's baseline kind as the user set it (absent: its preset's — baselineOf) */
  baselines?: Partial<Record<ConditionKey, AxisBaseline>>
  /** a surface's two conditions (absent: dose × time) */
  pair?: [ConditionKey, ConditionKey]
  /** each axis's models as the user set them (absent: the method's — graph/axisFits.ts) */
  fits?: Partial<Record<ConditionKey, AxisFit>>
}

/** Why a baseline header chip can't be picked now (null: it can). */
export interface HeadChip {
  v: string
  on: boolean
  why: string | null
}

export interface CurveModelOut {
  conds: ConditionKey[]
  surface: boolean
  /** the axes the fit runs over: the curve's one, or the surface's two (first, second) */
  axisConds: ConditionKey[]
  /** the curve's axis (a surface's first) */
  refAx: ConditionKey
  /** the grid's other numeric condition (a surface's second); null: none varies */
  partner: ConditionKey | null
  /** the samples left by the Filter */
  rows: StandardRow[]
  /** the grid: `xCond` across, `yCond` down (the two in hierarchy order; [null] without a partner) */
  xCond: ConditionKey
  yCond: ConditionKey | null
  gx: string[]
  gy: Array<string | null>
  xChips: HeadChip[]
  yChips: HeadChip[]
  /** the picked baseline, per condition (absent: matched) */
  pin: Partial<Record<ConditionKey, string[]>>
  /** the curve axis's scale (the user's, else detected from its kept levels, else its preset's)
   *  and what the detection saw — a surface is log on both axes whatever these say */
  scale: AxisScale
  scaleGuess: ScaleGuess
  /** what the baseline is to the curve: a control off it ('reference') or its own first point
   *  ('matched') — the user's, else the axis's preset; a surface's is the presets' */
  baseline: AxisBaseline
  /** the dataset's numeric conditions (its schema), as the model was built with */
  numeric: NumericConds
  /** some baseline is picked */
  picked: boolean
  /** whether a sample is the baseline */
  isBase: (r: StandardRow) => boolean
  /** the other conditions (cell, cmpd, …) */
  ctxConds: ConditionKey[]
  num: CondSelector
  den: CondSelector
  match: ConditionKey[]
  warnings: string[]
}

const numericLevel = (v: string | null): number => Number(v)
const above0 = (v: string): boolean => numericLevel(v) > 0
/** A level that is treated on this scale: above 0 on a log axis, any but 0 on a linear one. */
const treatedOn = (scale: AxisScale, v: string | null): boolean =>
  v != null &&
  v !== '' &&
  Number.isFinite(Number(v)) &&
  (scale === 'log' ? above0(v) : Number(v) !== 0)

/** A curve axis's scale from its levels (detectAxisScale), the user's pick overriding it, and
 *  linear when it can't tell — what the Curve fit runs (see axisModelFor). */
export function scaleOf(
  levels: readonly string[],
  set: AxisScale | undefined
): { scale: AxisScale; guess: ScaleGuess } {
  const guess = detectAxisScale(levels.map(Number).filter(Number.isFinite))
  return { scale: set ?? guess.scale ?? 'linear', guess }
}

/** A curve axis's baseline kind: the user's pick, else its preset's (dose a control, time its own
 *  first point, any other a control). */
export const baselineOf = (axis: ConditionKey, set: AxisBaseline | undefined): AxisBaseline =>
  set ?? presetModel(axis).baseline

/** A surface's pair as picked (absent: dose × time). */
export const pairOf = (state: Pick<CurveState, 'pair'>): [ConditionKey, ConditionKey] =>
  state.pair ?? ['dose', 'time']
/** The axis a pick makes the curve run over (a surface's first). */
export const refAxisOf = (
  axis: CurveAxisPick,
  pair?: [ConditionKey, ConditionKey]
): ConditionKey => (axis === 'surface' ? (pair ?? ['dose', 'time'])[0] : axis)

/** The grid's partner for a curve over `refAx`: the numeric condition left varying beside it —
 *  time first (the usual matched condition), then dose, then the rest in order. */
function partnerOf(
  refAx: ConditionKey,
  conds: readonly ConditionKey[],
  rows: readonly StandardRow[],
  numeric: NumericConds
): ConditionKey | null {
  const varies = (c: ConditionKey): boolean =>
    c !== refAx &&
    conds.includes(c) &&
    isNumericCond(c, numeric) &&
    valuesOf(rows, c, numeric).length > 1
  const order: ConditionKey[] = [
    'time',
    'dose',
    ...conds.filter((c) => c !== 'time' && c !== 'dose')
  ]
  return order.find(varies) ?? null
}

/** The baseline the engine runs for each pick, and which picks it can't (yet): one level of the
 *  curve's axis, optionally with one of its partner (one position — not on a surface). */
function chipWhy(
  c: ConditionKey,
  v: string,
  s: {
    refAx: ConditionKey
    partner: ConditionKey | null
    surface: boolean
    pick: Partial<Record<ConditionKey, string[]>>
  }
): string | null {
  const other = c === s.refAx ? s.partner : s.refAx
  const mine = s.pick[c] ?? []
  const theirs = other ? (s.pick[other] ?? []) : []
  if (mine.includes(v)) return null
  const name = `${condLabel(c)} ${v}`
  if (mine.length)
    return `A pooled baseline (several ${condLabel(c)} levels) isn't supported yet: clear ${condLabel(c)} ${mine[0]} first`
  if (c === s.refAx)
    return theirs.length > 1 && other ? `Several ${condLabel(other)} levels are picked` : null
  // the partner: only as one position, with one of the axis' own picked (on a surface: every
  // cell against that one position, instead of the baseline at each level of it)
  if (!theirs.length)
    return `A ${condLabel(c)} on its own isn't a baseline for a ${condLabel(s.refAx)} curve: pick a ${condLabel(s.refAx)} first (then ${name} makes one position)`
  return null
}

export function curveModel(
  state: CurveState,
  samples: readonly StandardRow[],
  active: readonly ConditionKey[],
  numeric: NumericConds
): CurveModelOut {
  const conds = orderConds(active).filter((c) => valuesOf(samples, c, numeric).length > 0)
  const outOf = (c: ConditionKey): Set<string> => new Set(state.filter[c] ?? [])
  const rows = samples.filter((r) => conds.every((c) => !outOf(c).has(cv(r, c) ?? '')))
  // A surface's axes must both vary after the filter: filtered down to one value, the second is just
  // a context condition (no surface, no row on the grid). So is a partner.
  const pair = pairOf(state)
  const varies = (c: ConditionKey): boolean =>
    conds.includes(c) && valuesOf(rows, c, numeric).length > 1
  const surface = state.axis === 'surface' && varies(pair[0]) && varies(pair[1])
  const picked0 = refAxisOf(state.axis, pair)
  // an axis no longer in the data (filtered out, a saved pick) falls back to dose
  const refAx: ConditionKey = surface
    ? pair[0]
    : conds.includes(picked0) && valuesOf(rows, picked0, numeric).length > 0
      ? picked0
      : 'dose'
  const partner = surface ? pair[1] : partnerOf(refAx, conds, rows, numeric)
  const axisConds: ConditionKey[] = surface ? [...pair] : [refAx]
  // across and down in hierarchy order (dose across, time down)
  const [xCond, yCond] = partner
    ? (orderConds([refAx, partner]) as [ConditionKey, ConditionKey])
    : [refAx, null]
  const gx = valuesOf(rows, xCond, numeric)
  const gy: Array<string | null> = yCond ? valuesOf(rows, yCond, numeric) : [null]
  const { scale, guess: scaleGuess } = scaleOf(
    valuesOf(rows, refAx, numeric),
    state.scales?.[refAx]
  )
  const baseline: AxisBaseline = baselineOf(refAx, state.baselines?.[refAx])
  const treated = (v: string): boolean => treatedOn(scale, v)

  const pick: Partial<Record<ConditionKey, string[]>> = {}
  const own = (state.base[refAx] ?? []).filter((v) => valuesOf(rows, refAx, numeric).includes(v))
  if (own.length) pick[refAx] = own
  if (partner) {
    const p = (state.base[partner] ?? []).filter((v) =>
      valuesOf(rows, partner, numeric).includes(v)
    )
    if (p.length) pick[partner] = p
  }
  const shape = { refAx, partner, surface, pick }
  const chipsOf = (c: ConditionKey, vs: Array<string | null>): HeadChip[] =>
    (vs.filter((v) => v != null) as string[]).map((v) => ({
      v,
      on: (pick[c] ?? []).includes(v),
      why: chipWhy(c, v, shape)
    }))
  const xChips = chipsOf(xCond, gx)
  const yChips = yCond ? chipsOf(yCond, gy) : []
  // The picks the engine runs: the axis' own level, plus (not on a surface) one of the partner.
  const ownPick = pick[refAx] ?? []
  const otherPick = partner ? (pick[partner] ?? []) : []
  const picked = ownPick.length === 1 && otherPick.length <= 1
  const pin: CurveModelOut['pin'] = {}
  if (picked) {
    pin[refAx] = ownPick
    if (otherPick.length && partner) pin[partner] = otherPick
  }
  const isBase = (r: StandardRow): boolean =>
    picked &&
    (Object.entries(pin) as Array<[ConditionKey, string[]]>).every(([c, vs]) =>
      vs.includes(cv(r, c) ?? '')
    )

  // context: every condition but the axis — the partner too (a curve per time beside a dose axis);
  // a surface spans both
  const ctxConds: ConditionKey[] = conds.filter((c) => !axisConds.includes(c))
  const warnings: string[] = []
  if (!picked) warnings.push(`Pick the baseline: a ${condLabel(refAx)} on the grid.`)
  for (const c of conds)
    if (valuesOf(samples, c, numeric).every((v) => outOf(c).has(v)))
      warnings.push(`${condLabel(c)}: every value is filtered out.`)

  // ── compile ──
  const num: CondSelector = {}
  const den: CondSelector = {}
  if (picked) {
    // the curve's points: every treated axis level beyond the baseline's (the engine leaves the
    // rest out: ≤ 0 on a log axis, 0 on a linear one)
    num[refAx] = valuesOf(rows, refAx, numeric).filter((v) => !ownPick.includes(v) && treated(v))
    for (const [c, vs] of Object.entries(pin)) den[c as ConditionKey] = vs
    const baseRows = rows.filter(isBase)
    for (const c of conds) {
      if (c === refAx) continue
      // pinned by the baseline (one position): its left-out values only drop curves
      if (pin[c]) {
        const drop = new Set(state.drop[c] ?? [])
        const kept = valuesOf(rows, c, numeric)
        if (drop.size || kept.length < valuesOf(samples, c, numeric).length)
          num[c] = kept.filter((v) => !drop.has(v))
        continue
      }
      // a surface's second axis: only a filter, on the curves (responseSurface applies it to both
      // sides; its baseline is each level's own)
      if (surface && c === partner) {
        const kept = valuesOf(rows, c, numeric)
        if (kept.length < valuesOf(samples, c, numeric).length) num[c] = kept
        continue
      }
      const all = valuesOf(samples, c, numeric)
      const kept = valuesOf(rows, c, numeric)
      const drop = new Set(ctxConds.includes(c) ? (state.drop[c] ?? []) : [])
      const numVals = kept.filter((v) => !drop.has(v))
      if (numVals.length < all.length) num[c] = numVals
      // the filter reaches the baseline too (a dropped context value only removes its curves)
      if (kept.length < all.length) {
        const baseVals = valuesOf(baseRows, c, numeric)
        if (baseVals.length) den[c] = baseVals
      }
    }
  }
  // matched: every other condition — except one the baseline pins (its one level serves every one)
  const match = conds.filter((c) => !axisConds.includes(c) && !pin[c])
  return {
    conds,
    surface,
    axisConds,
    refAx,
    partner,
    rows,
    xCond,
    yCond,
    gx,
    gy,
    xChips,
    yChips,
    pin,
    scale,
    scaleGuess,
    baseline,
    picked,
    isBase,
    ctxConds,
    num,
    den,
    match,
    warnings,
    numeric
  }
}

/** The Baseline line: where each curve starts and what it's matched on. `matched` / `invariant`
 *  come from the engine's preview (previewCompare) of the compiled config. */
export function baselineLine(
  m: CurveModelOut,
  baseRows: readonly StandardRow[],
  matched: readonly ConditionKey[]
): string {
  const { numeric } = m
  const at = [m.refAx, ...(m.partner ? [m.partner] : [])]
    .filter((c) => m.pin[c])
    .map((c) => `${condLabel(c)} ${m.pin[c]![0]}`)
  // a context condition the baseline holds one value of (DMSO is the only dose 0) is said
  const locked = m.ctxConds.find(
    (c) =>
      !m.pin[c] &&
      !matched.includes(c) &&
      valuesOf(baseRows, c, numeric).length === 1 &&
      valuesOf(m.rows, c, numeric).length > 1
  )
  const start = locked
    ? `${valuesOf(baseRows, locked, numeric)[0]}'s ${at.join(' at ')}, the only ${at[0]} in the data`
    : `its own ${at.join(' at ')}`
  // its own first point (t₀, the lowest temperature), or a control off the curve
  const kind = m.surface ? '' : m.baseline === 'matched' ? ' (its first point)' : ' (a control)'
  // a surface is always matched per level of its second axis (responseSurface), whatever the
  // preview lists
  const per = [
    ...new Set<ConditionKey>([
      ...(m.surface && m.partner && !m.pin[m.partner] ? [m.partner] : []),
      ...matched
    ])
  ].map(condLabel)
  return `each ${m.surface ? 'surface' : 'curve'} starts from ${start}${kind}${per.length ? `, matched per ${per.join(' per ')}` : ''}`
}

/** A fresh window's baseline: the axis' lowest level (dose 0; t₀ on a time axis; the lowest
 *  temperature). */
export function defaultBaseline(
  samples: readonly StandardRow[],
  refAx: ConditionKey,
  numeric: NumericConds
): Pick<CurveState, 'base'> {
  const lowest = valuesOf(samples, refAx, numeric)[0]
  return { base: lowest ? { [refAx]: [lowest] } : {} }
}

/**
 * A saved config as window state. One this window wrote pins the baseline's levels (the axis's,
 * and maybe its partner's) in `den`; one saved before (`den` on a control compound: DMSO) reads as
 * the axis level those control samples sit at. A condition pinned on the curves but not to every value reads as filtered when the
 * baseline is pinned alike, else as left out (its curves dropped).
 */
export function readCurveState(
  cfg: {
    num?: CondSelector
    den?: CondSelector
    curveAxis?: ConditionKey
    surface?: boolean
    detection?: CurveModel
    surfaceDescription?: SurfaceFit
    surfaceIntent?: SurfaceIntent
    responseAxis?: ConditionKey
    axisScale?: Partial<Record<ConditionKey, AxisScale>>
    axisBaseline?: Partial<Record<ConditionKey, AxisBaseline>>
    axisFits?: Partial<Record<ConditionKey, AxisFit>>
    surfacePair?: [ConditionKey, ConditionKey]
  },
  samples: readonly StandardRow[],
  active: readonly ConditionKey[],
  fresh: { axis: CurveAxisPick; detection: CurveModel },
  numeric: NumericConds
): CurveState {
  const num = cfg.num ?? {}
  const den = cfg.den ?? {}
  const pinnedAny = (s: CondSelector): boolean => Object.values(s).some((v) => v && v.length > 0)
  const configured = pinnedAny(num) && pinnedAny(den)
  const axis: CurveAxisPick = configured
    ? cfg.surface
      ? 'surface'
      : (cfg.curveAxis ?? 'dose')
    : fresh.axis
  const pair = cfg.surfacePair
  const refAx = refAxisOf(axis, pair)
  const base: CurveState = {
    detection: cfg.detection ?? fresh.detection,
    axis,
    intent: cfg.surfaceIntent ?? 'shape',
    ...(cfg.responseAxis ? { responseAxis: cfg.responseAxis } : null),
    filter: {},
    drop: {},
    scales: { ...cfg.axisScale },
    baselines: { ...cfg.axisBaseline },
    ...(pair ? { pair } : null),
    ...(cfg.axisFits ? { fits: { ...cfg.axisFits } } : null),
    ...defaultBaseline(samples, refAx, numeric)
  }
  if (!configured) return base
  const sel =
    (s: CondSelector) =>
    (r: StandardRow): boolean =>
      active.every((c) => !s[c]?.length || s[c]!.includes(cv(r, c) ?? ''))
  const denRows = samples.filter(sel(den))
  // the axis's level: pinned, else the one level the control samples sit at (DMSO at dose 0)
  const own = den[refAx]?.length
    ? [...den[refAx]!]
    : valuesOf(denRows, refAx, numeric).length === 1
      ? valuesOf(denRows, refAx, numeric)
      : []
  base.base = own.length ? { [refAx]: own } : {}
  // any other numeric condition pinned on the baseline: a partner level (one position) — one
  // matched (each level its own baseline) isn't a pick
  for (const c of active)
    if (c !== refAx && isNumericCond(c, numeric) && den[c]?.length) base.base[c] = [...den[c]!]
  for (const c of active) {
    if (c === refAx || (axis === 'surface' && (pair ?? ['dose', 'time']).includes(c))) continue
    const all = valuesOf(samples, c, numeric)
    const n = num[c]
    if (!n?.length || n.length === all.length) continue
    // a value with no treated samples (DMSO only at dose 0) was never a curve: not left out
    const { scale } = scaleOf(valuesOf(samples, refAx, numeric), cfg.axisScale?.[refAx])
    const treatedVals = new Set(
      valuesOf(
        samples.filter((r) => treatedOn(scale, cv(r, refAx))),
        c,
        numeric
      )
    )
    const out = all.filter((v) => !n.includes(v) && treatedVals.has(v))
    if (!out.length) continue
    // pinned alike on the baseline (or the baseline lacks those values anyway): a filter
    const d = den[c]
    if (d?.length && d.every((v) => n.includes(v))) base.filter[c] = out
    else base.drop[c] = out
  }
  return base
}
