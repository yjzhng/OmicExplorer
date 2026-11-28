import type { ReactNode } from 'react'
import type { MAConfig } from '../../graph/config/pointPlots'
import { CapRow } from '../kit/settings/controls'
import { legendShown, useEffectColors, useEffectNames } from '../kit/settings/plotHooks'
import {
  ColourRows,
  type PlotPanelProps,
  PlotSections,
  PointStyleSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

export function MAPanel({ config, update, edgeNodeId }: PlotPanelProps<MAConfig>): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(config.fcPalette)
  return (
    <PlotSections
      general={
        <>
          {/* The fold-change lines are driven by (and drag) the upstream Compare's threshold —
              shared with volcano — so there are no per-tile FC cutoffs to set here. */}
          <div style={styles.hint}>Fold-change lines follow the upstream Compare threshold.</div>
        </>
      }
      ranking={
        <CapRow
          label="Label limit"
          info="Name only the genes with the largest fold change."
          field="labelTop"
          value={config.labelTop ?? 0}
          enabled={config.capEnabled}
          update={update}
          rule={(n) => `Label the top ${n} genes by |log₂FC|.`}
        />
      }
      marks={
        <PointStyleSections
          kind="ma"
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
  return <MAPanel config={config as MAConfig} {...props} />
}
