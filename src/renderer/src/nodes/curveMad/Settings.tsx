import { type ReactNode } from 'react'
import { RESIDUAL_DOT_CAP } from '../../engine'
import { useGraph } from '../../graph/store'
import {
  CURVE_QC_DEFAULT_X,
  CURVE_QC_DEFAULT_Y,
  type CurveMadConfig,
  type CurveQcAxis,
  curveQcAxisOptions,
  curvesReplicatedOf
} from '../../graph/types'
import { useUpstreamFacts } from '../../graph/useUpstreamFacts'
import { CapRow, Field, QuickToggle, Select } from '../kit/settings/controls'
import { legendShown } from '../kit/settings/plotHooks'
import { type PlotPanelProps, PlotSections, PointStyleSections } from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

/** QC plots: the check, how it's drawn, the axis scale (the metrics check: its two metrics), and
 *  the look. By sample is offered only where it can differ from by dose (curvesReplicated of the
 *  upstream curve fit). */
export function CurveMadPanel({ config, update, edgeNodeId }: PlotPanelProps<CurveMadConfig>) {
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { result } = useUpstreamFacts(upId)
  const replicated = result?.kind === 'compare' ? curvesReplicatedOf(result.cmp) : true
  const check = config.check === 'sample' && !replicated ? 'dose' : (config.check ?? 'dose')
  const metrics = check === 'metrics'
  return (
    <PlotSections
      general={
        <>
          <Field
            label="check"
            aside={<QuickToggle config={config} field="check" update={update} />}
          >
            <Select
              value={check}
              onChange={(v) => update({ check: v as CurveMadConfig['check'] })}
              options={[
                { value: 'dose', label: 'dose' },
                ...(replicated ? [{ value: 'sample', label: 'sample' }] : []),
                { value: 'fitted', label: 'fitted' },
                { value: 'normality', label: 'normality' },
                { value: 'metrics', label: 'metrics (curve against curve)' }
              ]}
            />
          </Field>
          {metrics && (
            <>
              <Field label="x">
                <Select
                  value={config.metricX ?? CURVE_QC_DEFAULT_X}
                  onChange={(v) => update({ metricX: v as CurveQcAxis })}
                  options={curveQcAxisOptions(config.metricY ?? CURVE_QC_DEFAULT_Y, 'y')}
                />
              </Field>
              <Field label="y">
                <Select
                  value={config.metricY ?? CURVE_QC_DEFAULT_Y}
                  onChange={(v) => update({ metricY: v as CurveQcAxis })}
                  options={curveQcAxisOptions(config.metricX ?? CURVE_QC_DEFAULT_X, 'x')}
                />
              </Field>
            </>
          )}
          {!metrics && (
            <>
              <Field
                label="show"
                aside={<QuickToggle config={config} field="show" update={update} />}
              >
                <Select
                  value={config.show ?? 'dot'}
                  onChange={(v) => update({ show: v as CurveMadConfig['show'] })}
                  options={[
                    { value: 'violin', label: 'violin' },
                    { value: 'dot', label: 'dot' }
                  ]}
                />
              </Field>
            </>
          )}
        </>
      }
      // how many residuals the dot views draw (this plot's "how many are drawn")
      ranking={
        <CapRow
          info="Dot views draw only this many residuals, so they stay quick. Every outlier is kept; boxes, medians and trend lines use them all."
          label="Max residuals"
          field="maxPoints"
          value={config.maxPoints ?? RESIDUAL_DOT_CAP}
          enabled={config.capEnabled ?? true}
          update={update}
          defaultValue={RESIDUAL_DOT_CAP}
          max={RESIDUAL_DOT_CAP}
          rule={(n) =>
            `Draw at most ${n.toLocaleString()} residuals (up to ${RESIDUAL_DOT_CAP.toLocaleString()}).`
          }
          step={10}
        />
      }
      // the residual axis' range: an axis setting, for the whole plot
      axes={
        !metrics && (
          <Field
            label="axis scale"
            aside={<QuickToggle config={config} field="yScale" update={update} />}
          >
            <Select
              value={config.yScale ?? 'fit'}
              onChange={(v) => update({ yScale: v as CurveMadConfig['yScale'] })}
              options={[
                { value: 'fit', label: 'adjusted (99.9% of residuals, about 0)' },
                { value: 'range', label: 'global (every residual)' }
              ]}
            />
          </Field>
        )
      }
      marks={
        <PointStyleSections
          kind="curveMad"
          names={{ up: 'up', down: 'down' }}
          style={config.style}
          legend={legendShown(config)}
          update={update}
          selection={false}
        />
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <CurveMadPanel config={config as CurveMadConfig} {...props} />
}
