/**
 * The units of numeric conditions: molar and time units, free-text units, and the axis titles and
 * scales they give.
 */
import { type ConditionKey, condLabel, type CustomConditionKey, isCustomCond } from '../../engine'
import { type GraphNode, isStep } from '../types'
import type { LoadConfig } from './load'
import type { CompareConfig } from './compare'

/** The molar units the app knows, with their size in molar. A unit is free text (CondUnits); one
 *  of these only puts a log axis's pEC50 in molar — pEC50 (M), whatever the doses were given in. */
export const DOSE_UNITS = { M: 1, mM: 1e-3, µM: 1e-6, nM: 1e-9, pM: 1e-12 } as const
export type DoseUnit = keyof typeof DOSE_UNITS
const MOLAR_UNITS: Record<string, number> = {
  ...DOSE_UNITS,
  // micro typed as the Greek mu or a u; femtomolar
  μM: 1e-6,
  uM: 1e-6,
  fM: 1e-15
}
/** Common time units — suggestions only, as DOSE_UNIT_SUGGESTIONS. */
export const TIME_UNITS = ['s', 'min', 'h', 'd', 'wk'] as const
export type TimeUnit = (typeof TIME_UNITS)[number]

/** Arbitrary units: a numeric condition's values carry no physical unit (a dose then has no molar
 *  scale, so a curve's EC50 gets no pEC50 in molar). Picked explicitly at import, like a unit. */
export const AU = 'a.u.'
export type ArbitraryUnit = typeof AU

/** What the unit boxes offer as you type (any other text is a unit too). */
export const DOSE_UNIT_SUGGESTIONS: readonly string[] = [
  AU,
  ...Object.keys(DOSE_UNITS),
  'mg/mL',
  'µg/mL',
  '%',
  'X',
  'MIC'
]
export const TIME_UNIT_SUGGESTIONS: readonly string[] = [AU, ...TIME_UNITS]

/** The units of the numeric conditions, as named at import, keyed by condition: free text (nM,
 *  mg/mL, MIC, %, h, …) — labels, except that a molar unit puts a log axis's pEC50 in molar
 *  (isMolar). a.u. = none. Absent = not named yet (the import asks for one before it goes on; an
 *  older project shows it unitless, like a.u.). */
export type CondUnits = {
  dose?: string
  time?: string
} & { [K in CustomConditionKey]?: string }

/** A condition's unit, if it has one (only numeric conditions do). */
export function unitOf(units: CondUnits | undefined, c: ConditionKey): string | undefined {
  if (!units) return undefined
  if (c === 'dose' || c === 'time') return units[c]
  return isCustomCond(c) ? units[c] : undefined
}

/** Whether a unit is a molar one (M, mM, µM / μM / uM, nM, pM, fM), so a log axis's pEC50 is put in
 *  molar. */
export const isMolar = (u: string | undefined): boolean =>
  u != null && Object.prototype.hasOwnProperty.call(MOLAR_UNITS, u.trim())
/** A molar unit's size in molar (1 for any other unit). */
export const molarScale = (u: string | undefined): number =>
  u != null && isMolar(u) ? MOLAR_UNITS[u.trim()] : 1

/** The units the data feeding `id` was imported with: walks upstream (through every input of a
 *  Merge) to the Load tile(s); the first one to name a condition's unit wins it. */
export function condUnitsFor(
  g: { nodes: GraphNode[]; edges: { source: string; target: string }[] },
  id: string | undefined
): CondUnits {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  const queue = id ? [id] : []
  while (queue.length) {
    const cur = queue.shift()!
    if (seen.has(cur)) continue
    seen.add(cur)
    const n = g.nodes.find((x) => x.id === cur)
    if (n && isStep(n) && n.data.kind === 'load') {
      const u = (n.data.config as LoadConfig).units
      for (const [c, v] of Object.entries(u ?? {})) if (v) out[c] ??= v
      continue
    }
    for (const e of g.edges) if (e.target === cur) queue.push(e.source)
  }
  return out as CondUnits
}

/** A numeric axis's title with its unit: `dose (nM)`, or just `dose` when none is set. `axis` is a
 *  condition key (a custom one titled by its name). */
export function axisTitle(axis: string, units: CondUnits): string {
  const c = axis as ConditionKey
  const u = unitOf(units, c)
  return u ? `${condLabel(c)} (${u})` : condLabel(c)
}

/** A curve fit's axis unit and, when it is molar, its molar scale (for pEC50): the imported unit
 *  of its axis (a dose axis: else a legacy Compare-level one); none or a.u. = no molar scale. A
 *  unit that isn't molar (time's, a custom condition's) has scale 1 — its unit for the EC50's label
 *  only. */
export function curveDoseUnit(
  cfg: CompareConfig | undefined,
  units: CondUnits
): { unit?: string; scale: number; molar?: boolean } {
  if (!cfg || cfg.analysis !== 'curve_fit') return { scale: 1 }
  const axis = cfg.curveAxis ?? 'dose'
  const unit = unitOf(units, axis) ?? (axis === 'dose' ? cfg.doseUnit : undefined)
  if (!unit) return { scale: 1 }
  return isMolar(unit) ? { unit, scale: molarScale(unit), molar: true } : { unit, scale: 1 }
}

/** The axis a curve fit's curves run along, with its unit and molar scale — a one-axis curve's
 *  axis; a surface's response axis when testing changes, else its first (its dose curves): what a
 *  potency is read along (EC50 in its units; pEC50 when molar). curveDoseUnit stays the dose's. */
export function curveAxisUnit(
  cfg: CompareConfig | undefined,
  units: CondUnits
): { axis: ConditionKey; unit?: string; scale: number; molar?: boolean } {
  const pair = cfg?.surfacePair ?? ['dose', 'time']
  const axis: ConditionKey = !cfg
    ? 'dose'
    : cfg.surface
      ? cfg.surfaceIntent === 'changes' && cfg.responseAxis && pair.includes(cfg.responseAxis)
        ? cfg.responseAxis
        : pair[0]
      : (cfg.curveAxis ?? 'dose')
  const unit = unitOf(units, axis) ?? (axis === 'dose' ? cfg?.doseUnit : undefined)
  if (!unit) return { axis, scale: 1 }
  return isMolar(unit)
    ? { axis, unit, scale: molarScale(unit), molar: true }
    : { axis, unit, scale: 1 }
}
