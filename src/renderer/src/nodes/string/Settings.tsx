import type { ReactNode } from 'react'
import { STRING_OUTLINE, type StringConfig } from '../../graph/types'
import { AUTO } from '../../ui/ColorPicker'
import { STRING_LEVEL_ORDER, stringLevelScore } from '../../ui/stringModel'
import { UI } from '../../ui/theme'
import {
  Checkbox,
  ColorChip,
  Field,
  NumberInput,
  QuickToggle,
  Section,
  Select
} from '../kit/settings/controls'
import { ColourRows, type PlotPanelProps, PlotSections } from '../kit/settings/plotSections'
import { styles } from '../kit/settings/styles'
import { type PlotSettingsProps } from '../settings'

/** STRING network: confidence cutoff, gene cap, first-shell interactors and a species override.
 *  The same fields as the tile's quick switch bars, so either place edits the one config. */
export function StringPanel({ config, update }: PlotPanelProps<StringConfig>) {
  return (
    <>
      <Field
        label="confidence"
        aside={<QuickToggle config={config} field="confidence" update={update} />}
      >
        <Select
          value={config.confidence ?? 'auto'}
          onChange={(v) =>
            update({ confidence: v === 'auto' ? undefined : (v as StringConfig['confidence']) })
          }
          options={[
            { value: 'auto', label: 'auto (highest with a network)' },
            // each level as its score cutoff: the links at or above it are drawn
            ...STRING_LEVEL_ORDER.map((l) => ({ value: l, label: `≥ ${stringLevelScore(l)}` }))
          ]}
        />
      </Field>
      <Field
        label="interactors"
        aside={<QuickToggle config={config} field="addInteractors" update={update} />}
      >
        <Checkbox
          label="add first-shell interactors"
          checked={config.addInteractors ?? false}
          onChange={(v) => update({ addInteractors: v })}
          title="Also include proteins that directly connect to a differential gene above the cutoff"
        />
      </Field>
      <Field label="species">
        <div style={{ width: 90 }}>
          <NumberInput
            value={config.species ?? 0}
            step={1}
            min={0}
            title="NCBI taxon id; 0 = the species detected from the annotation fetch"
            onChange={(v) => update({ species: Math.max(0, Math.round(v)) || undefined })}
          />
        </div>
      </Field>
      <div style={styles.hint}>NCBI taxon override (e.g. 9606 human); 0 = detected species.</div>
    </>
  )
}
/** How many nodes are drawn (General's genes rows). */
function StringGenes({ config, update }: PlotPanelProps<StringConfig>): ReactNode {
  const n = config.maxGenes > 0 ? config.maxGenes : 40
  return (
    <Field
      label="Max genes"
      aside={<QuickToggle config={config} field="maxGenes" update={update} />}
      info={`Draw at most ${n} nodes — query genes first (by |log₂FC|), then any first-shell interactors, each by how connected they are. Unconnected genes are never drawn.`}
    >
      <div style={{ width: 90 }}>
        <NumberInput
          value={config.maxGenes > 0 ? config.maxGenes : 40}
          step={10}
          min={1}
          onChange={(v) => update({ maxGenes: Math.max(1, Math.round(v)) })}
        />
      </div>
    </Field>
  )
}
/** The nodes' look: each kind's outline (the marks). */
function StringNodes({ config, update }: PlotPanelProps<StringConfig>): ReactNode {
  return (
    <Section title="Nodes">
      <StringOutlineField
        label="query outline"
        width={config.queryOutline}
        color={config.queryOutlineColor}
        auto="black"
        autoInk="#000000"
        onWidth={(v) => update({ queryOutline: v })}
        onColor={(c) => update({ queryOutlineColor: c })}
      />
      <StringOutlineField
        label="interactor outline"
        width={config.interactorOutline}
        color={config.interactorOutlineColor}
        auto="the background"
        autoInk={UI.panel}
        onWidth={(v) => update({ interactorOutline: v })}
        onColor={(c) => update({ interactorOutlineColor: c })}
      />
    </Section>
  )
}
/** One kind of STRING node's outline: width (px) and colour (AUTO = `auto`, its default ink). */
export function StringOutlineField({
  label,
  width,
  color,
  auto,
  autoInk,
  onWidth,
  onColor
}: {
  label: string
  width: number | undefined
  color: string | undefined
  auto: string
  /** the colour Automatic resolves to, for the chip */
  autoInk?: string
  onWidth: (v: number) => void
  onColor: (c: string) => void
}): ReactNode {
  const ink = color ?? AUTO
  return (
    <Field label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <div style={{ width: 52, flex: '0 0 auto' }}>
          <NumberInput
            value={width ?? STRING_OUTLINE}
            step={0.5}
            min={0}
            max={4}
            title={`${label} width (px)`}
            onChange={(v) => onWidth(Math.min(4, Math.max(0, Math.round(v * 4) / 4)))}
          />
        </div>
        <ColorChip
          color={ink}
          on
          label={`${label} colour`}
          title={ink === AUTO ? `${label} colour: automatic (${auto})` : `${label} colour`}
          onPick={onColor}
          onAuto={() => onColor(AUTO)}
          autoLabel={`Automatic (${auto})`}
          autoColor={autoInk}
        />
      </div>
    </Field>
  )
}

/** Its settings panel (nodes/settings.ts): this plot's own sections. */
export function Settings({ config, ...props }: PlotSettingsProps): ReactNode {
  return (
    <PlotSections
      general={<StringPanel config={config as StringConfig} {...props} />}
      genes={<StringGenes config={config as StringConfig} {...props} />}
      colours={<ColourRows config={config as StringConfig} {...props} />}
      marks={<StringNodes config={config as StringConfig} {...props} />}
    />
  )
}
