import type { ReactNode } from 'react'
import { METRIC_IDS, METRIC_NAMES, type MetricId } from '../../graph/results/metricBars'
import type { MetricsConfig } from '../../graph/config/dr'
import { OnOffSwitch, ToggleSwitch } from '../../ui/controls/ToggleSwitch'
import { Field, QuickToggle, Select } from '../kit/settings/controls'
import { type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

/** The Curve metrics plot: which of the fit's parameters it draws (also the tile's switch). */
export function MetricsPanel({ config, update }: PlotPanelProps<MetricsConfig>): ReactNode {
  return (
    <>
      <Field
        label="metric"
        aside={<QuickToggle config={config} field="metric" update={update} />}
        info={
          <>
            The fitted parameter drawn for the gene on show: the potency (EC50 on a linear axis,
            pEC50 on a log one), the slope or a plateau. A 2-D fit’s per slice, one bar per level.
          </>
        }
      >
        <Select
          value={
            config.metric && (METRIC_IDS as readonly string[]).includes(config.metric)
              ? config.metric
              : 'potency'
          }
          onChange={(v) => update({ metric: v as MetricId })}
          options={METRIC_IDS.map((m) => ({ value: m, label: METRIC_NAMES[m] }))}
        />
      </Field>
      {(config.metric ?? 'potency') === 'potency' && (
        <Field
          label="force pEC50"
          info="A flat curve (its F-test doesn’t reject flat) has no midpoint, so no pEC50. On: placed at pEC50 0, the least potent."
        >
          <OnOffSwitch
            on={!!config.forcePEC50}
            label="Force pEC50"
            onChange={(on) => update({ forcePEC50: on || undefined })}
          />
        </Field>
      )}
      <Field
        label="show"
        aside={<QuickToggle config={config} field="show" update={update} />}
        info={
          <>
            A 2-D fit’s per-slice values <b>as they are</b>, or as their <b>change</b> (Δ) from the
            reference slice — the compared axis’s control level as the Curve fit sets it (dose 0:
            the vehicle’s curve), e.g. a melt’s Tm shift per dose. A curve has no reference: its
            values as they are.
          </>
        }
      >
        <ToggleSwitch
          label="Show"
          value={config.show ?? 'value'}
          options={[
            { value: 'value', label: 'value' },
            { value: 'delta', label: 'change' }
          ]}
          onChange={(v) => update({ show: v })}
        />
      </Field>
    </>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <PlotSections general={<MetricsPanel config={config as MetricsConfig} {...props} />} />
}
