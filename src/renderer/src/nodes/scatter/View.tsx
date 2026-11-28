import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import {
  buildIntensityScatter,
  buildScatter,
  contrastFeatureLabel,
  contrastStatDrag,
  cutoffFromScale,
  roundP,
  upperOnly,
  type AxisTail,
  type ContrastFeatureId,
  type ContrastResultRow
} from '../../engine'
import { useGraph } from '../../graph/store'
import { type CompareConfig, effectLabelsOf } from '../../graph/config/compare'
import { labelCapOn, type ScatterConfig } from '../../graph/config/pointPlots'
import type { ContrastConfig } from '../../graph/config/contrast'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { ScatterView } from './ScatterView'

/** The scatter result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function scatterView(v: ViewContext): ReactNode {
  const {
    cfgSource,
    upstream,
    numeric,
    facetSel,
    quantityScale,
    quantityUnit,
    quantityPlain,
    plainScale,
    upStep,
    effectsOf,
    contrastSource
  } = v
  const cfg = cfgSource as ScatterConfig
  // A Compare plots the two compared groups' log10 intensities (mean1 vs mean2); a
  // Contrast plots FC1 vs FC2. Either way the upstream supplies the significance.
  if (upstream?.kind === 'compare') {
    const dm = upstream.displayMap
    return (
      <div style={styles.chart}>
        <FacetedPlot numeric={numeric} rows={{ of: upstream.cmp }} facetSel={facetSel}>
          {(rows) => (
            <Built
              name="intensityScatter"
              build={() =>
                buildIntensityScatter(rows, {
                  displayMap: dm,
                  scale: quantityScale,
                  unit: quantityUnit,
                  plain: quantityPlain
                })
              }
              deps={[rows, dm, quantityScale, quantityUnit, quantityPlain]}
            >
              {(scatter) => (
                <ScatterView
                  scatter={scatter}
                  labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                  style={cfg.style}
                  effectLabels={effectLabelsOf(upStep?.data.config as CompareConfig | undefined)}
                  effectColors={effectsOf(cfg)}
                  plainScale={plainScale}
                />
              )}
            </Built>
          )}
        </FacetedPlot>
      </div>
    )
  }
  if (upstream?.kind !== 'contrast')
    return <Empty text="Connect a Compare or Contrast tile and run it." />
  const dm = upstream.displayMap
  // Dragging a guide live-re-calls the upstream Contrast (as a volcano's drag re-calls its
  // Compare): the new cutoff, written the way its Statistic panel writes it.
  const ctrStep = upStep?.data.kind === 'contrast' ? upStep : undefined
  const ctrStat = (ctrStep?.data.config as ContrastConfig | undefined)?.stat
  // An axis line's value is the facet's feature's (an abundance's own, back in log₁₀ as it's
  // cut); a significance line reads as the p it stands for.
  const abundance = upstream.ctr.valueKind === 'quantity'
  const statDrag = (feature: ContrastFeatureId) =>
    ctrStep
      ? (edge: 'bandUp' | 'bandDown' | AxisTail, value: number) =>
          useGraph
            .getState()
            .setContrastStat(
              ctrStep.id,
              contrastStatDrag(
                ctrStat,
                edge,
                abundance && feature === 'value' && edge !== 'bandUp' && edge !== 'bandDown'
                  ? cutoffFromScale(value, quantityScale)
                  : value,
                feature
              )
            )
      : undefined
  return (
    <div style={styles.chart}>
      <FacetedPlot numeric={numeric} rows={contrastSource(upstream)} facetSel={facetSel}>
        {(rows) => (
          <Built
            name="scatter"
            build={() =>
              buildScatter(rows, {
                displayMap: dm,
                valueKind: upstream.ctr.valueKind,
                scale: quantityScale,
                unit: quantityUnit,
                valueLabel: contrastFeatureLabel(rows),
                plain: quantityPlain
              })
            }
            deps={[rows, dm, upstream.ctr.valueKind, quantityScale, quantityUnit, quantityPlain]}
          >
            {(scatter) => (
              <ScatterView
                scatter={scatter}
                labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                style={cfg.style}
                onStatDrag={statDrag(featureOf(rows))}
                // an abundance contrast's own values (not another feature of it) shown plain
                plainScale={abundance && !contrastFeatureLabel(rows) ? plainScale : undefined}
                asymmetric={ctrStat?.asymmetric ?? false}
                cutText={
                  upperOnly(featureOf(rows))
                    ? rows.some((r) => r.feature?.endsWith('q'))
                      ? qText
                      : pText
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
/** A significance line's value (−log₁₀ p or q) as the p or q it stands for. */
export const pText = (v: number): string => `p ≤ ${roundP(10 ** -v)}`
export const qText = (v: number): string => `q ≤ ${roundP(10 ** -v)}`
/** The feature a contrast facet's rows show (the sides' own value when it offers one). */
export const featureOf = (rows: ContrastResultRow[]): ContrastFeatureId =>
  rows.find((r) => r.featureId)?.featureId ?? 'value'
