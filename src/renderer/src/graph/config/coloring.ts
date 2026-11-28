/**
 * Colouring by condition — which conditions a plot colours and fades by, as its settings store
 * them — and the samples' order.
 */
import {
  CLUSTER_COLOR,
  colorByCond,
  type ConditionKey,
  condValue,
  GROUP_COLOR,
  isNumericCond,
  type NumericConds,
  numericOf,
  orderConds,
  type SampleOrder,
  type StandardizeResult
} from '../../engine'
import type { ClusterConfig } from './cluster'
import type { BarConfig } from './genePlots'

/** The condition a by-condition colouring starts from when none is picked yet: the data's first
 *  categorical condition, else its first condition at all. */
export function defaultColorConds(
  active: readonly ConditionKey[],
  numeric: NumericConds
): ConditionKey[] {
  const cats = active.filter((c) => !isNumericCond(c, numeric))
  return (cats.length ? cats : active).slice(0, 1)
}

/** The conditions a cluster colours by: `colorConds` while colorBy is a categorical condition
 *  that it still includes (a later pick of colorBy alone — the tile's switch — supersedes it), else
 *  colorBy alone; none for the cluster colouring. */
export function clusterColorConds(c: ClusterConfig, numeric: NumericConds): ConditionKey[] {
  if (!colorByCond(c.colorBy)) return []
  const by = c.colorBy
  // the shade is added to a categorical colour only (the picker shows for those alone)
  return !isNumericCond(by, numeric) && c.colorConds?.includes(by) ? c.colorConds.slice(0, 2) : [by]
}

/** The conditions a cluster coloured by its condition groups (`colorBy: 'groups'`) combines: its
 *  `groupConds` the data still carries, else every one of `active` — one colour per condition
 *  group. In `active`'s order, so the group names read the same way whatever order they were
 *  picked in. */
export function clusterGroupConds(
  c: Pick<ClusterConfig, 'groupConds'>,
  active: readonly ConditionKey[]
): ConditionKey[] {
  const picked = active.filter((k) => c.groupConds?.includes(k))
  return picked.length ? picked : [...active]
}

/** What a plot coloured by condition colours and fades by: the conditions the colours stand for
 *  (several: every combination its own colour) and the numeric one fading them (null: none). */
export interface ConditionColoring {
  picks: ConditionKey[]
  fade: ConditionKey | null
}

/** A plot's default colouring by condition (PCA, QC, gene bar), in the default condition order
 *  (cell → cmpd → dose → time → customs): every categorical condition on colour, and the first
 *  numeric one left over as the fade. With no categorical condition at all, the first condition
 *  colours. */
export function defaultConditionColoring(
  active: readonly ConditionKey[],
  numeric: NumericConds
): ConditionColoring {
  const conds = orderConds(active)
  const cats = conds.filter((k) => !isNumericCond(k, numeric))
  const picks = cats.length ? cats : conds.slice(0, 1)
  const fade = conds.find((k) => isNumericCond(k, numeric) && !picks.includes(k)) ?? null
  return { picks, fade }
}

/** What a QC or gene bar plot coloured by condition colours and fades by, as the settings show them
 *  (in the default condition order): its `colorPicks` the data still carries and its `fadeCond`
 *  (numeric, never a colour condition); else an older config's `colorConds` (its categorical one
 *  the colour, its numeric one the fade — a numeric one alone the colour); else the default
 *  (defaultConditionColoring). */
export function conditionColoring(
  c: { colorPicks?: ConditionKey[]; fadeCond?: ConditionKey; colorConds?: ConditionKey[] },
  active: readonly ConditionKey[],
  numeric: NumericConds
): ConditionColoring {
  const conds = orderConds(active)
  const kept = (ks: readonly ConditionKey[]): ConditionKey[] => conds.filter((k) => ks.includes(k))
  const valid = (
    picks: ConditionKey[],
    fade: ConditionKey | null | undefined
  ): ConditionColoring => ({
    picks,
    fade:
      fade && conds.includes(fade) && isNumericCond(fade, numeric) && !picks.includes(fade)
        ? fade
        : null
  })
  const picks = kept(c.colorPicks ?? [])
  if (picks.length) return valid(picks, c.fadeCond)
  if (!c.colorPicks && c.colorConds?.length) {
    const old = kept(c.colorConds)
    const cats = old.filter((k) => !isNumericCond(k, numeric))
    if (cats.length)
      return valid(
        cats.slice(0, 1),
        old.find((k) => isNumericCond(k, numeric))
      )
    if (old.length) return valid(old.slice(0, 1), null)
  }
  return defaultConditionColoring(active, numeric)
}

