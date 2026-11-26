import { useMemo, type ReactNode } from 'react'
import {
  condLabel,
  interactionAxes,
  isNumericCond,
  numericConds,
  type AnovaFactor
} from '../../engine'
import { useGraph } from '../../graph/store'
import {
  interactionDim,
  interactionDimWhy,
  interactionShow,
  interactionShowWhy,
  type InteractionConfig,
  type InteractionShape
} from '../../graph/types'
import { ToggleSwitch } from '../../ui/ToggleSwitch'
import { Field, QuickToggle, Select } from '../kit/settings/controls'
import { DRStyleSection, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

/** An ANOVA's interaction plot: its two factors, the view (2D / 3D) and what it shows, and its
 *  look (the DR plot's). */
export function InteractionPanel({
  config,
  update,
  edgeNodeId
}: PlotPanelProps<InteractionConfig>) {
  // the model's factors, from the upstream's result (unknown until it has run), and its numeric
  // conditions (a surface needs both factors numeric)
  const factors = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'compare' ? r.cmp.anova?.factors : undefined
  })
  const numericList = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'compare' ? r.numericConditions : undefined
  })
  const numeric = useMemo(() => numericConds(numericList ?? []), [numericList])
  const axes = factors ? interactionAxes({ factors }, config.xFactor, config.lineFactor) : null
  const options = (factors ?? []).map((f) => ({
    value: f.condition,
    label: condLabel(f.condition)
  }))
  // picking for factor 1 factor 2's (or for factor 2 factor 1's) swaps the two
  const xNow = factors && axes ? factors[axes.x].condition : undefined
  const lineNow = factors && axes?.line != null ? factors[axes.line].condition : undefined
  const isNum = (f: AnovaFactor): boolean => !!f.x || isNumericCond(f.condition, numeric)
  const shape: InteractionShape = {
    two: axes?.line != null,
    numeric:
      !!factors &&
      !!axes &&
      axes.line != null &&
      isNum(factors[axes.x]) &&
      isNum(factors[axes.line])
  }
  const dim = interactionDim(config, shape)
  const show = interactionShow(config, shape)
  return (
    <PlotSections
      general={
        <>
          <Field label="view" aside={<QuickToggle config={config} field="dim" update={update} />}>
            <ToggleSwitch
              label="View"
              value={dim}
              options={(['2d', '3d'] as const).map((v) => ({
                value: v,
                label: v.toUpperCase(),
                disabled: !!interactionDimWhy(v, shape),
                title: interactionDimWhy(v, shape)
              }))}
              onChange={(v) => update({ dim: v })}
            />
          </Field>
          <Field label="show" aside={<QuickToggle config={config} field="show" update={update} />}>
            <Select
              value={show}
              options={(['line', 'surface', 'heatmap'] as const).map((v) => {
                const why = interactionShowWhy(dim, v, shape)
                return {
                  value: v,
                  label: why
                    ? `${v} (${v === 'heatmap' ? '2D only' : dim === '2d' ? '3D only' : 'numeric factors only'})`
                    : v,
                  disabled: !!why
                }
              })}
              onChange={(v) => update({ show: v as InteractionConfig['show'] })}
            />
          </Field>
          {factors && factors.length >= 2 && (
            <Field
              label="factor 1"
              aside={<QuickToggle config={config} field="xFactor" update={update} />}
            >
              <Select
                value={xNow!}
                onChange={(v) =>
                  update({ xFactor: v, ...(v === lineNow ? { lineFactor: xNow } : null) })
                }
                options={options}
              />
            </Field>
          )}
          {factors && factors.length >= 2 && (
            <Field
              label="factor 2"
              aside={<QuickToggle config={config} field="lineFactor" update={update} />}
            >
              {/* none: factor 1's effect alone, every other factor averaged */}
              <Select
                value={lineNow ?? 'none'}
                onChange={(v) =>
                  update({
                    lineFactor: v as InteractionConfig['lineFactor'],
                    ...(v === xNow && lineNow ? { xFactor: lineNow } : null)
                  })
                }
                options={[
                  ...options,
                  {
                    value: 'none',
                    label: dim === '3d' ? 'none (2D only)' : 'none (factor 1 alone)',
                    disabled: dim === '3d'
                  }
                ]}
              />
            </Field>
          )}
        </>
      }
      marks={
        <DRStyleSection
          config={config}
          update={update}
          focused
          detailed={false}
          fromContrast={false}
          curveFit={false}
          texts={{
            autoLine: 'one per level of factor 2',
            points: 'Each cell’s replicates',
            error: 'Each cell mean’s standard error (the model’s residual variance)'
          }}
        />
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <InteractionPanel config={config as InteractionConfig} {...props} />
}
