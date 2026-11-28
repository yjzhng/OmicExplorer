/**
 * The models of each axis a Curve fit runs over — one row per axis: its detector, its descriptor,
 * what its baseline is to it, and on a surface whether its 4PL midpoint drifts along the other
 * axis. The same rows in the tile panel and the Configure window (graph/models/axisFits.ts holds the
 * rules). Under a method preset they show the preset's choices, faded; picking another makes the
 * method custom.
 */
import type { CSSProperties, ReactNode } from 'react'

import { condLabel, type AxisBaseline, type AxisFit, type ConditionKey } from '../../engine'
import { ToggleSwitch } from '../../ui/controls/ToggleSwitch'
import { UI } from '../../ui/app/theme'
import { descriptorOptions, detectorOptions, fitOf, type Describe } from '../models/axisFits'
import { MODEL_LOCK } from '../models/curveSettings'

export function AxisModelRows({
  axes,
  surface,
  detection,
  fits,
  baselines,
  pins,
  locked,
  joint,
  onFit
}: {
  /** the axes the fit runs over: one, or a surface's two (first, second) */
  axes: readonly ConditionKey[]
  surface: boolean
  /** the method's detector (what an axis without its own takes) */
  detection: '4pl' | 'spline'
  fits: Partial<Record<ConditionKey, AxisFit>> | undefined
  /** what the baseline is to each axis — as the Baseline pick makes it (curveModel's
   *  baselinesOfPick): shown, not set here, so the two can't disagree */
  baselines: Partial<Record<ConditionKey, AxisBaseline>> | undefined
  /** the Baseline picked on the grid: each axis's pinned level (none: each level its own) */
  pins: Partial<Record<ConditionKey, readonly string[]>>
  /** a method preset holds the models: shown faded */
  locked: boolean
  /** a surface described by the joint model (the coupling matters only then, or under a 4PL
   *  detector) */
  joint: boolean
  onFit: (index: number, field: keyof AxisFit, value: AxisFit[keyof AxisFit]) => void
}): ReactNode {
  const lockProps = locked ? MODEL_LOCK : null
  const pinOf = (a: ConditionKey): string | undefined =>
    pins[a]?.length === 1 ? pins[a]![0] : undefined
  return (
    <div style={grid}>
      {axes.map((a, i) => {
        const f = fitOf(fits, axes, i, detection, baselines)
        const desc = descriptorOptions(surface, f.detect)
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
              {/* the Baseline picked on the grid, not set here (one source) */}
              <span
                style={pinText}
                title={
                  pinOf(a)
                    ? `Every value against ${condLabel(a)} ${pinOf(a)} (at its own levels of the rest) — set by the Baseline picked on the grid`
                    : `Each ${condLabel(a)} level against the control at that level — set by the Baseline picked on the grid`
                }
              >
                {pinOf(a) ? `${condLabel(a)} ${pinOf(a)}` : 'each level its own'}
              </span>
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

// the axes side by side (one under the other where the window is too narrow for both)
const grid: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, minWidth: 0 }
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

const pinText: CSSProperties = { fontSize: 12, color: 'var(--text-muted, #888)' }