/** The config a pick of colour conditions and a fade writes, for QC and the gene bar. */
export const conditionColorWrite = (
  picks: readonly ConditionKey[],
  fade: ConditionKey | null
): { colorPicks: ConditionKey[]; fadeCond: ConditionKey | undefined; colorConds: undefined } => ({
  colorPicks: [...picks],
  fadeCond: fade && !picks.includes(fade) ? fade : undefined,
  colorConds: undefined
})

/** What a cluster coloured by conditions colours and fades by, as the settings show them (in the
 *  default condition order): its `colorPicks` the data still carries and its `fadeCond` (numeric,
 *  never a colour condition); else, on an older config, read back from its colouring — the
 *  condition groups' conditions, or the condition and its shade; else — a new plot (`colorPicks:
 *  []`), coloured by cluster before any pick, or a pick the data no longer carries — the default
 *  (defaultConditionColoring). */
export function clusterColoring(
  c: ClusterConfig,
  active: readonly ConditionKey[],
  numeric: NumericConds
): { picks: ConditionKey[]; fade: ConditionKey | null } {
  const conds = orderConds(active)
  const kept = (ks: readonly ConditionKey[]): ConditionKey[] => conds.filter((k) => ks.includes(k))
  const valid = (picks: ConditionKey[], fade: ConditionKey | null | undefined) => ({
    picks,
    fade:
      fade && conds.includes(fade) && isNumericCond(fade, numeric) && !picks.includes(fade)
        ? fade
        : null
  })
  const picks = kept(c.colorPicks ?? [])
  if (picks.length) return valid(picks, c.fadeCond)
  if (!c.colorPicks) {
    if (c.colorBy === GROUP_COLOR) return valid(clusterGroupConds(c, conds), null)
    const two = clusterTwoConds(c, numeric)
    const old = kept(two?.color ?? clusterColorConds(c, numeric))
    if (old.length) return valid(old, two?.shade)
  }
  return defaultConditionColoring(active, numeric)
}

/** The conditions a cluster colours by (see clusterColoring). */
export const clusterColorPicks = (
  c: ClusterConfig,
  active: readonly ConditionKey[],
  numeric: NumericConds
): ConditionKey[] => clusterColoring(c, active, numeric).picks

/** The condition a cluster coloured by conditions fades by (light = low → dark = high), null for
 *  none (see clusterColoring). */
export const clusterFadeCond = (
  c: ClusterConfig,
  active: readonly ConditionKey[],
  numeric: NumericConds
): ConditionKey | null => clusterColoring(c, active, numeric).fade

/** The config a pick of colour conditions (and a fade) writes — the user's choice as made, nothing
 *  inferred from the conditions' types: the picks, the fade, and what the run and the simple
 *  drawing read from them (one condition: its own colours; several: every distinct combination its
 *  own colour). With a fade, the view draws it by the complex legend (clusterFadeScheme). */
export function clusterColorWrite(
  picks: readonly ConditionKey[],
  fade: ConditionKey | null
): Pick<ClusterConfig, 'colorBy' | 'colorConds' | 'groupConds' | 'colorPicks' | 'fadeCond'> {
  const list = [...picks]
  return {
    colorPicks: list,
    fadeCond: fade && !list.includes(fade) ? fade : undefined,
    colorBy: list.length === 1 ? list[0] : GROUP_COLOR,
    groupConds: list.length === 1 ? undefined : list,
    colorConds: undefined
  }
}

/** A cluster coloured by conditions with a fade: the scheme its complex drawing takes — the
 *  colour conditions as picked (several: hue families, every combination distinct), the fade as
 *  the shade, no arrows. Null without a fade, or coloured by cluster. */
