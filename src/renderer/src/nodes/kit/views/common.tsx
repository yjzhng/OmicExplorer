import { type ReactNode, useId } from 'react'
import type { StepStatus } from '../../../graph/types'
import { usePlotCached } from '../../../ui/plotCache'
import { StatusIcon } from '../../../ui/StatusNote'
import { styles } from './styles'

/** A plot-data build inside a FacetedPlot render prop, from the app-wide plot cache (ui/plotCache).
 *  The render prop runs on every PanelBody render (a pin click, a status tick anywhere), and an
 *  inline `buildX(rows, …)` there hands the view a FRESH data object each time — which is a full
 *  Plotly redraw of the chart, on every tile, hidden tabs included; and a remount (a facet or tab
 *  switched back) takes the one built before. `name` tells the build apart from another on the
 *  same inputs (unnamed: kept for this mount only); `deps` are the build's actual inputs. */
export function Built<T>({
  name,
  build,
  deps,
  children
}: {
  name?: string
  build: () => T
  deps: unknown[]
  children: (built: T) => ReactNode
}): ReactNode {
  const own = useId()
  const built = usePlotCached(name ?? own, deps, build)
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
/** What a plot of the description's parameters (potency, slope, plateaus) says under the detector
 *  model view: the spline has none. */
export const DETECTOR_NO_PARAMS =
  'The detector (spline) has no EC50 or plateaus — switch the model to descriptor.'
export function Empty({ text }: { text: string }): ReactNode {
  return <div style={styles.empty}>{text}</div>
}
/** A plot that hasn't run (or whose run failed): why, and a button to run just this plot. */
export function PlotNotRun({
  status,
  error,
  queued = false,
  onRun
}: {
  status: StepStatus
  error?: string
  /** running, but only waiting its turn (in its group's run, a Run, a re-run below a step) or on
   *  its input: said so, with no Run — one would run it now, and again when its turn came */
  queued?: boolean
  onRun: () => void
}): ReactNode {
  if (status === 'running' && queued)
    return (
      <div style={{ ...styles.empty, gap: 8 }}>
        <StatusIcon kind="progress" />
        Waiting to run…
      </div>
    )
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
