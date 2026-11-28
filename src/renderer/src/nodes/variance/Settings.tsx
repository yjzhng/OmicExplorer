import { type ReactNode } from 'react'
import type { VarianceConfig } from '../../graph/config/anovaPlots'
import { Field, NumberInput, QuickToggle, Select } from '../kit/settings/controls'
import { type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

/** An ANOVA's variance plot: its view, and how many genes the detailed view shows. */
export function VariancePanel({ config, update }: PlotPanelProps<VarianceConfig>) {
  const view = config.view ?? 'overview'
  return (
    <>
      <Field label="view" aside={<QuickToggle config={config} field="view" update={update} />}>
        <Select
          value={view}
          onChange={(v) => update({ view: v as VarianceConfig['view'] })}
          options={[
            { value: 'overview', label: 'global (every gene, per factor)' },
            { value: 'detail', label: 'detailed (genes side by side)' },
            { value: 'focus', label: 'focused (one gene)' }
          ]}
        />
      </Field>
      <div style={styles.hint}>
        {view === 'overview'
          ? 'Each factor’s share of every gene’s variation, as a violin per factor — which factor drives this dataset.'
          : view === 'detail'
            ? 'The selected genes’ shares, else the most significant genes’ (smallest q of any factor), up to 60.'
            : 'One gene’s shares, each factor’s q beside it — a share says how the change splits, the q whether it’s above noise.'}
      </div>
    </>
  )
}

/** The detailed view's gene count (always capped: up to 60 side by side). */
function VarianceGenes({ config, update }: PlotPanelProps<VarianceConfig>): ReactNode {
  return (
    <Field
      label="Max genes"
      info="The detailed view draws this many genes side by side (up to 60)."
    >
      <div style={{ width: 90 }}>
        <NumberInput
          value={config.topGenes || 20}
          step={5}
          min={1}
          max={60}
          onChange={(v) => update({ topGenes: Math.max(1, Math.min(60, Math.round(v))) })}
        />
      </div>
    </Field>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  const c = config as VarianceConfig
  return (
    <PlotSections
      general={<VariancePanel config={c} {...props} />}
      ranking={(c.view ?? 'overview') === 'detail' && <VarianceGenes config={c} {...props} />}
    />
  )
}
