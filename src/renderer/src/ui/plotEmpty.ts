/** Whether a figure has anything to draw — so a plot left with no values for the conditions on
 *  show says so (PlotlyChart's note, the figure hidden) instead of standing as empty axes. */

/** What a plot with nothing to draw says, in place of the figure. */
export const NO_DATA_NOTE = 'No data available for current conditions'

type List = ArrayLike<unknown>
const isList = (v: unknown): v is List => Array.isArray(v) || ArrayBuffer.isView(v)
const isValue = (v: unknown): boolean =>
  v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v))

/** Whether one trace has a point to draw: a heatmap's grid a value anywhere, a pie a value, any
 *  other one an index where its x, y (and z) all hold one. A trace drawn from none of those (a
 *  table, a sankey) is taken to have data — never called empty on a guess. */
function traceHasValues(t: Record<string, unknown>): boolean {
  const z = t.z
  if (isList(z) && z.length && isList(z[0]))
    return Array.from(z as ArrayLike<List>).some((row) => Array.from(row).some(isValue))
  if (isList(t.values)) return Array.from(t.values).some(isValue)
  const cols = [t.x, t.y, z].filter(isList)
  if (!cols.length) return true
  const n = Math.min(...cols.map((c) => c.length))
  for (let i = 0; i < n; i++) if (cols.every((c) => isValue(c[i]))) return true
  return false
}

/** Whether any of a figure's traces has a point to draw. */
export function hasPlotValues(data: readonly unknown[]): boolean {
  return data.some((t) => t != null && typeof t === 'object' && traceHasValues(t as never))
}
