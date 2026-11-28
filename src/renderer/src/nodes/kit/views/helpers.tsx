import type { CSSProperties } from 'react'
import {
  ccTestOf,
  type CompareResultRow,
  type ConditionKey,
  condLabel,
  condsIn,
  type ContextRow,
  ctxNum,
  ctxValue,
  curveGroupKey,
  isNumericCond,
  type NumericConds,
  type StandardizeResult,
  valuesOf
} from '../../../engine'
import type { EffectLabels } from '../../../graph/config/compare'
import { heatStyle, valueRange } from '../../../ui/color/colormap'
import type { HeaderLine } from '../../../ui/table/DataTableView'
import { type PaletteRef, ROLE_DEFAULTS } from '../../../ui/color/palettes'
import { plotCached } from '../../../ui/plot/plotCache'

/** The viridis `value` heat style for a standardize result, scaled globally across every value
 *  (log10 when the values look like raw intensity). Shared by the matrix cells and the long view. */
export function makeValueHeat(
  std: StandardizeResult,
  palette: PaletteRef = ROLE_DEFAULTS.data
): (v: unknown) => CSSProperties | undefined {
  // The Clean data table's abundance cells: on the value palette, as the Clean data heatmap.
  return heatStyle(stdValueRange(std), palette)
}
/** A Clean data result's value range over every value, kept by the result (ui/plot/plotCache) — a scan
 *  of every value, shared by the tables' colours and the gene bar's scale. */
export function stdValueRange(std: StandardizeResult): ReturnType<typeof valueRange> {
  return plotCached('stdValueRange', [std], () =>
    valueRange(valuesOf(std, 'value') as Array<number | null>)
  )
}
/** The genes a one-gene pager steps through: the selected genes when any of them is in the data,
 *  else every gene in it — so the pager starts on all genes and a selection narrows it. */
export function pagerGenes(selected: string[], present: ReadonlySet<string>): string[] {
  // every gene as the same array while `present` is the same set (ui/plot/plotCache): the pager's
  // list isn't rebuilt on every render
  return selected.some((id) => present.has(id))
    ? selected
    : plotCached('pagerAll', [present], () => [...present])
}
/** Long tables always show a gene's rows as one block: rows are regrouped by uniqID in the order
 *  genes first appear (a stable partition, not an alphabetical sort — genes keep the input/engine
 *  order, and each gene's rows keep theirs). The engines emit rows comparison- or context-major,
 *  which scatters a gene across the table. */
export function groupByGene<T extends { uniqID: string }>(rows: T[]): T[] {
  const blocks = new Map<string, T[]>()
  for (const r of rows) {
    let b = blocks.get(r.uniqID)
    if (!b) blocks.set(r.uniqID, (b = []))
    b.push(r)
  }
  return [...blocks.values()].flat()
}
/** CurveCurator called by FDR: the effective α the target settled on for the comparison a facet
 *  shows (see applyCurveFdr) — the boundary's shape and cutoff. Undefined when nothing was called
 *  there (or the facet spans several groups that settled differently: the strictest is drawn). */
export function facetAlpha(
  alphas: Record<string, number> | undefined,
  facet: CompareResultRow[]
): number | undefined {
  if (!alphas) return undefined
  // kept by the facet's rows (ui/plot/plotCache): not a scan of them on every render
  return plotCached('facetAlpha', [facet, alphas], () => {
    let a: number | undefined
    for (const k of new Set(facet.map(curveGroupKey)))
      if (alphas[k] != null) a = a == null ? alphas[k] : Math.min(a, alphas[k])
    return a
  })
}
/** A curve fit's point counts (control included) common enough to draw CurveCurator's boundary
 *  for — each at least 5% of the curves, most common first. Empty for any other analysis. */
export function curvePointCounts(rows: CompareResultRow[]): number[] {
  // kept by the rows (ui/plot/plotCache): the same array render to render, not a scan on each
  return plotCached('curvePointCounts', [rows], () => countCurvePoints(rows))
}
function countCurvePoints(rows: CompareResultRow[]): number[] {
  const tally = new Map<number, number>()
  let total = 0
  for (const r of rows) {
    const cc = ccTestOf(r)
    if (cc) {
      tally.set(cc.n, (tally.get(cc.n) ?? 0) + 1)
      total++
    }
  }
  return [...tally]
    .filter(([, c]) => c >= total * 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([n]) => n)
}
/** Three significant figures (EC50s span orders of magnitude, so fixed decimals don't fit). */
export const sig3 = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toPrecision(3))) : ''
/** Cell formatter mapping the stored effect class ('up'/'down'/'none') to its display name. */
export const effectName =
  (labels: EffectLabels) =>
  (v: unknown): string =>
    v === 'up'
      ? labels.up
      : v === 'down'
        ? labels.down
        : v === 'none'
          ? labels.none
          : String(v ?? '')
/** One context value in a matrix column header (the engine's, shared with the fold-change heatmap's
 *  columns and the facet labels so the same column reads the same everywhere). */
export { ctxLabel } from '../../../engine'
/** A matrix column's context conditions as header lines: name → value, blank values left out. */
export function ctxLines(r: Parameters<typeof ctxValue>[0], dims: ConditionKey[]): HeaderLine[] {
  return dims
    .map((c) => ({ key: condLabel(c), value: String(ctxValue(r, c) ?? '') }))
    .filter((l) => l.value !== '')
}
/** Which response axes the compare rows actually carry (their numeric conditions: dose, time, or
 *  both). Drives whether DR/TR and Bubble show the dose⇆time switcher — a single-axis dataset
 *  needs no switch. */
export function axisChoices(
  rows: ReadonlyArray<
    ContextRow & {
      curve?: { axis: string }
      rs?: { axis: string }
    }
  >,
  numeric: NumericConds
): ConditionKey[] {
  // A curve fit's row is a whole curve over its own axis (its dose / time field is the context,
  // e.g. the time a dose curve was measured at); other rows sit at a level of either. A curve's
  // axis is numeric by being one, and its rows carry no level of it — so a custom one (temp) is
  // taken from the curves, not looked for among the rows' values.
  const alongs = new Set(
    rows
      .map((r) => r.curve?.axis ?? r.rs?.axis ?? r.along)
      .filter((a): a is string => a != null && a !== 'surface')
  )
  const cands = [...condsIn(rows), ...([...alongs] as ConditionKey[])]
  return [...new Set(cands)]
    .filter((c) => alongs.has(c) || isNumericCond(c, numeric))
    .filter((a) =>
      rows.some((r) => {
        const along = r.curve?.axis ?? r.rs?.axis ?? r.along
        return along ? along === a : ctxNum(r, a) != null
      })
    )
}
/** What a contrast's two values and their difference are called in its table — its feature on
 *  show: FC (the sides' own value — a fold change, or abundance), else the feature's short name
 *  (EC50 / pEC50, SD, CV, sig). */
export function contrastValueName(
  rows: ReadonlyArray<{ featureId?: string; feature?: string }>
): string {
  const r = rows.find((x) => x.featureId)
  if (!r || r.featureId === 'value') return 'FC'
  if (r.featureId === 'pec50') return (r.feature ?? 'pEC50').split(' (')[0]
  return r.featureId === 'sd' ? 'SD' : r.featureId === 'cv' ? 'CV' : 'sig'
}
/** A contrast field's label for that feature: FC1 / FC2 / FCdiff as named (EC50 1, EC50 diff, …). */
export const valueLabel = (label: string, name: string): string =>
  name === 'FC' || !label.startsWith('FC') ? label : `${name} ${label.slice(2)}`
