import { type ReactNode, useEffect } from 'react'
import { condLabel } from '../../engine'
import { useGraph } from '../../graph/store'
import type { BubbleConfig } from '../../graph/types'
import { useUpstreamFacts } from '../../graph/useUpstreamFacts'
import { AUTO } from '../../ui/ColorPicker'
import { BUBBLE_SIG_PALETTE, toPaletteRef } from '../../ui/palettes'
import { OnOffSwitch, ToggleSwitch } from '../../ui/ToggleSwitch'
import { useRolePalette } from '../../ui/useAppSettings'
import {
  CapSection,
  ColorChip,
  Field,
  QuickToggle,
  Section,
  Select
} from '../kit/settings/controls'
import { autoOf } from '../kit/settings/plotHooks'
import { PanelPaletteSelect, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { type PlotSettingsProps } from '../settings'

/** The bubbles' look: what their size, colour and outline width show — |log₂FC| or −log₁₀ of the
 *  Compare's P/Q — the colour's palette (Automatic: the global FC one, or Purples), the
 *  outline's colour (Automatic: a darker shade of each bubble's own), and a ∗ on the significant. */
export function BubbleLookSection({
  config,
  update,
  statName
}: Pick<PlotPanelProps<BubbleConfig>, 'config' | 'update'> & {
  /** the Compare's significance column, named (P-value / Q-value) */
  statName: string
}): ReactNode {
  const sig = `−log₁₀ ${statName === 'P-value' ? 'P' : 'Q'}`
  const measures = (abs: boolean) => [
    { value: 'fc' as const, label: abs ? '|log₂FC|' : 'log₂FC' },
    { value: 'sig' as const, label: sig }
  ]
  const colorBy = config.colorBy ?? 'fc'
  const fcRole = useRolePalette('fcObject')
  const outlineBy = config.outlineBy ?? 'none'
  const outline = config.outlineColor && config.outlineColor !== AUTO ? config.outlineColor : AUTO
  return (
    <Section title="Style">
      <Field label="size">
        <ToggleSwitch
          label="Size"
          value={config.sizeBy ?? 'fc'}
          options={measures(true)}
          onChange={(v) => update({ sizeBy: v })}
        />
      </Field>
      <Field label="colour">
        <ToggleSwitch
          label="Colour"
          value={colorBy}
          options={measures(false)}
          onChange={(v) => update({ colorBy: v })}
        />
      </Field>
      <Field label="palette">
        {colorBy === 'fc' ? (
          <PanelPaletteSelect
            value={toPaletteRef(config.fcPalette)}
            onChange={(v) => update({ fcPalette: v })}
            auto={autoOf(fcRole)}
          />
        ) : (
          <PanelPaletteSelect
            value={toPaletteRef(config.sigPalette)}
            onChange={(v) => update({ sigPalette: v })}
            auto={autoOf(BUBBLE_SIG_PALETTE)}
          />
        )}
      </Field>
      <Field label="outline">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ToggleSwitch
            label="Outline"
            value={outlineBy}
            options={[{ value: 'none' as const, label: 'none' }, ...measures(true)]}
            onChange={(v) => update({ outlineBy: v })}
          />
          {outlineBy !== 'none' && (
            <ColorChip
              color={outline}
              on
              label="Outline colour"
              title={
                outline === AUTO
                  ? 'Outline colour: automatic (a darker shade of each bubble)'
                  : 'Outline colour'
              }
              onPick={(v) => update({ outlineColor: v })}
              onAuto={() => update({ outlineColor: undefined })}
              autoLabel="Automatic (darker bubble colour)"
            />
          )}
        </div>
      </Field>
      <Field
        label="asterisk"
        info="A ∗ at the centre of each bubble significant at its dose or time."
      >
        <OnOffSwitch
          on={!!config.asterisk}
          label="Asterisk"
          onChange={(v) => update({ asterisk: v })}
        />
      </Field>
    </Section>
  )
}
export function BubblePanel({ config, update, edgeNodeId }: PlotPanelProps<BubbleConfig>) {
  // Only offer the numeric conditions the upstream data actually carries; with one axis there's
  // nothing to choose, so the selector is hidden and the config snaps to it.
  const upId = useGraph((s) => s.edges.find((e) => e.target === edgeNodeId)?.source)
  const { axes: avail, result } = useUpstreamFacts(upId)
  const axes = avail.map((c) => ({ value: c, label: condLabel(c) }))
  // the significance column the upstream Compare calls by — the rank's other option
  const statName =
    result?.kind === 'compare' && result.cmp.threshold?.statType === 'pP' ? 'P-value' : 'Q-value'
  const byFc = (config.rank ?? 'fc') === 'fc'
  const over = config.over ?? 'peak'
  useEffect(() => {
    if (axes.length > 0 && !axes.some((o) => o.value === config.axis))
      update({ axis: axes[0].value as BubbleConfig['axis'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail.join('|'), config.axis])
  return (
    <PlotSections
      show={
        <>
          <Section title="Bubble">
            {axes.length > 1 && (
              <Field
                label="axis"
                aside={<QuickToggle config={config} field="axis" update={update} />}
              >
                <Select
                  value={config.axis}
                  onChange={(v) => update({ axis: v as BubbleConfig['axis'] })}
                  options={axes}
                />
              </Field>
            )}
            <Field
              label="rank"
              info="What picks and orders the top genes: their log₂FC, or their significance (the Compare's own P or Q value, in the fold change's direction)."
              aside={<QuickToggle config={config} field="rank" update={update} />}
            >
              <ToggleSwitch
                label="Rank"
                value={config.rank ?? 'fc'}
                options={[
                  { value: 'fc', label: 'log₂FC' },
                  { value: 'sig', label: statName }
                ]}
                onChange={(v) => update({ rank: v })}
              />
            </Field>
            <Field
              label="over levels"
              info="How a gene's rank score is taken over its doses or times: its peak (the level scoring furthest from 0, its direction kept), or its total (summed, so up and down levels cancel to the net direction)."
              aside={<QuickToggle config={config} field="over" update={update} />}
            >
              <ToggleSwitch
                label="Over levels"
                value={over}
                options={[
                  { value: 'peak', label: 'peak' },
                  { value: 'total', label: 'total' }
                ]}
                onChange={(v) => update({ over: v })}
              />
            </Field>
          </Section>
          <CapSection
            title="Cap genes"
            hint="Show only the strongest genes."
            field="topGenes"
            value={config.topGenes}
            enabled={config.capEnabled}
            update={update}
            defaultValue={20}
            rule={(n) =>
              byFc
                ? `Keep the top ${n} genes by largest ${over} |log₂FC|.`
                : `Keep the top ${n} genes by ${over === 'peak' ? 'smallest' : 'largest total −log₁₀'} ${statName}.`
            }
          />
        </>
      }
      marks={<BubbleLookSection config={config} update={update} statName={statName} />}
    />
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return <BubblePanel config={config as BubbleConfig} {...props} />
}
