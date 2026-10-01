/**
 * A step's status cluster — the run pill and status dot in a canvas tile's header, shared with the
 * form workflow's step tiles so both layouts say the same thing the same way.
 */
import type { CSSProperties, ReactNode } from 'react'

import { UI } from '../ui/theme'
import { NODE_SPECS, plotLabel } from './registry'
import { unmetRequirement } from './requirements'
import { useGraph } from './store'
import { unconfiguredLoad } from './types'
import type { LoadConfig, NodeData, NodeKind, PlotGroupConfig, StepStatus } from './types'
import { useUpstreamFacts } from './useUpstreamFacts'

// One-time keyframes for the running-status pulse (self-contained; canvas nodes don't share
// the dashboard stylesheet).
if (typeof document !== 'undefined' && !document.getElementById('oe-status-kf')) {
  const el = document.createElement('style')
  el.id = 'oe-status-kf'
  el.textContent = '@keyframes oe-status-pulse{0%,100%{opacity:1}50%{opacity:.3}}'
  document.head.appendChild(el)
}

export interface StatusInfo {
  color: string
  label: string
  pulse: boolean
}

/** Status shown for a runnable step from its run lifecycle. */
function runStatusInfo(status: StepStatus): StatusInfo {
  switch (status) {
    case 'running':
      return { color: '#e2b93b', label: 'Running…', pulse: true }
    case 'done':
      return { color: '#3fae5a', label: 'Completed', pulse: false }
    case 'error':
      return { color: '#e5484d', label: 'Error', pulse: false }
    default:
      return { color: UI.textMuted, label: 'Not run', pulse: false }
  }
}

/** A step's status: runnable steps show their run lifecycle; live steps (plots) are green only when
 *  the upstream has a result AND every requirement holds (kind + data shape — see requirements.ts),
 *  else grey with the reason. A group is green when all its plots are. A Load has no upstream, so
 *  it reads its OWN config: green only once its files are set. */
// eslint-disable-next-line react-refresh/only-export-components
export function useStepStatus(id: string, data: NodeData): StatusInfo {
  const spec = NODE_SPECS[data.kind]
  const upId = useGraph((s) => (spec.hasRun ? undefined : s.upstreamId(id)))
  const facts = useUpstreamFacts(upId)
  if (spec.hasRun) return runStatusInfo(data.status)
  const block = ((): string | null => {
    if (data.kind === 'load') return unconfiguredLoad(data.config as LoadConfig)
    if (!upId) return 'Waiting for data'
    const kinds: { kind: NodeKind; config: unknown }[] =
      data.kind === 'plotGroup'
        ? (data.config as PlotGroupConfig).children.map((c) => ({ kind: c.kind, config: c.config }))
        : [{ kind: data.kind, config: data.config }]
    for (const k of kinds) {
      const why = unmetRequirement(k.kind, k.config, facts)
      if (why) return kinds.length > 1 ? `${plotLabel(k.kind, k.config)}: ${why}` : why
    }
    if (!facts.result) return 'Waiting for data'
    return null
  })()
  return block
    ? { color: UI.textMuted, label: block, pulse: false }
    : { color: '#3fae5a', label: 'Ready', pulse: false }
}

/** The status as a dot, its meaning on hover (and to a screen reader). */
export function StatusDot({ color, label, pulse }: StatusInfo): ReactNode {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        ...(pulse ? { animation: 'oe-status-pulse 1.1s ease-in-out infinite' } : {})
      }}
    />
  )
}

/** Text-chip run control: Run (idle) · Stop (running) · Re-run (done) · Retry (error).
 *  When `gate` is set the step is blocked (e.g. Interactive samples not set up) — the chip is
 *  disabled and explains why. */
export function RunControl({
  status,
  accent,
  onRun,
  onStop,
  gate
}: {
  status: StepStatus
  accent: string
  onRun: () => void
  onStop: () => void
  gate?: string | null
}): ReactNode {
  const chip = (label: string, color: string, fn: () => void) => (
    <button
      className="nodrag"
      onClick={(e) => {
        e.stopPropagation()
        fn()
      }}
      style={{ ...runChip, color, borderColor: color }}
    >
      {label}
    </button>
  )
  if (gate) {
    return (
      <span
        className="nodrag"
        title={gate}
        style={{ ...runChip, color: UI.textMuted, borderColor: UI.border, cursor: 'not-allowed' }}
      >
        Set up first
      </span>
    )
  }
  if (status === 'running') return chip('Stop', '#e2b93b', onStop)
  if (status === 'done') return chip('Re-run', accent, onRun)
  if (status === 'error') return chip('Retry', '#e15759', onRun)
  return chip('Run', accent, onRun)
}

const runChip: CSSProperties = {
  border: '1px solid',
  background: 'transparent',
  borderRadius: 10,
  padding: '2px 9px',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.5,
  cursor: 'pointer',
  whiteSpace: 'nowrap'
}
