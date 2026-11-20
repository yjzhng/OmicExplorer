import { type ReactNode, useMemo } from 'react'
import type { StepStatus } from '../../../graph/types'
import { StatusIcon } from '../../../ui/StatusNote'
import { styles } from './styles'

/** Memoizes a plot-data build inside a FacetedPlot render prop. The render prop runs on every
 *  PanelBody render (a pin click, a status tick anywhere), and an inline `buildX(rows, …)` there
 *  hands the view a FRESH data object each time — which is a full Plotly redraw of the chart, on
 *  every tile, hidden tabs included. `deps` are the build's actual inputs. */
export function Built<T>({
  build,
  deps,
  children
}: {
  build: () => T
  deps: unknown[]
  children: (built: T) => ReactNode
}): ReactNode {
  // A generic helper can't hand the hooks lint a literal deps array; the deps ARE the memo key.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  const built = useMemo(build, deps)
  return children(built)
}
export type StdView = 'matrix' | 'long' | 'qc'
/** A pivot's input by row: its gene, the context its column is told from (a row, or a context
 *  index's row standing for it — pivotOver reads only that through colOf / linesOf / unsignedOf),
 *  and its value under the field. */
export interface PivotSource<T> {
  n: number
  uid: (i: number) => string
  ctx: (i: number) => T
  value: (i: number) => unknown
}
export function Empty({ text }: { text: string }): ReactNode {
  return <div style={styles.empty}>{text}</div>
}
/** A plot that hasn't run (or whose run failed): why, and a button to run just this plot. */
export function PlotNotRun({
  status,
  error,
  onRun
}: {
  status: StepStatus
  error?: string
  onRun: () => void
}): ReactNode {
  if (status === 'running')
    return (
      // The progress spinner turns on the compositor, so it keeps going while the UI thread is busy.
      <div style={{ ...styles.empty, gap: 8 }}>
        <StatusIcon kind="progress" />
        Running…
      </div>
    )
  return (
    <div style={{ ...styles.empty, flexDirection: 'column', gap: 10 }}>
      <span>
        {status === 'error'
          ? (error ?? 'This plot failed to run.')
          : 'Not run yet — run this plot to view it.'}
      </span>
      <button style={styles.runBtn} onClick={onRun}>
        {status === 'error' ? 'Retry' : 'Run'}
      </button>
    </div>
  )
}
