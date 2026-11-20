import { type ReactNode } from 'react'
import { condLabel, interactionAxes } from '../../engine'
import { useGraph } from '../../graph/store'
import type { InteractionConfig } from '../../graph/types'
import { Field, QuickToggle, Section, Select } from '../kit/settings/controls'
import { DRStyleSection, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

/** An ANOVA's interaction plot: the factors along x and as lines, and its look (the DR plot's). */
export function InteractionPanel({
  config,
  update,
  edgeNodeId
}: PlotPanelProps<InteractionConfig>) {
  // the model's factors, from the upstream's result (unknown until it has run)
  const factors = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    const r = upId ? s.results[upId] : undefined
    return r?.kind === 'compare' ? r.cmp.anova?.factors : undefined
  })
  const axes = factors ? interactionAxes({ factors }, config.xFactor, config.lineFactor) : null
  return (
    <PlotSections
      show={
        <Section title="Interaction">
          {factors && factors.length >= 2 && (
            <Field
              label="x axis"
              aside={<QuickToggle config={config} field="xFactor" update={update} />}
            >
              <Select
                value={factors[axes!.x].condition}
                onChange={(v) => update({ xFactor: v })}
                options={factors.map((f) => ({
                  value: f.condition,
                  label: condLabel(f.condition)
                }))}
              />
            </Field>
          )}
          {factors && factors.length >= 3 && axes?.line != null && (
            <Field label="lines">
              <Select
                value={factors[axes.line].condition}
                onChange={(v) => update({ lineFactor: v })}
                options={factors
                  .filter((_, i) => i !== axes.x)
                  .map((f) => ({ value: f.condition, label: condLabel(f.condition) }))}
              />
            </Field>
          )}
          <div style={styles.hint}>
            One gene at a time: each cell’s mean (the model’s fit) across the x factor, a line per
            level of the other, its replicates as points and the mean’s standard error. Parallel
            lines: no interaction; lines that diverge or cross: an interaction. With three or more
            factors, the others are averaged (the model’s marginal means). A slope along x is drawn
            to its scale: the model’s straight lines.
          </div>
        </Section>
      }
      marks={
        <DRStyleSection
          config={config}
          update={update}
          focused
          detailed={false}
          fromContrast={false}
          curveFit={false}
          texts={{
            autoLine: 'one per level of the line factor',
            points: 'Each cell’s replicates',
            error: 'Each cell mean’s standard error (the model’s residual variance)'
          }}
        />
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <InteractionPanel config={config as InteractionConfig} {...props} />
}
