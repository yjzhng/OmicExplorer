/**
 * The Curve fit window's model, apart from its UI. Four parts:
 *  - Model: the curve model, its axis (dose, time, or a dose × time surface) and a surface's fit.
 *  - Filter: each condition's values kept (the rest are gone from everything below).
 *  - Baseline: picked on the dose × time grid's header chips — a dose (its column: each time matched),
 *    a time (its row: each dose matched), or one dose and one time (that one position).
 *  - Context: every other condition, its values' curves left out by clicking their chips.
 * It compiles to the num / den / match / curveAxis / surface config the engine already runs
 * (store.ts → curveFit / responseSurface), and offers only the baselines the engine supports there;
 * the rest (pooled baselines, a time row on a dose axis, one position on a surface) are disabled with
 * the reason.
 */
import { condLabel, orderConds, type CondSelector, type ConditionKey, type StandardRow } from '../engine'
import { cv, valuesOf } from './compareModel'
import type { CurveAxisPick, CurveModel, SurfaceFit } from './curveSettings'

export interface CurveState {
  detection: CurveModel
  axis: CurveAxisPick
  surfaceFit: SurfaceFit
  /** each condition's values filtered out */
  filter: Partial<Record<ConditionKey, string[]>>
  /** each context condition's values whose curves are left out */
  drop: Partial<Record<ConditionKey, string[]>>
  /** the baseline's picked doses and times (see `baselineShape`) */
  bDose: string[]
  bTime: string[]
}

/** Why a baseline header chip can't be picked now (null: it can). */
export interface HeadChip {
  v: string
  on: boolean
  why: string | null
}

