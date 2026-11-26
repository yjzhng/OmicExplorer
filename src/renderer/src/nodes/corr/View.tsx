import type { ReactNode } from 'react'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { CORR_METRIC_LABEL, CORR_METRICS, corrMetricOf, type CorrMetric } from '../../engine'
import { useGraph } from '../../graph/store'
import { quickOn } from '../../graph/registry'
import { type CorrConfig, SAMPLE_ORDERS, sampleOrderOf } from '../../graph/types'
import { Empty, PlotNotRun } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { CorrTile } from './CorrTile'

/** The corr result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function corrView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, paletteOf, patchConfig, plotRun, node, child } = v
  if (upstream?.kind !== 'standardize')
    return <Empty text="Connect a Clean data tile and run it." />
  const cfg = cfgSource as CorrConfig
  const cluster = cfg.cluster ?? true
  const metric = corrMetricOf(cfg.metric)
  // Drawn from the plot's run (every metric's matrix, computed in the worker on the analysis scale).
  // A result from before the plot computed in its run (a bare marker) has none, and one from before
  // a metric existed lacks that metric's matrix: run it.
  const tile =
    plotRun?.kind === 'corr' && plotRun.corr.matrices[metric] ? (
      <CorrTile
        all={plotRun.corr}
        std={upstream.std}
        cluster={cluster}
        palette={paletteOf(cfg, 'corr', 'palette')}
        sampleOrder={sampleOrderOf(cfg)}
        metric={metric}
      />
    ) : (
      <PlotNotRun
        status="idle"
        onRun={() => {
          const g = useGraph.getState()
          void (child ? g.runPlotChild(node.id, child.id) : g.runTargets([node.id]))
        }}
      />
    )
  // The sample order applies while the samples aren't clustered (clustering sets its own).
  const sortBar = !cluster && quickOn(cfg, 'sampleOrder', 'corr')
  const metricBar = quickOn(cfg, 'metric', 'corr')
  if (!sortBar && !metricBar) return <div style={styles.chart}>{tile}</div>
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {metricBar && (
            <SwitchBar
              label="metric"
              value={metric}
              options={[...CORR_METRICS]}
              optionLabel={(o) => CORR_METRIC_LABEL[o as CorrMetric]}
              onChange={(m) => patchConfig({ metric: m as CorrMetric })}
            />
          )}
          {sortBar && (
            <SwitchBar
              label="sort"
              value={sampleOrderOf(cfg)}
              options={SAMPLE_ORDERS}
              onChange={(o) => patchConfig({ sampleOrder: o })}
            />
          )}
        </div>
        <div style={styles.stackBody}>{tile}</div>
      </div>
    </div>
  )
}
