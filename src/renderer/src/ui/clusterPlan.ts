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

export function planAesthetics(varying: Set<ConditionKey>, conds: ConditionKey[]): Plan {
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
