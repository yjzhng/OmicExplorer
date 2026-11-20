import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { distinctOf, holderWhereNested, someNested } from '../../engine'
import { rowCount } from '../../engine/lazyRows'
import { type MetricId, METRIC_IDS, METRIC_NAMES } from '../../graph/metricBars'
import { quickOn } from '../../graph/registry'
import {
  type CompareConfig,
  type MetricsConfig,
  curveAxisUnit,
  normalizeCompareConfig
} from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { MetricBarsView } from './MetricBarsView'

/** The metrics result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function metricsView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, upStep, units, genes, patchConfig, numeric, facetSel, condTitle } = v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
  const cfg = cfgSource as MetricsConfig
  const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
  const fitted = holderWhereNested(
    upstream.cmp,
    'fitted',
    [
      ['curve', 'axis'],
      ['rs', 'axis']
    ],
    (on) => on[0] || on[1]
  )
  if (!rowCount(fitted)) return <Empty text="Needs a Curve fit’s results — run it." />
  const present = new Set(distinctOf(fitted, 'uniqID') as ReadonlySet<string>)
  // (a metric no longer offered — one saved before — falls back to the potency)
  const metric: MetricId =
    cfg.metric && (METRIC_IDS as readonly string[]).includes(cfg.metric) ? cfg.metric : 'potency'
  // the axis the curves run along: its unit names an EC50, its molar scale a pEC50
  const ctx = curveAxisUnit(upCfg, units)
  // Δ from the reference slice: a 2-D fit's only (a curve has no reference)
  const surfaces = someNested(fitted, 'rs', 'axis', (_, a) => a === 'surface')
  const show = surfaces && cfg.show === 'delta' ? 'delta' : 'value'
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div style={styles.stackBody}>
          <GeneSwitch
            genes={pagerGenes(genes, present)}
            present={present}
            displayMap={upstream.displayMap}
            controls={
              <>
                {quickOn(cfg, 'metric') && (
                  <SwitchBar
                    inline
                    label="metric"
                    value={metric}
                    options={METRIC_IDS}
                    optionLabel={(o) => METRIC_NAMES[o as MetricId]}
                    onChange={(v) => patchConfig({ metric: v })}
                  />
                )}
                {quickOn(cfg, 'show') && (
                  <SwitchBar
                    inline
                    label="show"
                    value={show}
                    options={['value', 'delta']}
                    optionLabel={(o) => (o === 'delta' ? 'change' : 'value')}
                    optionDisabled={(o) =>
                      o === 'delta' && !surfaces
                        ? 'Only for a 2-D fit: a change is from its reference slice'
                        : undefined
                    }
                    onChange={(v) => patchConfig({ show: v })}
                  />
                )}
              </>
            }
          >
            {(gene) => (
              <FacetedPlot numeric={numeric} rows={{ of: fitted }} facetSel={facetSel}>
                {(rows) => (
                  <MetricBarsView
                    row={rows.find((r) => r.uniqID === gene)}
                    metric={metric}
                    ctx={{ ...ctx, delta: show === 'delta' }}
                    condTitle={condTitle}
                  />
                )}
              </FacetedPlot>
            )}
          </GeneSwitch>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
