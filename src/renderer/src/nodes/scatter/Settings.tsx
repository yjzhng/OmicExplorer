import { type ReactNode } from 'react'
import { stepTitle } from '../../graph/registry'
import {
  isComparisonKind,
  isStep,
  normalizeCompareConfig,
  type CompareConfig,
  type ContrastConfig,
  type ScatterConfig
} from '../../graph/types'
import { CompareStatisticSection } from '../kit/settings/compareSections'
import { ContrastStatPanel } from '../kit/settings/contrastSections'
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

export function ScatterPanel({ config, update, edgeNodeId }: PlotPanelProps<ScatterConfig>) {
  const names = useEffectNames(edgeNodeId)
  const colors = useEffectColors(config.fcPalette)
  // An independent (linear cutoff) contrast colours by quadrant, so the look is per quadrant group.
  const up = useUpstreamNode(edgeNodeId)
  const contrast = up && isStep(up) && up.data.kind === 'contrast' ? up : undefined
  const compare = up && isStep(up) && isComparisonKind(up.data.kind) ? up : undefined
  const quad = !!contrast && (contrast.data.config as ContrastConfig).relationship === 'independent'
  return (
    <PlotSections
      // The statistic behind the colours, written to the step that computes it (as the volcano
      // offers its Compare's) — so the calls can be tuned from the plot that shows them.
      statistic={
        <>
          {contrast && (
            <ContrastStatPanel
              id={contrast.id}
              config={contrast.data.config as ContrastConfig}
              subtitle={`from ${stepTitle(contrast)}`}
              tab={edgeNodeId}
            />
          )}
          {compare && (
            <CompareStatisticSection
              id={compare.id}
              config={normalizeCompareConfig(compare.data.config as CompareConfig)}
              subtitle={`from ${stepTitle(compare)}`}
            />
          )}
        </>
      }
      ranking={
        <CapRow
          label="Label limit"
          info="Name only the most divergent genes."
          field="labelTop"
          value={config.labelTop}
          enabled={config.capEnabled}
          update={update}
          rule={(n) => `Label the top ${n} significant genes by |FC difference|.`}
        />
      }
      marks={
        <PointStyleSections
          kind={quad ? 'scatterQuad' : 'scatter'}
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
  return <ScatterPanel config={config as ScatterConfig} {...props} />
}
