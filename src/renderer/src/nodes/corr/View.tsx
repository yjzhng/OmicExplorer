import type { ReactNode } from 'react'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { analysisScaleOf } from '../../engine'
import { quickOn } from '../../graph/registry'
import { type CorrConfig, SAMPLE_ORDERS, sampleOrderOf } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { CorrTile } from './CorrTile'

/** The corr result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function corrView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, paletteOf, patchConfig } = v
  if (upstream?.kind !== 'standardize')
    return <Empty text="Connect a Clean data tile and run it." />
  const cfg = cfgSource as CorrConfig
  const cluster = cfg.cluster ?? true
  const tile = (
    <CorrTile
      std={upstream.std}
      cluster={cluster}
      // r is computed on the analysis scale (log as Clean data sets it, fractions included)
      scale={analysisScaleOf(upstream.std)}
      palette={paletteOf(cfg, 'corr', 'palette')}
      sampleOrder={sampleOrderOf(cfg)}
    />
  )
  // The sample order applies while the samples aren't clustered (clustering sets its own).
  if (cluster || !quickOn(cfg, 'sampleOrder', 'corr')) return <div style={styles.chart}>{tile}</div>
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          <SwitchBar
            label="sort"
            value={sampleOrderOf(cfg)}
            options={SAMPLE_ORDERS}
            onChange={(o) => patchConfig({ sampleOrder: o })}
          />
        </div>
        <div style={styles.stackBody}>{tile}</div>
      </div>
    </div>
  )
}
