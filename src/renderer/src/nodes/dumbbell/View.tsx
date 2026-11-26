import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  quantityLabel,
  contextOf,
  contrastFeatureLabel,
  DUMBBELL_ORDERS,
  dumbbellOrderLabel
} from '../../engine'
import { quickOn } from '../../graph/registry'
import { type DumbbellConfig, geneCapOn, topCountOf } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { DumbbellView } from './DumbbellView'

/** The dumbbell result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function dumbbellView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    patchConfig,
    numeric,
    contrastSource,
    facetSel,
    focus,
    quantityScale,
    quantityUnit,
    plainScale
  } = v
  if (upstream?.kind !== 'contrast') return <Empty text="Connect a Contrast tile and run it." />
  const cfg = cfgSource as DumbbellConfig
  const dm = upstream.displayMap
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        {quickOn(cfg, 'order') && (
          <SwitchBar
            label="order by"
            value={cfg.order ?? 'diff'}
            options={DUMBBELL_ORDERS}
            optionLabel={(o) => dumbbellOrderLabel(o, contextOf(upstream.ctr).rows)}
            onChange={(v) => patchConfig({ order: v })}
          />
        )}
        <div style={styles.stackBody}>
          {/* Full rows (no `sub`): the base list follows the All/Selected toggle via `focus`,
                  and DumbbellView appends any hovered/pinned gene from the full set. */}
          <FacetedPlot numeric={numeric} rows={contrastSource(upstream)} facetSel={facetSel}>
            {(rows) => (
              <DumbbellView
                rows={rows}
                topGenes={geneCapOn(cfg) ? topCountOf(cfg, cfg.topGenes) : 0}
                topSplit={cfg.topSplit}
                topUp={cfg.topUp}
                topDown={cfg.topDown}
                displayMap={dm}
                focus={focus}
                key={cfg.orient ?? 'auto'}
                orient={cfg.orient}
                order={cfg.order}
                // the feature on the switcher, when it's not the sides' own value
                valueKind={contrastFeatureLabel(rows) ? 'other' : upstream.ctr.valueKind}
                valueLabel={
                  contrastFeatureLabel(rows) ??
                  quantityLabel(quantityScale, quantityUnit, !!plainScale)
                }
                // an abundance contrast's own values (not another feature) shown plain
                plainScale={
                  upstream.ctr.valueKind === 'quantity' && !contrastFeatureLabel(rows)
                    ? plainScale
                    : undefined
                }
              />
            )}
          </FacetedPlot>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
