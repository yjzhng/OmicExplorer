import { type ReactNode, useMemo } from 'react'
import { useGraph } from '../../graph/store'
import {
  barColorConds,
  type BarConfig,
  condColorByDefault,
  defaultColorConds,
  numericOfResult,
  primaryColorLevels
} from '../../graph/types'
import { AUTO } from '../../ui/ColorPicker'
import { UI } from '../../ui/theme'
import { OnOffSwitch } from '../../ui/ToggleSwitch'
import {
  ColorChip,
  Field,
  NumberInput,
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
import { type PlotSettingsProps } from '../settings'

export function GeneBarPanel({ config, update, edgeNodeId }: PlotPanelProps<BarConfig>): ReactNode {
  // The conditions the upstream data carries, to colour by (see ClusterPanel on selecting the
  // result rather than a fresh array).
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
  // the data's numeric conditions (its schema): what the fade can take
  const numeric = useMemo(() => numericOfResult(upstream), [upstream])
  const colorConds = barColorConds(config, active, levels, numeric)
  const byCondition =
    colorConds.length > 0 ||
    (config.colorBy ?? (condColorByDefault(levels) ? 'condition' : 'value')) === 'condition'
  const repColor = config.repColor ?? 'auto'
  const errorColor = config.errorColor ?? 'auto'
  return (
    <PlotSections
      show={
        <Section title="Bar">
          <Field
            label="axis scale"
            aside={<QuickToggle config={config} field="yScale" update={update} />}
          >
            <Select
              value={config.yScale ?? 'gene'}
              onChange={(v) => update({ yScale: v as BarConfig['yScale'] })}
              options={[
                { value: 'gene', label: 'adjusted (each gene’s own range)' },
                { value: 'global', label: 'global (all genes)' }
              ]}
            />
          </Field>
          <SampleOrderField config={config} update={update} label="condition order" />
        </Section>
      }
      marks={
        <Section title="Style">
          {/* Replicates as dots over the bars: on/off, then — while on — colour, size (px),
                opacity (%) and jitter, on one line like the error bar's. */}
          <Field label="replicate">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <OnOffSwitch
                on={!!config.replicates}
                label="Replicates"
                title="Each replicate as a dot over its bar"
                onChange={(v) => update({ replicates: v })}
              />
              {config.replicates && (
                <>
                  <ColorChip
                    color={repColor}
                    on
                    label="Replicate colour"
                    title={
                      repColor === AUTO
                        ? 'Replicate colour: automatic (the group colour)'
                        : 'Replicate colour'
                    }
                    onPick={(c) => update({ repColor: c })}
                    onAuto={() => update({ repColor: AUTO })}
                    autoLabel="Automatic (the group colour)"
                  />
                  <div style={{ width: 48, flex: '0 0 auto' }}>
                    <NumberInput
                      value={config.repSize ?? 6}
                      min={2}
                      max={16}
                      title="Dot size (px)"
                      onChange={(v) =>
                        update({ repSize: Math.min(16, Math.max(2, Math.round(v))) })
                      }
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      width: 64,
                      flex: '0 0 auto'
                    }}
                  >
                    <NumberInput
                      value={Math.round((config.repOpacity ?? 0.6) * 100)}
                      step={10}
                      min={10}
                      max={100}
                      title="Dot opacity (%)"
                      onChange={(v) =>
                        update({ repOpacity: Math.min(100, Math.max(10, Math.round(v))) / 100 })
                      }
                    />
                    <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
                  </div>
                  <span style={{ color: UI.textMuted, fontSize: 11, marginLeft: 2 }}>jitter</span>
                  <OnOffSwitch
                    on={config.repJitter ?? true}
                    label="Jittered"
                    title="Jittered: spread the dots sideways across the bar (off: one column over its centre)"
                    onChange={(v) => update({ repJitter: v })}
                  />
                </>
              )}
            </div>
          </Field>
          {/* One line: the error bars' colour, line width (px), then what they show. */}
          <Field label="error bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <ColorChip
                color={errorColor}
                on
                label="Error bar colour"
                title={
                  errorColor === AUTO
                    ? 'Error bar colour: automatic (the group colour)'
                    : 'Error bar colour'
                }
                onPick={(c) => update({ errorColor: c })}
                onAuto={() => update({ errorColor: AUTO })}
                autoLabel="Automatic (the group colour)"
              />
              <div style={{ width: 56, flex: '0 0 auto' }}>
                <NumberInput
                  value={config.errorWidth ?? 1.4}
                  step={0.5}
                  min={0.5}
                  max={6}
                  title="Error bar line width (px)"
                  onChange={(v) =>
                    update({ errorWidth: Math.min(6, Math.max(0.5, Math.round(v * 10) / 10)) })
                  }
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select
                  value={config.error ?? 'sd'}
                  onChange={(v) => update({ error: v as BarConfig['error'] })}
                  options={[
                    { value: 'sd', label: 'SD' },
                    { value: 'sem', label: 'SEM' },
                    { value: 'ci95', label: '95% CI' }
                  ]}
                />
              </div>
            </div>
          </Field>
        </Section>
      }
      colours={
        <CategoricalSection config={config} update={update}>
          <Field label="colour by">
            <Select
              value={byCondition ? 'condition' : 'value'}
              onChange={(v) =>
                update(
                  v === 'value'
                    ? { colorBy: 'value' }
                    : {
                        colorBy: 'condition',
                        // Start from what was there, else the first categorical condition.
                        colorConds: colorConds.length
                          ? colorConds
                          : defaultColorConds(active, numeric)
                      }
                )
              }
              options={[
                { value: 'value', label: 'value' },
                { value: 'condition', label: 'condition' }
              ]}
            />
          </Field>
          {byCondition && (
            <ConditionColorFields
              active={active}
              numeric={numeric}
              selected={colorConds}
              onChange={(next) => update({ colorBy: 'condition', colorConds: next })}
            />
          )}
        </CategoricalSection>
      }
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <GeneBarPanel config={config as BarConfig} {...props} />
}
