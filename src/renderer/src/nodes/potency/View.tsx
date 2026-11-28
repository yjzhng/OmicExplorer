import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  type CompareResultRow,
  DEFAULT_THRESHOLD,
  curveCuratorWall,
  hasResponseFits
} from '../../engine'
import { quickOn } from '../../graph/registry'
import {
  type CompareConfig,
  effectLabelsOf,
  modelViewOf,
  normalizeCompareConfig
} from '../../graph/config/compare'
import type { PotencyConfig } from '../../graph/config/dr'
import { curveAxisUnit } from '../../graph/config/units'
import { labelCapOn } from '../../graph/config/pointPlots'
import { DETECTOR_NO_PARAMS, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { curvePointCounts, facetAlpha } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { PotencyView } from './PotencyView'

/** The potency result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function potencyView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    upStep,
    patchConfig,
    numeric,
    subSource,
    facetSel,
    units,
    effectsOf
  } = v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
  const cfg = cfgSource as PotencyConfig
  const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
  // Potency is the description's: the detector (spline) has none.
  if (modelViewOf(upCfg) === 'detector' && hasResponseFits(upstream.cmp))
    return <Empty text={DETECTOR_NO_PARAMS} />
  const threshold = upstream.cmp.threshold ?? upCfg?.threshold ?? DEFAULT_THRESHOLD
  // The calls' smallest fold change either side — the volcano boundary's vertical wall: under
  // CurveCurator's score, where it sits for this facet's α (by a target FDR, the α its
  // comparison settled on — none when nothing was called) and its most common point count;
  // under a linear cutoff, the limits themselves; SAM has no fixed wall.
  const wallsFor = (rows: CompareResultRow[]): { low?: number; high?: number } => {
    if (threshold.type === 'sam_fdr') return {}
    // No limit (the response surface method's default) draws no wall.
    if (threshold.type !== 'curvecurator')
      return threshold.fcHigh === 0 && threshold.fcLow === 0
        ? {}
        : { low: threshold.fcLow, high: threshold.fcHigh }
    const a =
      threshold.ccCallBy === 'fdr'
        ? facetAlpha(upstream.cmp.ccAlpha, rows)
        : 10 ** -threshold.statMin
    const n = curvePointCounts(rows)[0]
    if (a == null || n == null) return {}
    return {
      low: -curveCuratorWall(n, -threshold.fcLow, a),
      high: curveCuratorWall(n, threshold.fcHigh, a)
    }
  }
  const show = cfg.show ?? 'all'
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        {quickOn(cfg, 'show') && (
          <SwitchBar
            label="curves"
            value={show}
            options={['called', 'all']}
            optionLabel={(o) => (o === 'called' ? 'significant' : 'all')}
            onChange={(v) => patchConfig({ show: v })}
          />
        )}
        <div style={styles.stackBody}>
          <FacetedPlot numeric={numeric} rows={subSource(upstream.cmp)} facetSel={facetSel}>
            {(rows) => (
              <PotencyView
                rows={rows}
                dose={curveAxisUnit(upCfg, units)}
                forcePEC50={!!cfg.forcePEC50}
                displayMap={upstream.displayMap}
                show={show}
                // (its scans are kept by the facet's rows: facetAlpha, curvePointCounts)
                fcLow={wallsFor(rows).low}
                fcHigh={wallsFor(rows).high}
                labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                effectLabels={effectLabelsOf(upCfg)}
                effectColors={effectsOf(cfg)}
                style={cfg.style}
                orient={cfg.orient ?? 'portrait'}
              />
            )}
          </FacetedPlot>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
