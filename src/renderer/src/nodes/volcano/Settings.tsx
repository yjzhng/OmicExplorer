import { type ReactNode } from 'react'
import { stepTitle } from '../../graph/registry'
import { isComparisonKind, isStep } from '../../graph/types'
import { type CompareConfig, normalizeCompareConfig } from '../../graph/config/compare'
import type { VolcanoConfig } from '../../graph/config/pointPlots'
import { CompareStatisticSection } from '../kit/settings/compareSections'
import { CapRow, Field } from '../kit/settings/controls'
import { UI } from '../../ui/app/theme'
import { OnOffSwitch } from '../../ui/controls/ToggleSwitch'
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
  const stat =
    compare &&
    normalizeCompareConfig(compare.data.config as CompareConfig).threshold.statType === 'pQ'
      ? 'q-value'
      : 'p-value'
  const sym = stat === 'q-value' ? 'q' : 'p'
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
        // genes with a fold change but no p-value (too few values, a reference protein): left out,
        // or drawn on the x axis — −log₁₀ of the Compare's stat at 0, i.e. it read as 1. The words
        // after the switch say which.
        <Field label={`force ${stat}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <OnOffSwitch
              on={!!config.untestedAtZero}
              label={`Force ${stat}`}
              onChange={(on) => update({ untestedAtZero: on || undefined })}
            />
            <span style={{ color: UI.textMuted, fontSize: 12, whiteSpace: 'nowrap' }}>
              {config.untestedAtZero ? `n/a data at −log₁₀ ${sym} = 0` : 'n/a data hidden'}
            </span>
          </div>
        </Field>
      }
      ranking={
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
