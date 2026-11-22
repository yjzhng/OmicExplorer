/** Detail panel width (flow units — it scales with the canvas zoom). Exported so the tile can
 *  decide which side of itself the panel fits on. */

import { useStore } from '@xyflow/react'
import { type ReactNode, useContext, useEffect, useState, type CSSProperties } from 'react'
import { roundP, type SampleOrder } from '../../../engine'
import { ApplyStageContext } from '../../../graph/applyStage'
import { quickOn } from '../../../graph/registry'
import {
  SAMPLE_ORDERS,
  SAMPLE_ORDER_HINT,
  capOn,
  sampleOrderOf,
  type NodeKind,
  type QuickAccess
} from '../../../graph/types'
import { AUTO, AUTO_BACKGROUND, AutoCorner, CLEAR, ColorPicker } from '../../../ui/ColorPicker'
import { IconGear } from '../../../ui/icons'
import type { ResolvedGroup } from '../../../ui/pointStyle'
import { Select as AppSelect, type SelectOption } from '../../../ui/Select'
import { slashBackground } from '../../../ui/slash'
import { PALETTES, UI } from '../../../ui/theme'
import { OnOffSwitch } from '../../../ui/ToggleSwitch'
import { useUiTheme } from '../../../ui/useUiTheme'
import { ScreenScale } from './hooks'
import { Field } from '../../../ui/Field'
import { NumberInput } from '../../../ui/NumberInput'
import { Section } from '../../../ui/Section'
import { PREVIEW_DOT } from './layout'
import { styles } from './styles'

/** A top-N cap as one row of General (its label limit, its max genes): the switch, then — while
 *  on — the N box beside it; while off, nothing (no cap, so no N). What it does, and the rule for
 *  the N chosen, are the row's (i) tip. `field` is the config key holding N; the switch itself is
 *  the shared `capEnabled` key (see `capOn` for how older configs without it are read). */
export function CapRow({
  label,
  info,
  field,
  value,
  enabled,
  update,
  defaultValue = 20,
  step = 5,
  max,
  rule
}: {
  label: string
  /** what the cap does — the row's (i) tip, with the rule for the N chosen after it */
  info?: ReactNode
  field: string
  value: number
  enabled: boolean | undefined
  update: (patch: Record<string, unknown>) => void
  defaultValue?: number
  step?: number
  max?: number
  rule: (n: number) => string
}): ReactNode {
  const n = value ?? 0
  const on = capOn(enabled, n)
  return (
    <Field
      label={label}
      info={
        info != null || on ? (
          <>
            {info}
            {info != null && on ? ' ' : null}
            {on ? rule(n) : null}
          </>
        ) : undefined
      }
    >
      <div style={styles.cutoffRow}>
        <OnOffSwitch
          on={on}
          label={label}
          onChange={(next) =>
            update({ capEnabled: next, ...(next && !(n > 0) ? { [field]: defaultValue } : null) })
          }
        />
        {on && (
          <div style={{ width: 90 }}>
            <NumberInput
              value={n}
              step={step}
              min={1}
              max={max}
              onChange={(v) =>
                update({ [field]: Math.min(max ?? Infinity, Math.max(1, Math.round(v))) })
              }
            />
          </div>
        )}
      </div>
    </Field>
  )
}
// ── small controls ──────────────────────────────────────────────────────────────
/** Opens a step's configuration window (interactive import, comparison, contrast). The step can't
 *  run until that window has been filled in, so this is the panel's main action and is styled as
 *  one: accent-filled with a gear, where the panel's other buttons are plain. Disabled, it goes
 *  grey and says why on hover. */
export function ConfigureButton({
  label,
  disabled,
  title,
  onClick
}: {
  label: string
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      style={{ ...styles.configBtn, ...(disabled ? styles.configBtnOff : null) }}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <IconGear size={13} strokeWidth={2.2} />
      {label}
    </button>
  )
}
/** The sample axis' order (heatmap, gene bar, QC, correlation): natural (by condition) or the data's own. */
export function SampleOrderField({
  config,
  update,
  label = 'sample order',
  kind
}: {
  config: { sampleOrder?: SampleOrder; quick?: QuickAccess }
  update: (patch: Record<string, unknown>) => void
  label?: string
  /** the plot's kind, for its quick-access default (QUICK_DEFAULTS) */
  kind?: NodeKind
}): ReactNode {
  return (
    <Field
      label={label}
      aside={<QuickToggle config={config} field="sampleOrder" update={update} kind={kind} />}
    >
      <Select
        value={sampleOrderOf(config)}
        onChange={(v) => update({ sampleOrder: v as SampleOrder })}
        options={SAMPLE_ORDERS.map((o) => ({ value: o, label: SAMPLE_ORDER_HINT[o] }))}
      />
    </Field>
  )
}
/** The per-setting "quick access" switch beside a plot setting: on = the tile also shows this
 *  setting as a switch bar for one-click changes; off = the gear alone carries it. A labelled
 *  Switch (not a pill) so it reads as on/off, distinct from the setting's own control. */
