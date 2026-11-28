import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  type CompareResultRow,
  RESIDUAL_DOT_CAP,
  curvesReplicated,
  nestedCol,
  stdLookupOf
} from '../../engine'
import { rowCount } from '../../engine/lazyRows'
import { quickOn } from '../../graph/registry'
import {
  type CompareConfig,
  type CurveMadConfig,
  curveDoseUnit,
  effectLabelsOf,
  normalizeCompareConfig
} from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { CurveMadView } from './CurveMadView'

/** curvesReplicated over a Compare's curves, read off their nested columns (only the fields it
 *  looks at) — no row built. Cached per result. */
export const replicatedOf = new WeakMap<object, boolean>()
export function curvesReplicatedOf(cmp: { rows: readonly CompareResultRow[] }): boolean {
  let out = replicatedOf.get(cmp)
  if (out === undefined) {
    const [x, rep, cy, crep] = ['x', 'rep', 'cy', 'crep'].map((k) => nestedCol(cmp, 'curve', k))
    const curves: Array<{ curve: Parameters<typeof curvesReplicated>[0][number]['curve'] }> = []
    for (let r = 0, n = rowCount(cmp); r < n; r++) {
      const xs = x(r) as number[] | undefined
      if (xs)
        curves.push({
          curve: {
            x: xs,
            rep: rep(r) as Array<number | null> | undefined,
            cy: cy(r) as number[] | undefined,
            crep: crep(r) as Array<number | null> | undefined
          }
        })
    }
    replicatedOf.set(cmp, (out = curvesReplicated(curves)))
  }
  return out
}
/** The curveMad result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function curveMadView(v: ViewContext): ReactNode {
  const { upstream, upStep, cfgSource, patchConfig, numeric, facetSel, repStd, units, effectsOf } =
    v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
  const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
  const cfg = cfgSource as CurveMadConfig
  // By sample is offered only where it can differ from by dose (curvesReplicated).
  const replicated = curvesReplicatedOf(upstream.cmp)
  const check = cfg.check === 'sample' && !replicated ? 'dose' : (cfg.check ?? 'dose')
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        {/* One row, wrapping when the tile is narrow (as the PCA's switches). */}
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {quickOn(cfg, 'check') && (
            <SwitchBar
              label="check"
              value={check}
              options={
                replicated
                  ? ['dose', 'sample', 'fitted', 'normality', 'metrics']
                  : ['dose', 'fitted', 'normality', 'metrics']
              }
              onChange={(v) => patchConfig({ check: v })}
            />
          )}
          {/* how the residuals are drawn: only the dose / sample groupings have a choice */}
          {(check === 'dose' || check === 'sample') && quickOn(cfg, 'show') && (
            <SwitchBar
              label="show"
              value={cfg.show ?? 'dot'}
              options={['dot', 'violin']}
              onChange={(v) => patchConfig({ show: v })}
            />
          )}
          {/* a Q–Q plot's axes are quantiles, not residuals — no scale to choose (nor the
                  metrics', each its own) */}
          {check !== 'normality' && check !== 'metrics' && quickOn(cfg, 'yScale') && (
            <SwitchBar
              label="scale"
              value={cfg.yScale ?? 'fit'}
              options={['fit', 'range']}
              optionLabel={(o) => (o === 'fit' ? 'adjusted' : 'global')}
              onChange={(v) => patchConfig({ yScale: v })}
            />
          )}
        </div>
        <div style={styles.stackBody}>
          <FacetedPlot numeric={numeric} rows={{ of: upstream.cmp }} facetSel={facetSel}>
            {(rows) => (
              <CurveMadView
                rows={rows}
                displayMap={upstream.displayMap}
                std={repStd ? stdLookupOf(repStd) : undefined}
                unit={curveDoseUnit(upCfg, units).unit}
                style={cfg.style}
                yScale={cfg.yScale}
                show={cfg.show}
                check={check}
                metricX={cfg.metricX}
                metricY={cfg.metricY}
                threshold={upstream.cmp.threshold ?? upCfg?.threshold}
                doseScale={curveDoseUnit(upCfg, units).scale}
                flatPotency={cfg.forcePEC50 ? 'zero' : undefined}
                effectLabels={effectLabelsOf(upCfg)}
                effectColors={effectsOf(cfg)}
                onMetricX={(m) => patchConfig({ metricX: m })}
                onMetricY={(m) => patchConfig({ metricY: m })}
                maxPoints={
                  cfg.capEnabled === false
                    ? Infinity
                    : Math.min(cfg.maxPoints ?? RESIDUAL_DOT_CAP, RESIDUAL_DOT_CAP)
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
