import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { DEFAULT_THRESHOLD, buildMA } from '../../engine'
import { useGraph } from '../../graph/store'
import {
  type CompareConfig,
  type MAConfig,
  effectLabelsOf,
  labelCapOn,
  normalizeCompareConfig
} from '../../graph/types'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { MAView } from './MAView'

/** The ma result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function maView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    upStep,
    numeric,
    subSource,
    facetSel,
    quantityScale,
    quantityUnit,
    quantityPlain,
    plainScale,
    effectsOf,
    upId
  } = v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
  const cfg = cfgSource as MAConfig
  const dm = upstream.displayMap
  // MA's fold-change lines are the SAME threshold volcano uses — the one the result's calls were
  // made with (see the volcano above) — so the two plots match and a drag on either updates the
  // shared cutoff. Under a SAM (non-linear) threshold there's no fixed FC cutoff to draw, so hide
  // the lines (colour still shows calls).
  const maCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
  const threshold = upstream.cmp.threshold ?? maCfg?.threshold ?? DEFAULT_THRESHOLD
  // Fold-change lines belong to the linear cutoff only.
  const maSam = threshold.type !== 'linear'
  return (
    <div style={styles.chart}>
      <FacetedPlot numeric={numeric} rows={subSource(upstream.cmp)} facetSel={facetSel}>
        {(rows) => (
          <Built
            build={() =>
              buildMA(rows, {
                fcLow: threshold.fcLow,
                fcHigh: threshold.fcHigh,
                displayMap: dm,
                scale: quantityScale,
                unit: quantityUnit,
                plain: quantityPlain
              })
            }
            deps={[
              rows,
              threshold.fcLow,
              threshold.fcHigh,
              dm,
              quantityScale,
              quantityUnit,
              quantityPlain
            ]}
          >
            {(ma) => (
              <MAView
                ma={ma}
                samThreshold={maSam}
                asymmetric={threshold.asymmetric ?? false}
                effectLabels={effectLabelsOf(maCfg)}
                effectColors={effectsOf(cfg)}
                style={cfg.style}
                labelTop={labelCapOn(cfg) ? (cfg.labelTop ?? 0) : 0}
                plainScale={plainScale}
                onThresholdChange={
                  upId
                    ? (partial) => useGraph.getState().setCompareThreshold(upId, partial)
                    : undefined
                }
              />
            )}
          </Built>
        )}
      </FacetedPlot>
    </div>
  )

  return <Empty text="No output." />
}
