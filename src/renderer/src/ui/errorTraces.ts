import type { DRLook } from '../graph/types'

/** The error around a series' values, from `lo` to `hi`: whiskers (an error_y on a trace of its
 *  own, so their opacity is theirs, not the line's) or a shaded band between them — drawn under
 *  the line. */
export function errorTraces(
  x: Array<string | number>,
  y: number[],
  lo: number[],
  hi: number[],
  ink: string,
  style: DRLook['errorStyle']
): Record<string, unknown>[] {
  if (style === 'whisker')
    return [
      {
        type: 'scatter',
        mode: 'markers',
        x,
        y,
        marker: { size: 0, opacity: 0 },
        error_y: {
          type: 'data',
          symmetric: false,
          array: hi.map((h, i) => h - y[i]),
          arrayminus: lo.map((l, i) => y[i] - l),
          visible: true,
          color: ink,
          thickness: 1
        },
        showlegend: false,
        hoverinfo: 'skip'
      }
    ]
  const common = { type: 'scatter', mode: 'lines', x, showlegend: false, hoverinfo: 'skip' }
  return [
    { ...common, y: hi, line: { width: 0, color: ink } },
    { ...common, y: lo, line: { width: 0, color: ink }, fill: 'tonexty', fillcolor: ink }
  ]
}
