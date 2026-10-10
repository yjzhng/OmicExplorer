/** The cluster view's complex-legend aesthetic plan — which condition drives which visual channel.
 *
 *  Kept apart from the view because it is the one piece of cluster logic with a real invariant to
 *  protect: shade and arrow are ORDERED channels, so only a numeric condition may drive them.
 */
import {
  customCondsIn,
  isNumericCond,
  orderConds,
  type ClusterMeta,
  type ConditionKey
} from '../engine'

/** Hierarchy order of the conditions these metas carry: cell → cmpd → dose → time, then any
 *  custom conditions. Custom conditions are ALWAYS categorical, so they can only ever join the
 *  qualitative side of the plan below — never the ordered shade or arrow channels. */
export const condsOf = (metas: ClusterMeta[]): ConditionKey[] =>
  orderConds(['cell', 'cmpd', 'dose', 'time', ...customCondsIn(metas)])

/**
 * Complex-legend aesthetic plan: which condition drives colour, which drives light→dark
 * shade, and which is connected by low→high arrows. Qualitative conditions (cell, cmpd and any
 * custom one) take colour; quantitative ones (dose, time) take shade then arrow. Channel hierarchy
 * is colour → shade → arrow; condition hierarchy is cell → cmpd → dose → time → customs.
 *
 * Shade and arrow are ORDERED channels (light→dark, low→high), so only a numeric condition may
 * drive them — a custom condition has no defined order and would make either channel a lie. Every
 * varying qualitative therefore lands on colour, however many there are: the first takes a hue
 * family and the rest spread within it (so each distinct combination still gets its own colour).
 */
export interface Plan {
  /** ≥2 varying qualitatives: `quals[0]` picks the hue family, the rest spread within it. */
  grouped: boolean
  /** the varying qualitatives, in hierarchy order (only meaningful when `grouped`) */
  quals: ConditionKey[]
  colorKey: ConditionKey | null // single-qualitative colour, or (colorRamp) the ramp key
  colorRamp: boolean // colorKey is a quantitative used as a sequential ramp (no qualitative present)
  shadeKey: ConditionKey | null
  arrowKey: ConditionKey | null
}

/** The user's channel choices (ClusterConfig.scheme*): colour's conditions in order, and shade /
 *  arrow as a numeric condition or 'none'. Unset = automatic. */
export interface PlanOverrides {
  color?: ConditionKey[]
  shade?: ConditionKey | 'none'
  arrow?: ConditionKey | 'none'
}

export function planAesthetics(
  varying: Set<ConditionKey>,
  conds: ConditionKey[],
  ov: PlanOverrides = {}
): Plan {
  if (ov.color?.length || ov.shade || ov.arrow) return planWithOverrides(varying, conds, ov)
  const Q = conds.filter((c) => varying.has(c) && !isNumericCond(c))
  const N = conds.filter((c) => varying.has(c) && isNumericCond(c))
  let grouped = false
  let colorKey: ConditionKey | null = null
  let colorRamp = false
  let shadeKey: ConditionKey | null = null
  let arrowKey: ConditionKey | null = null

  if (Q.length >= 2) grouped = true
  else if (Q.length === 1) colorKey = Q[0]
  else if (N.length >= 1) {
    colorKey = N[0]
    colorRamp = true
  }

  const freeQuant = colorRamp ? N.slice(1) : N
  if (grouped) {
    // Grouped colour consumes every qualitative; quantitatives fall to arrows (dose preferred),
    // an extra one to shade.
    if (freeQuant.length) {
      arrowKey = freeQuant.includes('dose') ? 'dose' : freeQuant[0]
      const rest = freeQuant.filter((k) => k !== arrowKey)
      if (rest.length) shadeKey = rest[0]
    }
  } else if (colorKey && !colorRamp) {
    if (freeQuant.length === 1) shadeKey = freeQuant[0]
    else if (freeQuant.length >= 2) {
      // dose+time with one qualitative: shade by time, connect doses with arrows.
      shadeKey = 'time'
      arrowKey = 'dose'
    }
  } else if (colorRamp && freeQuant.length >= 1) {
    arrowKey = freeQuant[0]
  }
  return { grouped, quals: Q, colorKey, colorRamp, shadeKey, arrowKey }
}

/**
 * The plan with the user's choices applied, the rest filled automatically by the same preferences
 * as planAesthetics. A choice the data can't take falls back to automatic: a colour condition that
 * doesn't vary is skipped, and shade / arrow take only a NUMERIC varying condition not already on
 * colour — the ordered channels never get a categorical one, whatever was chosen.
 */
function planWithOverrides(
  varying: Set<ConditionKey>,
  conds: ConditionKey[],
  ov: PlanOverrides
): Plan {
  const N = conds.filter((c) => varying.has(c) && isNumericCond(c))
  // Colour: the chosen conditions that vary (several categoricals → grouped hues; one → its own
  // colours; only numerics → a ramp on the first), else the automatic choice.
  const chosen = (ov.color ?? []).filter((c) => varying.has(c))
  let quals = chosen.filter((c) => !isNumericCond(c))
  let colorKey: ConditionKey | null = null
  let colorRamp = false
  if (!chosen.length) {
    const auto = planAesthetics(varying, conds)
    quals = auto.quals
    colorKey = auto.grouped ? null : auto.colorKey
    colorRamp = auto.colorRamp
    if (!auto.grouped) quals = []
  } else if (quals.length === 1) colorKey = quals[0]
  else if (quals.length === 0) {
    colorKey = chosen[0]
    colorRamp = true
  }
  const grouped = quals.length >= 2
  // Numeric conditions left for the ordered channels.
  const onColour = new Set<ConditionKey>(grouped ? quals : colorKey ? [colorKey] : [])
  const pool = N.filter((c) => !onColour.has(c))
  const take = (k: ConditionKey): ConditionKey => {
    pool.splice(pool.indexOf(k), 1)
    return k
  }
  const valid = (k: ConditionKey | 'none' | undefined): k is ConditionKey =>
    !!k && k !== 'none' && pool.includes(k)
  let shadeKey: ConditionKey | null = valid(ov.shade) ? take(ov.shade) : null
  let arrowKey: ConditionKey | null = valid(ov.arrow) ? take(ov.arrow) : null
  const pick = (prefer: ConditionKey): ConditionKey | null =>
    pool.length ? take(pool.includes(prefer) ? prefer : pool[0]) : null
  const autoShade = ov.shade === undefined && !shadeKey
  const autoArrow = ov.arrow === undefined && !arrowKey
  // Fill what was left automatic with planAesthetics' preferences: grouped or ramp colour → arrows
  // first (dose preferred); one categorical colour → shade first, and with two numerics left,
  // shade by time and arrows by dose.
  if (grouped || colorRamp) {
    if (autoArrow) arrowKey = pick('dose')
    if (autoShade && grouped) shadeKey = pick('time')
  } else {
    if (autoShade && autoArrow && pool.length >= 2) {
      shadeKey = pick('time')
      arrowKey = pick('dose')
    } else {
      if (autoShade) shadeKey = pick('time')
      if (autoArrow && pool.length) arrowKey = pick('dose')
    }
  }
  return { grouped, quals: grouped ? quals : [], colorKey, colorRamp, shadeKey, arrowKey }
}
