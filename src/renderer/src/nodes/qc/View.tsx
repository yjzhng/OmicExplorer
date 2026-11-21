import type { ReactNode } from 'react'
import { SwitchBar } from '../../dashboard/SwitchBar'
import type { QcMetric } from '../../engine'
import { quickOn } from '../../graph/registry'
import {
  type QcConfig,
  SAMPLE_ORDERS,
  primaryColorLevels,
  qcColorConds,
  sampleOrderOf
} from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { QcTile } from './QcTile'

/** The qc result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function qcView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, patchConfig, condTitle, categoricalOf, quantityScale, numeric } = v
  if (upstream?.kind !== 'standardize')
    return <Empty text="Connect a Clean data tile and run it." />
  const cfg = cfgSource as QcConfig
  const metric = cfg.metric ?? 'intensity'
  // Plot type is metric-dependent: distributions (intensity/CV) render as violin/box; a
  // per-sample count (proteins) only makes sense as a bar.
  const plotOpts = qcPlotOptions(metric)
  const plot = plotOpts.includes(cfg.plot) ? cfg.plot : plotOpts[0]
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {quickOn(cfg, 'metric') && (
            <SwitchBar
              label="metric"
              value={QC_METRIC_LABEL[metric]}
              options={['intensity', 'CV', '# proteins']}
              onChange={(v) => {
                const m = QC_LABEL_METRIC[v]
                const opts = qcPlotOptions(m)
                // Keep the plot type if the new metric still allows it, else snap to its default.
                patchConfig({ metric: m, plot: opts.includes(plot) ? plot : opts[0] })
              }}
            />
          )}
          {/* Only offer the plot toggle when the metric supports more than one type. */}
          {plotOpts.length > 1 && quickOn(cfg, 'plot') && (
            <SwitchBar
              label="plot"
              value={plot}
              options={plotOpts}
              onChange={(v) => patchConfig({ plot: v as QcConfig['plot'] })}
            />
          )}
          {metric === 'proteins' && quickOn(cfg, 'yScale') && (
            <SwitchBar
              label="scale"
              value={cfg.yScale ?? 'global'}
              options={['range', 'global']}
              optionLabel={(o) => (o === 'range' ? 'adjusted' : 'global')}
              onChange={(v) => patchConfig({ yScale: v })}
            />
          )}
          {quickOn(cfg, 'sampleOrder') && (
            <SwitchBar
              label="sort"
              value={sampleOrderOf(cfg)}
              options={SAMPLE_ORDERS}
              onChange={(v) => patchConfig({ sampleOrder: v })}
            />
          )}
        </div>
        <div style={styles.stackBody}>
          <QcTile
            condTitle={condTitle}
            categorical={categoricalOf(cfg)}
            std={upstream.std}
            metric={metric}
            plot={plot}
            scale={quantityScale}
            color={cfg.color}
            colorConds={qcColorConds(
              cfg,
              upstream.std.activeConditions,
              primaryColorLevels(upstream.std),
              numeric
            )}
            fit={metric === 'proteins' && cfg.yScale === 'range'}
            sampleOrder={sampleOrderOf(cfg)}
          />
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
// QC metric ⇆ display-label maps for the in-tile metric SwitchBar.

export const QC_METRIC_LABEL: Record<QcMetric, string> = {
  intensity: 'intensity',
  cv: 'CV',
  proteins: '# proteins'
}
export const QC_LABEL_METRIC: Record<string, QcMetric> = {
  intensity: 'intensity',
  CV: 'cv',
  '# proteins': 'proteins'
}
/** Plot types valid for a metric: distributions → box/violin (box first = default); a per-sample
 *  count → bar only. */
export function qcPlotOptions(metric: QcMetric): QcConfig['plot'][] {
  return metric === 'proteins' ? ['bar'] : ['box', 'violin']
}
