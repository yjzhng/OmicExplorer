/** The selector window's two sides, read into a comparison (see SideRows): which conditions are
 *  compared and which are context, and the engine's num/den selectors and match set. Pure, so the
 *  window's reading can be tested — and a saved setup, read into picks, writes back unchanged. */
import { orderConds, type CondSelector, type ConditionKey } from '../engine'

export type SideKey = 'a' | 'b'
/** Per side, the values each condition is narrowed to (absent = every value). */
export type Picks = Partial<Record<ConditionKey, string[]>>

const sameSet = (x: string[], y: string[]): boolean =>
  x.length === y.length && x.every((v) => y.includes(v))

/** A saved selector as a side's picks (a pinned condition is its pick). */
export function picksOf(sel: CondSelector): Picks {
  const out: Picks = {}
  for (const [c, v] of Object.entries(sel) as [ConditionKey, string[] | undefined][])
    if (v && v.length) out[c] = v.map(String)
  return out
}

export interface SidesInput {
  picks: Record<SideKey, Picks>
  /** every value of each condition, in display order */
  values: Partial<Record<ConditionKey, string[]>>
  /** the conditions offered, in canonical order */
  ordered: ConditionKey[]
  /** context conditions switched to matched */
  matchOn: ConditionKey[]
  /** a curve fit: its axis conditions (dose, or dose and time for a surface), and the one whose
   *  levels the sides pick (dose for a surface) */
  curve?: { axes: ConditionKey[]; ref: ConditionKey; surface: boolean }
}

export interface Sides {
  /** conditions whose sides differ — what's compared (a curve's axis only when nothing else is) */
  compared: ConditionKey[]
  /** a curve's compared conditions, its axes aside */
  nonAxis: ConditionKey[]
  /** context conditions (neither compared nor a curve axis), and those of them matched */
  context: ConditionKey[]
  match: ConditionKey[]
  num: CondSelector
  den: CondSelector
}

export function readSides({ picks, values, ordered, matchOn, curve }: SidesInput): Sides {
  const pick = (s: SideKey, c: ConditionKey): string[] => {
    const p = picks[s][c]
    const vals = values[c] ?? []
    return p ? vals.filter((v) => p.includes(v)) : vals
  }
  const differs = (c: ConditionKey): boolean => !sameSet(pick('a', c), pick('b', c))
  const axes = curve?.axes ?? []
  const nonAxis = ordered.filter((c) => !axes.includes(c) && differs(c))
  const compared =
    curve && nonAxis.length === 0 && differs(curve.ref) ? [curve.ref] : orderConds(nonAxis)
  const context = ordered.filter((c) => !compared.includes(c) && !axes.includes(c))
  const match = context.filter((c) => matchOn.includes(c))
  // A side's pick, unless it's every value (then the side is free there). A surface's time is
  // never pinned: every time point runs against the control's own.
  const num: CondSelector = {}
  const den: CondSelector = {}
  for (const c of ordered) {
    if (curve?.surface && c === 'time') continue
    const all = values[c]?.length ?? 0
    const a = pick('a', c)
    const b = pick('b', c)
    if (a.length !== all) num[c] = a
    if (b.length !== all) den[c] = b
  }
  return { compared, nonAxis, context, match, num, den }
}