export function clusterFadeScheme(
  c: ClusterConfig,
  active: readonly ConditionKey[],
  numeric: NumericConds
): { color: ConditionKey[]; shade: ConditionKey; arrow: 'none' } | null {
  if (c.colorBy === CLUSTER_COLOR) return null
  const shade = clusterFadeCond(c, active, numeric)
  return shade ? { color: clusterColorPicks(c, active, numeric), shade, arrow: 'none' } : null
}

/** Whether a cluster is coloured by its computed clusters (else by conditions). */
export const clusterByCluster = (c: Pick<ClusterConfig, 'colorBy'>): boolean =>
  c.colorBy === CLUSTER_COLOR

/** A cluster coloured by two conditions (`colorConds`: a colour and a shade): the scheme its
 *  multi-condition drawing takes (ClusterView's complex build) — the colour by the one, the shade
 *  by the other, no arrows. Null for one condition (colorBy alone) or the cluster colouring. */
export function clusterTwoConds(
  c: ClusterConfig,
  numeric: NumericConds
): {
  color: ConditionKey[]
  shade: ConditionKey
  arrow: 'none'
} | null {
  const picks = clusterColorConds(c, numeric)
  const shade = picks.find((k) => isNumericCond(k, numeric))
  const color = picks.find((k) => k !== shade)
  return picks.length === 2 && shade && color ? { color: [color], shade, arrow: 'none' } : null
}

/** Past this many levels of the primary condition (the one a plot colours by first — see
 *  primaryColorLevels), a Clean-data plot's condition colouring starts off (a heatmap's condition
 *  bar, a bar or QC plot's fill by condition): a categorical palette has ~10 distinct colours, so
 *  more levels would repeat them. A tile that set it either way keeps that. */
export const MAX_COLOR_LEVELS = 10

/** How many distinct values the primary colour condition has in this data — the condition a new
 *  plot colours by (defaultColorConds: the first categorical one, e.g. cell or cmpd). Read off the
 *  samples (the rows when an older result has none); 0 with no condition at all. */
export function primaryColorLevels(
  std: Pick<StandardizeResult, 'activeConditions' | 'samples' | 'rows' | 'numericConditions'>
): number {
  const [c] = defaultColorConds(std.activeConditions, numericOf(std))
  if (!c) return 0
  const seen = new Set<string>()
  for (const s of std.samples ?? std.rows) {
    const v = condValue(s, c)
    if (v != null && v !== '') seen.add(String(v))
  }
  return seen.size
}

/** Whether a Clean-data plot colours by condition when its config doesn't say: while the primary
 *  condition's levels fit the categorical palette (primaryColorLevels). */
export const condColorByDefault = (levels: number): boolean => levels <= MAX_COLOR_LEVELS

/** A sample axis' order options (heatmap, gene bar, QC), with their labels — the settings select
 *  and the tile's switch bar share them. */
export const SAMPLE_ORDERS: readonly SampleOrder[] = ['natural', 'original']
/** What each order means, for the settings select's options. */
export const SAMPLE_ORDER_HINT: Record<SampleOrder, string> = {
  natural: 'natural (by condition, grouped with the fewest breaks)',
  original: 'original (the data’s sample order)'
}
/** A plot's sample order: as set, else natural. */
export const sampleOrderOf = (c: { sampleOrder?: SampleOrder }): SampleOrder =>
  c.sampleOrder === 'original' ? 'original' : 'natural'

/** The conditions a bar plot colours by — none when it colours by value. Reads an older config's
 *  single condition key in `colorBy` too. Unset (a new tile) → by condition while the primary
 *  condition's levels fit the palette, else by value (condColorByDefault). Coloured by condition with none picked yet → the default
 *  (defaultColorConds of the data's `active` conditions). */
export function barColoring(
  c: BarConfig,
  active: readonly ConditionKey[],
  levels: number,
  numeric: NumericConds
): ConditionColoring | null {
  const by = c.colorBy ?? (condColorByDefault(levels) ? 'condition' : 'value')
  if (by === 'condition') return conditionColoring(c, active, numeric)
  // (an older config's single condition key)
  if (by !== 'value')
    return conditionColoring({ colorPicks: active.includes(by) ? [by] : [] }, active, numeric)
  return null
}
