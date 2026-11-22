import { type ReactNode } from 'react'
import { CORR_METRIC_LABEL, CORR_METRICS, corrMetricOf, type CorrMetric } from '../../engine'
import type { CorrConfig } from '../../graph/types'
import { toPaletteRef } from '../../ui/palettes'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { useRolePalette } from '../../ui/useAppSettings'
import { Field, QuickToggle, SampleOrderField, Select } from '../kit/settings/controls'
import { autoOf } from '../kit/settings/plotHooks'
import { PanelPaletteSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

/** What each metric asks: the metric row's (i) tip. */
const METRIC_HINT: Record<CorrMetric, string> = {
  pearson:
    'Do the two samples fall on a straight line? Near 1 for almost any pair: the shared abundance range dominates, so a minority of changed proteins barely moves it.',
  spearman:
    'Do the two samples rank the proteins in the same order? Robust to outliers; usually close to Pearson.',
  ccc: 'Are the two samples the same values (on the identity line)? Like Pearson, but a shift or stretch between them (loading, normalisation) counts against it.'
}

export function CorrPanel({ config, update }: PlotPanelProps<CorrConfig>) {
  const corrRole = useRolePalette('corr')
  const cluster = config.cluster ?? true
  return (
    <PlotSections
      general={
        <>
          <div style={styles.hint}>All-samples × all-samples: each pair scored by the metric.</div>
          <Field
            label="metric"
            // the row's explanation is its (i) tip: what the metric picked asks
            info={METRIC_HINT[corrMetricOf(config.metric)]}
            aside={<QuickToggle config={config} field="metric" update={update} kind="corr" />}
          >
            {/* a dropdown: four names don't fit a switch beside the quick-access toggle */}
            <Select
              value={corrMetricOf(config.metric)}
              onChange={(v) => update({ metric: v as CorrMetric })}
              options={CORR_METRICS.map((m) => ({ value: m, label: CORR_METRIC_LABEL[m] }))}
            />
          </Field>
          <Field label="cluster">
            <OnOffSwitch
              on={cluster}
              label="Cluster samples"
              title="Order the samples by their correlation profile, so replicate groups block on the diagonal"
              onChange={(v) => update({ cluster: v })}
            />
          </Field>
          {/* Clustering sets its own order; the sample order is for the unclustered matrix. */}
          {cluster ? (
            <div style={styles.hint}>Clustered: the clustering orders the samples.</div>
          ) : (
            <SampleOrderField config={config} update={update} kind="corr" />
          )}
        </>
      }
      colours={
        <>
          <Field label="palette">
            <PanelPaletteSelect
              value={toPaletteRef(config.palette)}
              onChange={(v) => update({ palette: v })}
              auto={autoOf(corrRole)}
            />
          </Field>
        </>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <CorrPanel config={config as CorrConfig} {...props} />
}
