import type { ReactNode } from 'react'
import type { MAConfig } from '../../graph/types'
import { CapSection, Section } from '../kit/settings/controls'
import { legendShown, useEffectColors, useEffectNames } from '../kit/settings/plotHooks'
import {
  ColourSection,
  type PlotPanelProps,
  PlotSections,
  PointStyleSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

export function MAPanel({ config, update, edgeNodeId }: PlotPanelProps<MAConfig>): ReactNode {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(edgeNodeId, config.fcPalette)
  return (
    <PlotSections
      show={
        <Section title="MA">
          {/* The fold-change lines are driven by (and drag) the upstream Compare's threshold —
              shared with volcano — so there are no per-tile FC cutoffs to set here. */}
          <div style={styles.hint}>Fold-change lines follow the upstream Compare threshold.</div>
        </Section>
      }
      labels={
        <CapSection
          title="Cap labels"
          hint="Label only the genes with the largest fold change."
          label="Max labels"
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
      colours={<ColourSection config={config} update={update} edgeNodeId={edgeNodeId} />}
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <MAPanel config={config as MAConfig} {...props} />
}
