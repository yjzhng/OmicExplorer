/**
 * The models of each axis a Curve fit runs over — one row per axis: its detector, its descriptor,
 * what its baseline is to it, and on a surface whether its 4PL midpoint drifts along the other
 * axis. The same rows in the tile panel and the Configure window (graph/axisFits.ts holds the
 * rules). Under a method preset they show the preset's choices, faded; picking another makes the
 * method custom.
 */
import type { CSSProperties, ReactNode } from 'react'

import {
  condLabel,
  presetModel,
  type AxisBaseline,
  type AxisFit,
  type ConditionKey
} from '../engine'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { UI } from '../ui/theme'
import { descriptorOptions, detectorOptions, fitOf, type Describe } from './axisFits'
import { MODEL_LOCK } from './curveSettings'

const BASELINE_OPTIONS: { value: AxisBaseline; label: string; title: string }[] = [
  {
    value: 'reference',
    label: 'control',
    title: 'The baseline is a control off the curve (the vehicle): the 4PL fits towards it at −∞'
  },
  {
    value: 'matched',
    label: 'first point',
    title:
      'The baseline is the curve’s own first point (t₀; the lowest temperature — ratio to the lowest level): the curve starts there'
  }
]

export function AxisModelRows({
  axes,
  surface,
  detection,
  fits,
  baselines,
  locked,
  joint,
  onFit,
  onBaseline
}: {
  /** the axes the fit runs over: one, or a surface's two (first, second) */
  axes: readonly ConditionKey[]
  surface: boolean
  /** the method's detector (what an axis without its own takes) */
  detection: '4pl' | 'spline'
  fits: Partial<Record<ConditionKey, AxisFit>> | undefined
  /** each axis's baseline kind as set (absent: its preset's) */
  baselines: Partial<Record<ConditionKey, AxisBaseline>> | undefined
  /** a method preset holds the models: shown faded */
  locked: boolean
  /** a surface described by the joint model (the coupling matters only then, or under a 4PL
   *  detector) */
  joint: boolean
  onFit: (index: number, field: keyof AxisFit, value: AxisFit[keyof AxisFit]) => void
  /** null: back to the axis's preset */
  onBaseline: (axis: ConditionKey, value: AxisBaseline | null) => void
}): ReactNode {
  const lockProps = locked ? MODEL_LOCK : null
  return (
    <div style={grid}>
      {axes.map((a, i) => {
        const f = fitOf(fits, axes, i, detection, baselines)
        const desc = descriptorOptions(surface, f.detect)
        const base = baselines?.[a] ?? presetModel(a).baseline
        // the coupling: a surface's 4PL (in the joint model — its 4PL detector, or the joint
        // description)
        const couples = surface && (f.detect === '4pl' || (joint && f.describe === '4pl'))
        const other = surface ? axes[1 - i] : null
        return (
          <div key={a} style={block}>
            <div style={name}>
              {condLabel(a)}
              {surface && <span style={role}>{i === 0 ? 'first axis' : 'second axis'}</span>}
            </div>
            <Labelled label="detector">
              <span {...lockProps}>
                <ToggleSwitch
                  size="sm"
                  label={`${condLabel(a)} detector`}
                  value={f.detect}
                  options={detectorOptions(surface)}
                  onChange={(v) => onFit(i, 'detect', v)}
                />
              </span>
            </Labelled>
            <Labelled label="descriptor">
              <span {...lockProps} title={desc.locked}>
                <ToggleSwitch<Describe>
                  size="sm"
                  label={`${condLabel(a)} descriptor`}
                  value={desc.locked ? '4pl' : f.describe}
                  options={desc.options}
                  disabled={!!desc.locked}
                  onChange={(v) => onFit(i, 'describe', v)}
                />
              </span>
            </Labelled>
            <Labelled label="baseline">
              <ToggleSwitch
                size="sm"
                label={`${condLabel(a)} baseline`}
                value={base}
                options={BASELINE_OPTIONS.map((o) => ({
                  ...o,
                  title: `${o.title}${o.value === presetModel(a).baseline ? ` (${condLabel(a)}'s default)` : ''}`
                }))}
                onChange={(v) => onBaseline(a, v === presetModel(a).baseline ? null : v)}
              />
            </Labelled>
            {surface && (
              <Labelled label="drift">
                <span
                  {...lockProps}
                  title={
                    couples
                      ? `Its 4PL midpoint drifts along ${other ? condLabel(other) : 'the other axis'} (the joint model)`
                      : 'Only for a 4PL in the joint model (a 4PL detector, or the joint description)'
                  }
                >
                  <ToggleSwitch
                    size="sm"
                    label={`${condLabel(a)} midpoint drift`}
                    value={f.coupled ? 'on' : 'off'}
                    disabled={!couples}
                    options={[
                      { value: 'off', label: 'fixed' },
                      { value: 'on', label: `along ${other ? condLabel(other) : 'other'}` }
                    ]}
                    onChange={(v) => onFit(i, 'coupled', v === 'on')}
                  />
                </span>
              </Labelled>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div style={row}>
      <span style={rowLabel}>{label}</span>
      {children}
    </div>
  )
}

const grid: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }
const block: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  border: `1px solid ${UI.border}`,
  borderRadius: 6,
  minWidth: 0
}
const name: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: UI.text,
  display: 'flex',
  gap: 6,
  alignItems: 'baseline'
}
const role: CSSProperties = { fontSize: 11, fontWeight: 400, color: UI.textMuted }
const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flexWrap: 'wrap'
}
const rowLabel: CSSProperties = { fontSize: 11, color: UI.textMuted, width: 64, flex: '0 0 auto' }