export interface CurveModelOut {
  conds: ConditionKey[]
  hasTime: boolean
  surface: boolean
  /** the curve's axis (a surface's is dose) */
  refAx: ConditionKey
  /** the samples left by the Filter */
  rows: StandardRow[]
  /** the grid: dose across, time down ([null] without time) */
  gx: string[]
  gy: Array<string | null>
  doseChips: HeadChip[]
  timeChips: HeadChip[]
  /** the picked baseline, per condition (absent: matched) */
  pin: Partial<Record<'dose' | 'time', string[]>>
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

/** The baseline the engine runs for each pick, and which picks it can't (yet): one dose (dose axis or
 *  surface) or one time (time axis), optionally with one of the other (one position — not on a surface). */
function chipWhy(
  c: 'dose' | 'time',
  v: string,
  s: { refAx: ConditionKey; surface: boolean; dose: string[]; time: string[] }
): string | null {
  const mine = c === 'dose' ? s.dose : s.time
  const theirs = c === 'dose' ? s.time : s.dose
  if (mine.includes(v)) return null
  const name = `${condLabel(c)} ${v}`
  if (mine.length) return `A pooled baseline (several ${condLabel(c)}s) isn't supported yet: clear ${condLabel(c)} ${mine[0]} first`
  const own = c === s.refAx
  if (own) return theirs.length > 1 ? `Several ${c === 'dose' ? 'times' : 'doses'} are picked` : null
  // the other condition: only as one position, with one of the axis' own picked
  if (s.surface) return `A surface starts from the baseline at each time: ${name} can't be the baseline`
  if (!theirs.length)
    return `A ${condLabel(c)} on its own isn't a baseline for a ${condLabel(s.refAx)} curve: pick a ${condLabel(s.refAx)} first (then ${name} makes one position)`
  return null
}

export function curveModel(state: CurveState, samples: readonly StandardRow[], active: readonly ConditionKey[]): CurveModelOut {
  const conds = orderConds(active).filter((c) => valuesOf(samples, c).length > 0)
  const outOf = (c: ConditionKey): Set<string> => new Set(state.filter[c] ?? [])
  const rows = samples.filter((r) => conds.every((c) => !outOf(c).has(cv(r, c) ?? '')))
  // An axis is one with more than one value left after the filter: filtered down to one, time is
  // just a context condition (no surface, no time curve, no time row on the grid).
  const hasTime = conds.includes('time') && valuesOf(rows, 'time').length > 1
  const surface = state.axis === 'surface' && hasTime && conds.includes('dose')
  const refAx: ConditionKey = surface ? 'dose' : state.axis === 'time' && hasTime ? 'time' : 'dose'
  const axisConds: ConditionKey[] = surface ? ['dose', 'time'] : [refAx]
  const gx = valuesOf(rows, 'dose')
  const gy: Array<string | null> = hasTime ? valuesOf(rows, 'time') : [null]

  const dose = state.bDose.filter((v) => gx.includes(v))
  const time = hasTime ? state.bTime.filter((v) => gy.includes(v)) : []
  const shape = { refAx, surface, dose, time }
  const doseChips = gx.map((v) => ({ v, on: dose.includes(v), why: chipWhy('dose', v, shape) }))
  const timeChips = hasTime ? (gy as string[]).map((v) => ({ v, on: time.includes(v), why: chipWhy('time', v, shape) })) : []
  // The picks the engine runs: the axis' own level, plus (not on a surface) one of the other.
  const ownPick = refAx === 'dose' ? dose : time
  const otherPick = refAx === 'dose' ? time : dose
  const picked = ownPick.length === 1 && otherPick.length <= 1 && !(surface && otherPick.length)
  const pin: CurveModelOut['pin'] = {}
  if (picked) {
    pin[refAx as 'dose' | 'time'] = ownPick
    if (otherPick.length) pin[refAx === 'dose' ? 'time' : 'dose'] = otherPick
  }
  const isBase = (r: StandardRow): boolean =>
    picked && (Object.entries(pin) as Array<['dose' | 'time', string[]]>).every(([c, vs]) => vs.includes(cv(r, c) ?? ''))

  // context: every condition but the axis — time beside a dose axis (a curve per time), dose beside a
  // time axis; a surface spans both
  const ctxConds: ConditionKey[] = conds.filter((c) => !axisConds.includes(c))
  const warnings: string[] = []
  if (!picked) warnings.push(`Pick the baseline: a ${condLabel(refAx)} on the grid.`)
  for (const c of conds) if (valuesOf(samples, c).every((v) => outOf(c).has(v))) warnings.push(`${condLabel(c)}: every value is filtered out.`)

  // ── compile ──
  const num: CondSelector = {}
  const den: CondSelector = {}
  if (picked) {
    // the curve's points: every axis level beyond the baseline's (the engine leaves levels ≤ 0 out)
    num[refAx] = valuesOf(rows, refAx).filter((v) => !ownPick.includes(v) && above0(v))
    for (const [c, vs] of Object.entries(pin)) den[c as ConditionKey] = vs
    const baseRows = rows.filter(isBase)
    for (const c of conds) {
      if (c === refAx) continue
      // pinned by the baseline (one position): its left-out values only drop curves
      if (pin[c as 'dose' | 'time']) {
        const drop = new Set(state.drop[c] ?? [])
        const kept = valuesOf(rows, c)
        if (drop.size || kept.length < valuesOf(samples, c).length) num[c] = kept.filter((v) => !drop.has(v))
        continue
      }
      // a surface's time: only a filter, on the curves (responseSurface applies it to both sides;
      // its baseline is each time's own)
      if (surface && c === 'time') {
        const kept = valuesOf(rows, 'time')
        if (kept.length < valuesOf(samples, 'time').length) num.time = kept
        continue
      }
      const all = valuesOf(samples, c)
      const kept = valuesOf(rows, c)
      const drop = new Set(ctxConds.includes(c) ? (state.drop[c] ?? []) : [])
      const numVals = kept.filter((v) => !drop.has(v))
      if (numVals.length < all.length) num[c] = numVals
      // the filter reaches the baseline too (a dropped context value only removes its curves)
      if (kept.length < all.length) {
        const baseVals = valuesOf(baseRows, c)
        if (baseVals.length) den[c] = baseVals
      }
    }
  }
  // matched: every other condition — except one the baseline pins (its one time serves every time)
  const match = conds.filter((c) => !axisConds.includes(c) && !pin[c as 'dose' | 'time'])
  return { conds, hasTime, surface, refAx, rows, gx, gy, doseChips, timeChips, pin, picked, isBase, ctxConds, num, den, match, warnings }
}

/** The Baseline line: where each curve starts and what it's matched on. `matched` / `invariant`
 *  come from the engine's preview (previewCompare) of the compiled config. */
export function baselineLine(
  m: CurveModelOut,
  baseRows: readonly StandardRow[],
  matched: readonly ConditionKey[]
): string {
  const at = (['dose', 'time'] as const).filter((c) => m.pin[c]).map((c) => `${condLabel(c)} ${m.pin[c]![0]}`)
  // a context condition the baseline holds one value of (DMSO is the only dose 0) is said
  const locked = m.ctxConds.find((c) => !m.pin[c as 'dose' | 'time'] && !matched.includes(c) && valuesOf(baseRows, c).length === 1 && valuesOf(m.rows, c).length > 1)
  const start = locked ? `${valuesOf(baseRows, locked)[0]}'s ${at.join(' at ')}, the only ${at[0]} in the data` : `its own ${at.join(' at ')}`
  // a surface is always matched per time (responseSurface), whatever the preview lists
  const per = [...new Set<ConditionKey>([...(m.surface && !m.pin.time ? ['time' as ConditionKey] : []), ...matched])].map(condLabel)
  return `each ${m.surface ? 'surface' : 'curve'} starts from ${start}${per.length ? `, matched per ${per.join(' per ')}` : ''}`
}

/** A fresh window's baseline: the axis' lowest level (dose 0's column; t₀'s row on a time axis). */
export function defaultBaseline(samples: readonly StandardRow[], refAx: ConditionKey): Pick<CurveState, 'bDose' | 'bTime'> {
  const lowest = valuesOf(samples, refAx)[0]
  return refAx === 'time' ? { bDose: [], bTime: lowest ? [lowest] : [] } : { bDose: lowest ? [lowest] : [], bTime: [] }
}

/**
 * A saved config as window state. One this window wrote pins the baseline's dose / time in `den`;
 * one saved before (`den` on a control compound: DMSO) reads as the dose / time those control
 * samples sit at. A condition pinned on the curves but not to every value reads as filtered when the
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
  },
  samples: readonly StandardRow[],
  active: readonly ConditionKey[],
  fresh: { axis: CurveAxisPick; detection: CurveModel }
): CurveState {
  const num = cfg.num ?? {}
  const den = cfg.den ?? {}
  const pinnedAny = (s: CondSelector): boolean => Object.values(s).some((v) => v && v.length > 0)
  const configured = pinnedAny(num) && pinnedAny(den)
  const axis: CurveAxisPick = configured ? (cfg.surface ? 'surface' : cfg.curveAxis === 'time' ? 'time' : 'dose') : fresh.axis
  const refAx: ConditionKey = axis === 'time' ? 'time' : 'dose'
  const base: CurveState = {
    detection: cfg.detection ?? fresh.detection,
    axis,
    surfaceFit: cfg.surfaceDescription ?? 'slices',
    filter: {},
    drop: {},
    ...defaultBaseline(samples, refAx)
  }
  if (!configured) return base
  const sel = (s: CondSelector) => (r: StandardRow): boolean =>
    active.every((c) => !s[c]?.length || s[c]!.includes(cv(r, c) ?? ''))
  const denRows = samples.filter(sel(den))
  const levelOf = (c: 'dose' | 'time'): string[] =>
    den[c]?.length ? [...den[c]!] : valuesOf(denRows, c).length === 1 ? valuesOf(denRows, c) : []
  base.bDose = levelOf('dose')
  base.bTime = active.includes('time') ? levelOf('time') : []
  // a matched time (each time its own baseline) isn't a pick
  if (refAx === 'dose' && !den.time?.length) base.bTime = []
  if (refAx === 'time' && !den.dose?.length) base.bDose = []
  for (const c of active) {
    if (c === refAx || (axis === 'surface' && (c === 'dose' || c === 'time'))) continue
    const all = valuesOf(samples, c)
    const n = num[c]
    if (!n?.length || n.length === all.length) continue
    // a value with no treated samples (DMSO only at dose 0) was never a curve: not left out
    const treatedVals = new Set(valuesOf(samples.filter((r) => Number(cv(r, refAx)) > 0), c))
    const out = all.filter((v) => !n.includes(v) && treatedVals.has(v))
    if (!out.length) continue
    // pinned alike on the baseline (or the baseline lacks those values anyway): a filter
    const d = den[c]
    if (d?.length && d.every((v) => n.includes(v))) base.filter[c] = out
    else base.drop[c] = out
  }
  return base
}
