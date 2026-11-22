import type { ReactNode } from 'react'
import type { PotencyConfig } from '../../graph/types'
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
          <CapRow
            label="Label limit"
            info="Name only the curves with the largest fold change."
            field="labelTop"
            value={config.labelTop}
            enabled={config.capEnabled}
            update={update}
            rule={(n) => `Label the top ${n} curves by |fold change|.`}
          />
        </>
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
