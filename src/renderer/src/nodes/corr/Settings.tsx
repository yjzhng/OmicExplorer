import { type ReactNode } from 'react'
import type { CorrConfig } from '../../graph/types'
import { toPaletteRef } from '../../ui/palettes'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { useRolePalette } from '../../ui/useAppSettings'
import { Field, SampleOrderField, Section } from '../kit/settings/controls'
import { autoOf } from '../kit/settings/plotHooks'
import { PanelPaletteSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

export function CorrPanel({ config, update }: PlotPanelProps<CorrConfig>) {
  const corrRole = useRolePalette('corr')
  const cluster = config.cluster ?? true
  return (
    <PlotSections
      show={
        <Section title="Correlation">
          <div style={styles.hint}>All-samples × all-samples Pearson correlation.</div>
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
        </Section>
      }
      colours={
        <Section title="Colour">
          <Field label="palette">
            <PanelPaletteSelect
              value={toPaletteRef(config.palette)}
              onChange={(v) => update({ palette: v })}
              auto={autoOf(corrRole)}
            />
          </Field>
        </Section>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <CorrPanel config={config as CorrConfig} {...props} />
}
