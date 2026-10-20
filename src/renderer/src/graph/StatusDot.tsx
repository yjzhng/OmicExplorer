/**
 * A step's status cluster — the run pill and status dot in a canvas tile's header, shared with the
 * form workflow's step tiles so both layouts say the same thing the same way.
 */
import type { CSSProperties, ReactNode } from 'react'

import { UI } from '../ui/theme'
import { loadAbove, NODE_SPECS, plotLabel, runsIn } from './registry'
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
  /** complete: has results (a run step) or is ready to draw (a plot, a configured Load) */
  ok?: boolean
}

/** A plot's status: its run lifecycle, where done means ready to view in the results; not run yet,
 *  the reason it can't run (`block`) when there is one. */
// eslint-disable-next-line react-refresh/only-export-components
export function plotStatusInfo(
  status: StepStatus,
  error: string | undefined,
  block: string | null
): StatusInfo {
  if (status === 'running') return runStatusInfo(status)
  if (status === 'done') return { color: '#3fae5a', label: 'Ready to view', pulse: false, ok: true }
  if (status === 'error') return { color: '#e5484d', label: error ?? 'Error', pulse: false }
  return block ? { color: UI.textMuted, label: block, pulse: false } : runStatusInfo('idle')
}

/** Status shown for a runnable step from its run lifecycle. */
function runStatusInfo(status: StepStatus): StatusInfo {
  switch (status) {
    case 'running':
      return { color: '#e2b93b', label: 'Running…', pulse: true }
    case 'done':
      return { color: '#3fae5a', label: 'Completed', pulse: false, ok: true }
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
  const isPlot = spec.category === 'plotting'
  // A Subset off Load data has no run of its own (runsIn): ready once the import above is, as Load
  // data is — the reason it isn't, else null; undefined for every other step.
  const subsetLoad = useGraph((s) => {
    if (data.kind !== 'subset' || runsIn(s, id)) return undefined
    const load = loadAbove(s, id)?.load
    return load ? unconfiguredLoad(load.data.config as LoadConfig) : 'Waiting for data'
  })
  const runs = spec.hasRun && subsetLoad === undefined
  // a running step's progress (curve fits report it): its stage and how far along
  const progress = useGraph((s) => (data.status === 'running' ? s.progress[id] : undefined))
  const upId = useGraph((s) => (runs && !isPlot ? undefined : s.upstreamId(id)))
  const facts = useUpstreamFacts(upId)
  // The upstream step re-running: its previous result stays on show until the new one lands, so a
  // plot drawn from it isn't "Ready" yet — it's about to change.
  const upRunning = useGraph((s) => {
    const n = upId ? s.nodes.find((x) => x.id === upId) : undefined
    return !!n && n.type === 'step' && n.data.status === 'running'
  })
  if (subsetLoad !== undefined)
    return subsetLoad
      ? { color: UI.textMuted, label: subsetLoad, pulse: false }
      : { color: '#3fae5a', label: 'Ready', pulse: false, ok: true }
  if (runs && !isPlot) {
    const info = runStatusInfo(data.status)
    return progress?.stage
      ? {
          ...info,
          label: `${progress.stage}${progress.total > 0 ? ` · ${Math.round((100 * progress.done) / progress.total)}%` : '…'}`
        }
      : info
  }
  if (upRunning && data.status === 'done')
    return { color: '#e2b93b', label: 'Updating — upstream re-running', pulse: true }
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
    if (!facts.result) return 'Run the step it reads from first'
    return null
  })()
  if (isPlot) return plotStatusInfo(data.status, data.error, block)
  return block
    ? { color: UI.textMuted, label: block, pulse: false }
    : { color: '#3fae5a', label: 'Ready', pulse: false, ok: true }
}

/** Whether the step `upId` is running (or queued behind its own input) — a run downstream can
 *  start now and wait for it. */
// eslint-disable-next-line react-refresh/only-export-components
export function useUpstreamRunning(upId: string | undefined): boolean {
  return useGraph((s) => {
    const n = upId ? s.nodes.find((x) => x.id === upId) : undefined
    return !!n && n.type === 'step' && n.data.status === 'running'
  })
}

/** Why a plot (or a group's plots) can't run yet — no upstream, its step not run, a requirement
 *  the data doesn't meet — or null when it can. Gates its Run control. */
// eslint-disable-next-line react-refresh/only-export-components
export function usePlotGate(id: string, data: NodeData): string | null {
  const isPlot = NODE_SPECS[data.kind].category === 'plotting'
  const upId = useGraph((s) => (isPlot ? s.upstreamId(id) : undefined))
  const facts = useUpstreamFacts(upId)
  const upRunning = useUpstreamRunning(upId)
  if (!isPlot) return null
  // The step it reads still running: its run can start now — it waits for that step (the store's
  // waitForInputs), then draws from its result.
  if (!upId || (!facts.result && !upRunning)) return 'Run the step it reads from first'
  if (!facts.result) return null
  const kinds =
    data.kind === 'plotGroup'
      ? (data.config as PlotGroupConfig).children.map((c) => ({ kind: c.kind, config: c.config }))
      : [{ kind: data.kind, config: data.config }]
  // A group can run while any of its plots can (the others fail with their reason).
  const why = kinds.map((k) => unmetRequirement(k.kind, k.config, facts))
  if (kinds.length > 0 && why.every(Boolean)) return why[0]
  return null
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
  gate,
  gateLabel = 'Set up first'
}: {
  status: StepStatus
  accent: string
  onRun: () => void
  onStop: () => void
  gate?: string | null
  /** the blocked chip's text (the reason is its tooltip) */
  gateLabel?: string
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
        {gateLabel}
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
