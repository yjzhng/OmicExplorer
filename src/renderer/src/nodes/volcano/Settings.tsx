import { type ReactNode } from 'react'
import { stepTitle } from '../../graph/registry'
import {
  isComparisonKind,
  isStep,
  normalizeCompareConfig,
  type CompareConfig,
  type VolcanoConfig
} from '../../graph/types'
import { CompareStatisticSection } from '../kit/settings/compareSections'
import { CapRow } from '../kit/settings/controls'
import {
  legendShown,
  useEffectColors,
  useEffectNames,
  useUpstreamNode
} from '../kit/settings/plotHooks'
import {
  ColourRows,
  type PlotPanelProps,
  PlotSections,
  PointStyleSections
} from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

/** The y-axis stat and guide lines come from the upstream Compare's threshold, so its Statistic
 *  settings are offered here too — written to that Compare, and shared with every plot it feeds.
 *  Per tile there's the label cap and the look (per-group markers, highlight, legend). */
export function VolcanoPanel({ config, update, edgeNodeId }: PlotPanelProps<VolcanoConfig>) {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(config.fcPalette)
  const up = useUpstreamNode(edgeNodeId)
  const compare = up && isStep(up) && isComparisonKind(up.data.kind) ? up : undefined
  return (
    <PlotSections
      statistic={
        compare && (
          <CompareStatisticSection
            id={compare.id}
            config={normalizeCompareConfig(compare.data.config as CompareConfig)}
            // Says whose settings these are: changing them here changes the Compare itself.
            subtitle={`from ${stepTitle(compare)}`}
          />
        )
      }
      general={
        <CapRow
          label="Label limit"
          info="Name only the most significant genes."
          field="labelTop"
          value={config.labelTop}
          enabled={config.capEnabled}
          update={update}
          rule={(n) => `Label the top ${n} genes by significance.`}
        />
      }
      marks={
        <PointStyleSections
          kind="volcano"
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
  return <VolcanoPanel config={config as VolcanoConfig} {...props} />
}
