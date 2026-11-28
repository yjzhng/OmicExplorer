import type { ReactNode } from 'react'
import type { PotencyConfig } from '../../graph/config/dr'
import { OnOffSwitch } from '../../ui/controls/ToggleSwitch'
import { CapRow, Field, QuickToggle, Select } from '../kit/settings/controls'
import { legendShown, useEffectColors, useEffectNames } from '../kit/settings/plotHooks'
import {
  ColourRows,
  type PlotPanelProps,
  PlotSections,
  PointStyleSections
} from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

export function PotencyPanel({
  config,
  update,
  edgeNodeId
}: PlotPanelProps<PotencyConfig>): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(config.fcPalette)
  return (
    <PlotSections
      general={
        <>
          <Field
            label="curves"
            aside={<QuickToggle config={config} field="show" update={update} />}
          >
            <Select
              value={config.show ?? 'all'}
              onChange={(v) => update({ show: v as PotencyConfig['show'] })}
              options={[
                { value: 'called', label: 'significant only' },
                { value: 'all', label: 'all' }
              ]}
            />
          </Field>
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
        </>
      }
      ranking={
        <CapRow
          label="Label limit"
          info="Name only the curves with the largest fold change."
          field="labelTop"
          value={config.labelTop}
          enabled={config.capEnabled}
          update={update}
          rule={(n) => `Label the top ${n} curves by |fold change|.`}
        />
      }
      marks={
        <PointStyleSections
          kind="potency"
          names={names}
          colors={colors}
          style={config.style}
          legend={legendShown(config)}
          update={update}
        />
      }
      colours={<ColourRows config={config} update={update} edgeNodeId={edgeNodeId} />}
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <PotencyPanel config={config as PotencyConfig} {...props} />
}
