import { type ReactNode, useMemo } from 'react'
import { useGraph } from '../../graph/store'
import {
  defaultColorConds,
  numericOfResult,
  primaryColorLevels,
  qcColorBy,
  qcColorConds,
  type QcConfig
} from '../../graph/types'
import { AUTO } from '../../ui/ColorPicker'
import { QC_FILL } from '../../ui/theme'
import {
  ColorChip,
  Field,
  QuickToggle,
  SampleOrderField,
  Section,
  Select
} from '../kit/settings/controls'
import { CONDS } from '../kit/settings/hooks'
import {
  CategoricalSection,
  ConditionColorFields,
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
  const color = config.color ?? QC_FILL
  return (
    <PlotSections
      show={
        <Section title="QC">
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
          {config.metric === 'proteins' && (
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
          )}
          <SampleOrderField config={config} update={update} />
        </Section>
      }
      colours={
        <CategoricalSection config={config} update={update}>
          {/* One chip, as the gene bar's replicate/error colours: Automatic colours by condition (the
                picks below), a picked colour fills every sample with it. */}
          <Field label="colour">
            <ColorChip
              color={byCondition ? AUTO : color}
              on
              label="QC colour"
              title={byCondition ? 'QC colour: automatic (by condition)' : 'QC colour'}
              onPick={(c) => update({ colorBy: 'single', color: c })}
              onAuto={() =>
                update({
                  colorBy: 'condition',
                  // Start from what was there, else the first categorical condition.
                  colorConds: config.colorConds?.length
                    ? config.colorConds
                    : defaultColorConds(active, numeric)
                })
              }
              autoLabel="Automatic (by condition)"
            />
          </Field>
          {byCondition && (
            <ConditionColorFields
              active={active}
              numeric={numeric}
              selected={qcColorConds(config, active, levels, numeric)}
              onChange={(next) => update({ colorConds: next })}
            />
          )}
        </CategoricalSection>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <QcPanel config={config as QcConfig} {...props} />
}
