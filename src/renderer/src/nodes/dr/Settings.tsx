import { type ReactNode } from 'react'
import { useGraph } from '../../graph/store'
import { DR_DETAIL_CAP, type DRConfig, drYScale } from '../../graph/config/dr'
import { isComparisonKind, isStep } from '../../graph/types'
import { CapRow, Field, QuickToggle, Select } from '../kit/settings/controls'
import {
  CategoricalSelect,
  ColourRows,
  DRStyleSection,
  Ec50LineField,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
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
      general={
        fromCompare && (
          <Field label="view" aside={<QuickToggle config={config} field="view" update={update} />}>
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
        )
      }
      // Top genes is a setting OF the global and detailed views (which of the every-gene curves
      // are coloured — or, detailed, drawn), so it's offered only there.
      ranking={
        fromCompare &&
        config.view !== 'focus' && (
          <CapRow
            info={
              detailed
                ? `Draw only the top genes by response (up to ${DR_DETAIL_CAP}); picked from the selected genes while any are selected.`
                : 'Colour only the top genes by response — every gene stays drawn in the background. Selected genes are coloured instead while any are selected.'
            }
            label="Max genes"
            field="topGenes"
            value={config.topGenes}
            enabled={config.capEnabled}
            update={update}
            split={config}
            defaultValue={10}
            max={detailed ? DR_DETAIL_CAP : undefined}
            rule={(n) =>
              detailed
                ? `Draw the top ${n} genes by response.`
                : `Colour the top ${n} genes by response.`
            }
            step={10}
          />
        )
      }
      // the axis' range and the pEC50 line: whole-plot rows of Axes and lines
      axes={
        <>
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
          {curveFit && (focused || detailed) && <Ec50LineField config={config} update={update} />}
        </>
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
      colours={
        <ColourRows config={config} update={update} edgeNodeId={edgeNodeId}>
          {/* the lines' own colours: a gene each (global, detailed), a comparison each (focused,
              several), a side each (from a Contrast) — the Lines section's Automatic */}
          <Field label="line palette">
            <CategoricalSelect
              config={config as unknown as Record<string, unknown>}
              update={update}
            />
          </Field>
        </ColourRows>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <DRPanel config={config as DRConfig} {...props} />
}
