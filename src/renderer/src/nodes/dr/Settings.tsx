import { type ReactNode } from 'react'
import { useGraph } from '../../graph/store'
import {
  capOn,
  DR_DETAIL_CAP,
  type DRConfig,
  drYScale,
  isComparisonKind,
  isStep
} from '../../graph/types'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import { Field, NumberInput, QuickToggle, Section, Select } from '../kit/settings/controls'
import {
  ColourSection,
  DRStyleSection,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

export function DRPanel({ config, update, edgeNodeId }: PlotPanelProps<DRConfig>) {
  // Its axis (a numeric condition) is the plot's own — one Response plot per condition — so it's
  // never offered here.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  // From a Contrast the tile shows one gene at a time, so its value axis can be per gene.
  const fromContrast = useGraph((s) => {
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return !!up && isStep(up) && up.data.kind === 'contrast'
  })
  // From a Compare or a Curve fit: every gene at once, or one gene at a time (with its points /
  // fitted curve).
  const fromCompare = useGraph((s) => {
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return !!up && isStep(up) && isComparisonKind(up.data.kind)
  })
  // A curve fit's error is its fit's confidence band, not a fold change's SE.
  const curveFit = useGraph((s) => {
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return !!up && isStep(up) && up.data.kind === 'curveFit'
  })
  const focused = fromContrast || config.view === 'focus'
  // The detailed view: the global view's coloured genes, each drawn as the focused view draws one.
  const detailed = fromCompare && config.view === 'detail'
  return (
    <PlotSections
      show={
        (fromContrast || fromCompare) && (
          <Section title="Response">
            {fromCompare && (
              <Field
                label="view"
                aside={<QuickToggle config={config} field="view" update={update} />}
              >
                <Select
                  value={config.view ?? 'overview'}
                  onChange={(v) => update({ view: v as DRConfig['view'] })}
                  options={[
                    { value: 'overview', label: 'global (every gene)' },
                    { value: 'detail', label: 'detailed (the coloured genes, in full)' },
                    { value: 'focus', label: 'focused (one gene)' }
                  ]}
                />
              </Field>
            )}
            {/* Top genes is a setting OF the global view (it only decides which of the every-gene
                        curves are coloured — or, detailed, which are drawn), so it sits under view and goes
                        away when focused. */}
            {fromCompare && config.view !== 'focus' && (
              <div style={styles.subGroup}>
                <Field label="top genes">
                  <OnOffSwitch
                    on={capOn(config.capEnabled, config.topGenes)}
                    label="Top genes"
                    onChange={(next) =>
                      // First switch-on with no N yet → a sensible starting point.
                      update({
                        capEnabled: next,
                        ...(next && !(config.topGenes > 0) ? { topGenes: 10 } : null)
                      })
                    }
                  />
                </Field>
                {capOn(config.capEnabled, config.topGenes) && (
                  <Field label="n">
                    <div style={{ width: 90 }}>
                      <NumberInput
                        value={config.topGenes}
                        step={10}
                        min={1}
                        onChange={(v) => update({ topGenes: Math.max(1, Math.round(v)) })}
                      />
                    </div>
                  </Field>
                )}
                <div style={styles.hint}>
                  {detailed ? (
                    <>
                      {capOn(config.capEnabled, config.topGenes)
                        ? `Draw the top ${config.topGenes} genes by response`
                        : 'Draw the top genes by response'}
                      {` (up to ${DR_DETAIL_CAP})`}; picked from the selected genes while any are
                      selected.
                    </>
                  ) : (
                    <>
                      {capOn(config.capEnabled, config.topGenes)
                        ? `Colour the top ${config.topGenes} genes by response`
                        : 'Colour every significant gene'}
                      ; every gene stays drawn in the background. Selected genes are coloured
                      instead while any are selected.
                    </>
                  )}
                </div>
              </div>
            )}
            {(fromContrast || (fromCompare && (focused || detailed))) && (
              <Field
                label="axis scale"
                aside={<QuickToggle config={config} field="yScale" update={update} />}
              >
                <Select
                  value={drYScale(config, fromContrast)}
                  onChange={(v) => update({ yScale: v as DRConfig['yScale'] })}
                  options={[
                    { value: 'gene', label: 'adjusted (each gene’s own range)' },
                    {
                      value: 'global',
                      label: fromContrast ? 'global (whole contrast)' : 'global (all genes)'
                    }
                  ]}
                />
              </Field>
            )}
          </Section>
        )
      }
      marks={
        <DRStyleSection
          config={config}
          update={update}
          focused={focused}
          detailed={detailed}
          fromContrast={fromContrast}
          curveFit={curveFit}
        />
      }
      colours={<ColourSection config={config} update={update} edgeNodeId={edgeNodeId} />}
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <DRPanel config={config as DRConfig} {...props} />
}
