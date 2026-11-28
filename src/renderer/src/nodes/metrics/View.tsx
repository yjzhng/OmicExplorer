import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  type CompareResultRow,
  type ConditionKey,
  type NumericConds,
  distinctOf,
  facetGroupsOf,
  hasResponseFits,
  comparisonOf,
  contextOf,
  ctxLabel,
  holderWhereNested,
  rowsAt,
  rowView,
  someNested
} from '../../engine'
import { rowCount } from '../../engine/lazyRows'
import { type MetricId, METRIC_IDS, METRIC_NAMES } from '../../graph/metricBars'
import { quickOn } from '../../graph/registry'
import { factsOf, unmetRequirement } from '../../graph/requirements'
import {
  type CompareConfig,
  type MetricsConfig,
  curveAxisUnit,
  modelViewOf,
  normalizeCompareConfig
} from '../../graph/types'
import { DETECTOR_NO_PARAMS, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { type AcrossBars, MetricBarsView } from './MetricBarsView'

/** One-axis curves' bars: one per context the Curve fit ran in — each comparison at each level of
 *  the other conditions (cell, time, …), the tabs the other plots switch between — in the facets'
 *  order. Per result: the contexts and, per gene, its row in each (−1: none there). */
interface Across {
  /** the one condition the contexts differ in (its levels coloured along its palette), if one */
  by?: ConditionKey
  /** what every context shares — its comparison (a curve fit's "dose curve | baseline") — else
   *  'comparison', for the axis title as the heatmap's */
  title: string
  labels: string[]
  rowOf: Map<string, Int32Array>
  bars: Map<string, AcrossBars>
}
const acrossCache = new WeakMap<object, Across>()
function acrossOf(fitted: { rows: readonly CompareResultRow[] }, numeric: NumericConds): Across {
  let a = acrossCache.get(fitted)
  if (a) return a
  const groups = facetGroupsOf(fitted, numeric)
  const dims = groups[0]?.values.map((v) => v.dim) ?? []
  const only = dims.length === 1 ? dims[0] : undefined
  const by =
    only && only !== 'comparison' && only !== 'feature' && only !== 'show' ? only : undefined
  const id = rowView(fitted).col('uniqID')
  const rowOf = new Map<string, Int32Array>()
  groups.forEach((g, k) => {
    for (const r of g.idx) {
      const gene = String(id(r))
      let at = rowOf.get(gene)
      if (!at) rowOf.set(gene, (at = new Int32Array(groups.length).fill(-1)))
      at[k] = r
    }
  })
  // named as the fold-change heatmap names its columns: the comparison bare, a condition as
  // ctxLabel ("time 960"); the shared comparison is the title
  a = {
    ...(by ? { by } : null),
    title: comparisonOf(contextOf(fitted).rows) ?? 'comparison',
    labels: groups.map((g) =>
      g.values
        .map((v) =>
          v.dim === 'comparison' || v.dim === 'feature' || v.dim === 'show'
            ? String(v.value)
            : ctxLabel(v.dim, v.value)
        )
        .join(' · ')
    ),
    rowOf,
    bars: new Map()
  }
  acrossCache.set(fitted, a)
  return a
}
/** A gene's bars across the contexts — the same object per gene, so the plot isn't rebuilt on
 *  every render. */
function geneAcross(
  fitted: { rows: readonly CompareResultRow[] },
  numeric: NumericConds,
  gene: string
): AcrossBars {
  const a = acrossOf(fitted, numeric)
  let out = a.bars.get(gene)
  if (!out) {
    const at = a.rowOf.get(gene)
    out = {
      ...(a.by ? { by: a.by } : null),
      title: a.title,
      items: a.labels.map((label, k) => ({
        at: label,
        row: at && at[k] >= 0 ? rowsAt(fitted, [at[k]])[0] : undefined
      }))
    }
    a.bars.set(gene, out)
  }
  return out
}

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
  // The parameters are the description's: the detector (spline) has none.
  if (modelViewOf(upCfg) === 'detector' && hasResponseFits(fitted))
    return <Empty text={DETECTOR_NO_PARAMS} />
  // a tile placed before its fit came out as one curve per gene: why it draws nothing
  const unmet = unmetRequirement('metrics', cfg, factsOf(upstream))
  if (unmet) return <Empty text={unmet} />
  // the result's cached distinct ids (distinctOf): the same set render to render, not a copy
  const present = distinctOf(fitted, 'uniqID') as ReadonlySet<string>
  // (a metric no longer offered — one saved before — falls back to the potency)
  const metric: MetricId =
    cfg.metric && (METRIC_IDS as readonly string[]).includes(cfg.metric) ? cfg.metric : 'potency'
  // the axis the curves run along: its unit names an EC50, its molar scale a pEC50
  const ctx = curveAxisUnit(upCfg, units)
  // Δ from the reference slice: a 2-D fit's only (a curve has no reference)
  const surfaces = someNested(fitted, 'rs', 'axis', (_, a) => a === 'surface')
  const show = surfaces && cfg.show === 'delta' ? 'delta' : 'value'
  // force pEC50: flat curves at 0 (else none)
  const flat = cfg.forcePEC50 ? { flat: 'zero' as const } : null
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
            {(gene) =>
              surfaces ? (
                // a surface: its slices are its bars, one context (tab) at a time
                <FacetedPlot numeric={numeric} rows={{ of: fitted }} facetSel={facetSel}>
                  {(rows) => (
                    <MetricBarsView
                      row={rows.find((r) => r.uniqID === gene)}
                      metric={metric}
                      ctx={{ ...ctx, delta: show === 'delta', ...flat }}
                      condTitle={condTitle}
                    />
                  )}
                </FacetedPlot>
              ) : (
                // one-axis curves: one bar per context — every comparison and condition level
                <MetricBarsView
                  across={geneAcross(fitted, numeric, gene)}
                  metric={metric}
                  ctx={{ ...ctx, delta: false, ...flat }}
                  condTitle={condTitle}
                />
              )
            }
          </GeneSwitch>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