export function QuickToggle({
  config,
  field,
  update,
  kind
}: {
  config: { quick?: QuickAccess }
  field: string
  update: (patch: Record<string, unknown>) => void
  /** the tile's kind, for its quick-access defaults (QUICK_DEFAULTS) */
  kind?: NodeKind
}): ReactNode {
  // The same reading as the tile's switch bars, so this switch and the tile always agree.
  const on = quickOn(config, field, kind)
  // In a settings window, a setting on quick access applies live (the rest wait for Apply).
  const staging = useContext(ApplyStageContext)
  useEffect(() => staging?.quick(field, on), [staging, field, on])
  return (
    <span
      style={styles.quickRow}
      title={
        on
          ? 'Quick access on: shown in the tile as a switch bar'
          : 'Quick access off: only in this settings window'
      }
    >
      <span style={styles.quickLabel}>quick access</span>
      <OnOffSwitch
        on={on}
        label="Quick access"
        onChange={(next) => update({ quick: { ...config.quick, [field]: next } })}
      />
    </span>
  )
}
/** One group's marker as the plot draws it, for the preview block: its fill, size, opacity and
 *  outline, optionally bumped/ringed as the selection and named above. Not interactive — the
 *  settings that shape it live in the rows below. */
export function MarkerPreview({
  g,
  state,
  ink,
  style
}: {
  g: ResolvedGroup
  /** 'plain' as drawn, 'selected' as the emphasis overlay draws it, 'faded' while another is */
  state: 'plain' | 'selected' | 'faded'
  ink: string
  /** grid placement (see the preview block — the cells share their area with the ground) */
  style?: CSSProperties
}): ReactNode {
  const h = g.highlight
  const sel = state === 'selected'
  const size = sel ? (h.size ?? g.size + h.bump) : g.size
  const width = sel ? h.ring : g.outline
  const color = sel ? (h.ringColor ?? ink) : (g.outlineColor ?? ink)
  const dot = Math.min(size, PREVIEW_DOT + (sel ? h.bump : 0))
  return (
    <div style={{ ...styles.hlCell, ...style }} title={`${g.name}, ${state}`}>
      {sel && h.label && (
        <span style={{ ...styles.hlName, fontSize: h.labelSize, color: ink }}>gene</span>
      )}
      <span
        style={{
          ...styles.markerDot,
          width: dot,
          height: dot,
          background: g.color,
          opacity: state === 'faded' ? h.dim : sel ? 1 : g.opacity,
          // A fill and an outline that are both clear leave nothing to see — a hairline keeps the
          // marker locatable in its cell.
          ...(g.color === CLEAR && width <= 0 ? { border: `1px dashed ${UI.textMuted}` } : null),
          // The outline is a marker.line on the plot — a box-shadow here, so it rings the dot
          // without changing its size, as Plotly's stroke does.
          boxShadow: width > 0 ? `0 0 0 ${width}px ${color}` : undefined
        }}
      />
    </div>
  )
}
/** A pixel size / thickness: a small number box, clamped to its range on commit. Sizes read and
 *  type better as a value than as a slider (they're a handful of px, often typed exactly), and
 *  opacity (0–1 in 0.05 steps) goes through the same box. */
export function SizeBox({
  value,
  onChange,
  min,
  max,
  step = 1,
  title,
  tight,
  disabled
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  title?: string
  /** narrow variant for a box sharing its cell with a fixed control (a swatch, a switch) */
  tight?: boolean
  /** greyed and inert — the setting still shows, but whatever it belongs to is switched off */
  disabled?: boolean
}): ReactNode {
  // Width follows what the field can hold: two digits for a px size, "0.85" for a fraction.
  return (
    <div style={tight ? styles.tightBox : step < 1 ? styles.fracBox : styles.sizeBox}>
      <NumberInput
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        title={title}
        onChange={(v) => {
          // Snap to the step, then round away the binary-float dust (0.8500000000000001).
          const snapped =
            step < 1 ? Math.round(Math.round(v / step) * step * 100) / 100 : Math.round(v)
          onChange(Math.min(max, Math.max(min, snapped)))
        }}
      />
    </div>
  )
}
/** Name box for an effect class ("down" / "up"): edits live locally and commit on blur/Enter, so
 *  each keystroke doesn't push an undo step; blank reverts to the default. */
