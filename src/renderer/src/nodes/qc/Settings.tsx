import { type ReactNode, useMemo } from 'react'
import { useGraph } from '../../graph/store'
import {
  conditionColoring,
  conditionColorWrite,
  numericOfResult,
  primaryColorLevels,
  qcColorBy,
  type QcConfig
} from '../../graph/types'
import { QC_FILL } from '../../ui/theme'
import { ToggleSwitch } from '../../ui/ToggleSwitch'
import { ColorChip, Field, QuickToggle, SampleOrderField, Select } from '../kit/settings/controls'
import { CONDS } from '../kit/settings/hooks'
import {
  CategoricalRows,
  ColorFadeFields,
  type PlotPanelProps,
  PlotSections
} from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'
import { qcPlotOptions } from './model'

export function QcPanel({ config, update, edgeNodeId }: PlotPanelProps<QcConfig>) {
  const plotOpts = qcPlotOptions(config.metric)
  const plot = plotOpts.includes(config.plot) ? config.plot : plotOpts[0]
  // The conditions the upstream Clean data carries, to colour by (as the gene bar does).
  const upstream = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === edgeNodeId)?.source
    return upId ? s.results[upId] : undefined
  })
  const active = useMemo(
    () => (upstream?.kind === 'standardize' ? upstream.std.activeConditions : CONDS),
    [upstream]
  )
  // the primary colour condition's levels, for the colouring's default (condColorByDefault)
  const levels = upstream?.kind === 'standardize' ? primaryColorLevels(upstream.std) : 0
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
  const byCondition = qcColorBy(config, levels) === 'condition'
  // the colour and fade picked (or the default), as the fields show them
  const coloring = conditionColoring(config, active, numeric)
  const color = config.color ?? QC_FILL
  return (
    <PlotSections
      general={
        <>
          <div style={styles.hint}>
            Per-sample quality: intensity distribution, %CV, or protein count.
          </div>
          <Field
            label="metric"
            aside={<QuickToggle config={config} field="metric" update={update} />}
          >
            <Select
              value={config.metric}
              onChange={(v) => {
                const m = v as QcConfig['metric']
                const opts = qcPlotOptions(m)
                update({ metric: m, plot: opts.includes(config.plot) ? config.plot : opts[0] })
              }}
              options={[
                { value: 'intensity', label: 'intensity' },
                { value: 'cv', label: 'CV %' },
                { value: 'proteins', label: '# proteins' }
              ]}
            />
          </Field>
          {/* Proteins is bar-only, so the plot selector only appears for the distribution metrics. */}
          {plotOpts.length > 1 && (
            <Field
              label="plot"
              aside={<QuickToggle config={config} field="plot" update={update} />}
            >
              <Select
                value={plot}
                onChange={(v) => update({ plot: v as QcConfig['plot'] })}
                options={plotOpts.map((o) => ({ value: o, label: o }))}
              />
            </Field>
          )}
          <SampleOrderField config={config} update={update} />
        </>
      }
      // the count axis' range: a whole-plot row of Axes and lines
      axes={
        config.metric === 'proteins' && (
          <Field
            label="axis scale"
            aside={<QuickToggle config={config} field="yScale" update={update} />}
          >
            <Select
              value={config.yScale ?? 'global'}
              onChange={(v) => update({ yScale: v as QcConfig['yScale'] })}
              options={[
                { value: 'range', label: 'adjusted (fit to the counts)' },
                { value: 'global', label: 'global (from 0)' }
              ]}
            />
          </Field>
        )
      }
      colours={
        <CategoricalRows config={config} update={update}>
          {/* What the samples are coloured by — by condition (the picks below), or one colour — and,
              for one colour, which. The mode is its own switch, not hidden in the colour square. */}
          <Field label="colour by">
            <ToggleSwitch
              label="Colour by"
              value={byCondition ? 'condition' : 'single'}
              options={[
                { value: 'condition', label: 'condition' },
                { value: 'single', label: 'one colour' }
              ]}
              onChange={(v) =>
                v === 'single'
                  ? update({ colorBy: 'single', color })
                  : // (what was picked before, else the default: conditionColoring)
                    update({ colorBy: 'condition' })
              }
            />
          </Field>
          {!byCondition && (
            <Field label="colour">
              <ColorChip
                color={color}
                on
                label="QC colour"
                title="QC colour"
                onPick={(c) => update({ colorBy: 'single', color: c })}
              />
            </Field>
          )}
          {byCondition && (
            <ColorFadeFields
              active={active}
              numeric={numeric}
              picks={coloring.picks}
              fade={coloring.fade}
              onChange={(picks, fade) => update(conditionColorWrite(picks, fade))}
            />
          )}
        </CategoricalRows>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <QcPanel config={config as QcConfig} {...props} />
}