export function EffectLabelInput({
  value,
  onCommit,
  style,
  placeholder,
  title = 'Name shown for this effect class in legends and tables',
  disabled
}: {
  value: string
  onCommit: (v: string) => void
  style?: CSSProperties
  placeholder?: string
  title?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft != null && draft.trim() !== value) onCommit(draft.trim())
    setDraft(null)
  }
  return (
    <input
      type="text"
      style={{ ...styles.labelInput, ...style }}
      value={draft ?? value}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(null)
      }}
      title={title}
    />
  )
}
/** A significance cutoff entered as a plain p/q value (0 < p ≤ 1) while the config keeps it as
 *  −log10 (`statMin`), which is what the classifier and every plot use. While focused the field
 *  shows the raw draft so partial input ("0.0…") isn't snapped back mid-keystroke — only a valid
 *  value commits; unfocused it always reflects the prop (undo, a dragged volcano guide, …). */
export function PValueInput({
  statMin,
  onChange
}: {
  statMin: number
  onChange: (statMin: number) => void
}) {
  // The app's NumberInput (its draft keeps a partial "0.0…" on screen); only a valid p commits.
  return (
    <NumberInput
      value={roundP(Math.pow(10, -statMin))}
      step={0.001}
      min={0}
      max={1}
      onChange={(v) => {
        if (v > 0 && v <= 1) onChange(-Math.log10(roundP(v)))
      }}
    />
  )
}
/** The app's Select (ui/Select) on a config panel: its menu drawn at the canvas zoom, closing when
 *  the canvas moves — unless `unscaled`, for a fixed-position window such as the selector dialog. */
export function Select({
  unscaled,
  ...props
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  /** render at screen scale (a fixed-position window such as the selector dialog), not at the
   *  canvas zoom the tile panel follows */
  unscaled?: boolean
  /** greyed and unopenable — the whole select is inert, not just some of its options */
  disabled?: boolean
}): ReactNode {
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  const flat = useContext(ScreenScale) || unscaled
  return (
    <AppSelect
      {...props}
      zoom={flat ? 1 : Number(tf.split(',')[2]) || 1}
      closeKey={unscaled ? undefined : tf}
    />
  )
}

// CLEAR (from ColorPicker), a transparent colour: drawn as nothing, while the width it WOULD use is
// kept — so picking a colour again brings the same outline back.

/** A colour field: a plain chip (a switch's width, an input's height, so a row of them lines up),
 *  hatched when the colour is cleared. The previews at the top of the section show what each
 *  colour does — a chip only has to say which colour it is. */
export function ColorChip({
  color,
  on,
  label,
  title,
  clearLabel,
  onPick,
  onClear,
  onAuto,
  autoLabel,
  autoColor,
  style
}: {
  /** a colour, or AUTO: the chip then shows `autoColor` — the colour it resolves to — with a
   *  corner mark (AutoCorner) */
  color: string
  /** what AUTO resolves to, as the chip should show it: a colour, or a CSS background (a gradient
   *  of the colours, where it's one per gene / comparison); unset = faint stripes */
  autoColor?: string
  /** false = the colour is cleared: the chip is hatched rather than showing an ink. Independent of
   *  the width beside it — a width of 0 just means nothing is drawn at the moment. */
  on: boolean
  label: string
  title: string
  clearLabel?: string
  onPick: (color: string) => void
  /** clear the colour: nothing is drawn, while any width beside it is kept (no clear chip unset) */
  onClear?: () => void
  /** offer the Automatic option (sets AUTO) on top of the grid */
  onAuto?: () => void
  autoLabel?: string
  /** placement / sizing from the caller (the group colour heads its column, full width) */
  style?: CSSProperties
}): ReactNode {
  // On a tile the grid is drawn at the canvas zoom; in a panel (ScreenScale), at screen scale. It
  // closes when the canvas moves under it either way.
  const tf = useStore((s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`)
  const flat = useContext(ScreenScale)
  // The slash is an SVG (see slashBackground), which can't read a CSS variable: the theme's literal.
  const border = PALETTES[useUiTheme((s) => s.mode)].border
  return (
    <ColorPicker
      value={color}
      onPick={onPick}
      onClear={onClear}
      clearLabel={clearLabel}
      onAuto={onAuto}
      autoLabel={autoLabel}
      label={label}
      title={title}
      zoom={flat ? 1 : Number(tf.split(',')[2]) || 1}
      closeKey={tf}
      triggerStyle={{
        ...styles.swatch,
        background:
          color === AUTO ? (autoColor ?? AUTO_BACKGROUND) : on ? color : slashBackground(border),
        ...style
      }}
    >
      {color === AUTO ? <AutoCorner /> : <span />}
    </ColorPicker>
  )
}

// The form primitives live in ui/ (one per job, shared with the dialogs and windows); the node
// settings import them from here with the rest of their kit.
export { Chevron } from '../../../ui/Chevron'
export { Checkbox } from '../../../ui/Checkbox'
export { Field, NumberInput, Section }
