/** Per-tile config window, opened from the gear button in a panel header and shown beside the
 *  tile. Carries the tile's view controls (the All/Selected gene toggle, the landscape/portrait
 *  switch) and the SAME plot config the canvas tile offers in its detail panel (label caps,
 *  cluster method, …), so a plot is configurable from either view. Nothing reaches the plot until
 *  Apply: the edits are held as a draft the window shows, and Close drops them.
 *  Portalled to <body> because a dashboard tile sits inside react-grid-layout's transformed
 *  item, where a position:fixed panel would otherwise be offset instead of viewport-centred. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ReactFlowProvider } from '@xyflow/react'

import { ApplyStageContext, type ApplyStage } from '../graph/applyStage'
import { Field, PlotConfig, Section } from '../graph/NodeConfigPanel'
import { plotLabel } from '../graph/registry'
import { useGraph } from '../graph/store'
import {
  isStep,
  type NodeConfig,
  type NodeKind,
  type PlotGroupConfig,
  type PlotOrient
} from '../graph/types'
import type { AxisDefaults } from '../ui/plotAxes'
import { cssVars, PALETTES } from '../ui/theme'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { useUiTheme } from '../ui/useUiTheme'
import { TileDialog, type Anchor } from './TileDialog'
import { styles } from './tileDialogStyles'

/**
 * "Apply to all": overwrite every other plot of this kind with these settings. It's a write the
 *  user can't watch happen (those tiles are usually off-screen) and it discards whatever they had,
 *  so the button ARMS first — naming how many plots it would overwrite — and only the second click
 *  applies. It disarms on mouse-out or after a few seconds, then answers with a tick.
 */
function ApplyAllButton({
  kind,
  label,
  count,
  onApply
}: {
  kind: NodeKind
  label: string
  /** how many other plots of this kind would be overwritten */
  count: number
  onApply: () => void
}): ReactNode {
  const [state, setState] = useState<'idle' | 'asking' | 'done'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const plots = `${count} other ${label} plot${count === 1 ? '' : 's'}`
  if (count === 0)
    return (
      <button style={{ ...styles.btnGhost, opacity: 0.45, cursor: 'default' }} disabled>
        Apply to all
      </button>
    )
  return (
    <>
      <button
        style={state === 'done' ? styles.btnPrimary : styles.btnAccentGhost}
        title={`Give ${plots} these settings`}
        aria-label={`Apply these settings to every ${kind} plot`}
        onClick={() => setState('asking')}
      >
        {state === 'done' ? '✓ Applied to all' : 'Apply to all'}
      </button>
      {state === 'asking' && (
        <ConfirmWindow
          title="Apply to all"
          body={`Replacing settings of ${plots} in the project. Proceed?`}
          confirm="Proceed"
          onCancel={() => setState('idle')}
          onConfirm={() => {
            onApply()
            setState('done')
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setState('idle'), 1400)
          }}
        />
      )}
    </>
  )
}

/** A small modal asking before something overwrites work the user can't see happen. Portalled and
 *  themed like the app's other windows (it lands outside the app root, so the CSS vars come with
 *  it); Escape and the scrim cancel. */
function ConfirmWindow({
  title,
  body,
  confirm,
  onConfirm,
  onCancel
}: {
  title: string
  body: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(
    <div style={cssVars(PALETTES[mode])}>
      <div style={styles.confirmScrim} onClick={onCancel} />
      <div style={styles.confirmModal} role="dialog" aria-modal="true" aria-label={title}>
        <div style={styles.head}>{title}</div>
        <div style={styles.confirmBody}>{body}</div>
        <div style={styles.confirmFoot}>
          <button style={styles.btnGhost} onClick={onCancel}>
            Cancel
          </button>
          <button style={styles.btnWarn} onClick={onConfirm} autoFocus>
            {confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** The canvas detail panel's config for this tile's plot kind, bound to the tile's updater. */
export interface TilePlotConfig {
  kind: NodeKind
  config: NodeConfig
  update: (patch: Record<string, unknown>) => void
  /** the node whose incoming edge is the plot's upstream (the group node for a subcard) */
  edgeNodeId: string
  /** this plot's own id — the tile's node, or the subcard's, so "apply to all" can skip it */
  selfId: string
}

export function PanelSettingsDialog({
  title,
  anchor,
  canToggle,
  selectedOnly,
  onSelectedOnly,
  canOrient,
  orient,
  onOrient,
  plotConfig,
  axisDefaults,
  onClose
}: {
  title: string
  /** the tile's box — the window opens beside it (see TileDialog) */
  anchor: Anchor
  canToggle: boolean
  selectedOnly: boolean
  onSelectedOnly: (v: boolean) => void
  canOrient: boolean
  orient: PlotOrient
  onOrient: (o: PlotOrient) => void
  plotConfig?: TilePlotConfig
  /** what the live plot draws on each axis with no override — the Axes fields' placeholders */
  axisDefaults?: AxisDefaults
  onClose: () => void
}): ReactNode {
  const hasView = canToggle || canOrient
  // How many plots "apply to all" would overwrite: every tile of this kind, and every subcard of
  // it inside a group, bar this one.
  const kind = plotConfig?.kind
  const selfId = plotConfig?.selfId
  const otherPlots = useGraph((s) =>
    !kind
      ? 0
      : s.nodes.reduce((n, node) => {
          if (!isStep(node)) return n
          if (node.data.kind === kind) return n + (node.id === selfId ? 0 : 1)
          if (node.data.kind !== 'plotGroup') return n
          const kids = (node.data.config as PlotGroupConfig).children
          return n + kids.filter((c) => c.kind === kind && c.id !== selfId).length
        }, 0)
  )
  // Every edit waits for Apply; Close drops them. The plot's own settings are held as a draft —
  // the window shows them merged over the stored config — and the view controls beside it.
  // Edits to another step (an upstream Compare's statistic, which re-runs it) are staged actions.
  const draftRef = useRef<Record<string, unknown>>({})
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [heldSelectedOnly, setHeldSelectedOnly] = useState<boolean | null>(null)
  const [heldOrient, setHeldOrient] = useState<PlotOrient | null>(null)
  // The settings on quick access (as their switches report them): those, and the quick-access
  // switches themselves, land as they're made — the tile shows them as switch bars.
  const quickFields = useRef(new Map<string, boolean>())
  const liveUpdate = plotConfig?.update
  const draftUpdate = useCallback(
    (patch: Record<string, unknown>): void => {
      const keys = Object.keys(patch)
      if (liveUpdate && keys.some((k) => k === 'quick' || quickFields.current.get(k))) {
        const rest = { ...draftRef.current }
        for (const k of keys) delete rest[k]
        draftRef.current = rest
        setDraft(rest)
        liveUpdate(patch)
        return
      }
      draftRef.current = { ...draftRef.current, ...patch }
      setDraft(draftRef.current)
    },
    [liveUpdate]
  )
  const shownConfig = useMemo(
    () =>
      plotConfig && Object.keys(draft).length
        ? ({ ...plotConfig.config, ...draft } as NodeConfig)
        : plotConfig?.config,
    [plotConfig, draft]
  )
  const staged = useRef(new Map<string, () => void>())
  const stage = useMemo<ApplyStage>(
    () => ({
      stage: (key, action) => {
        if (action) staged.current.set(key, action)
        else staged.current.delete(key)
      },
      quick: (field, on) => {
        quickFields.current.set(field, on)
      }
    }),
    []
  )
  // Writes the held edits: the staged actions first (one may add to the draft), then the draft.
  const commit = (): void => {
    for (const action of staged.current.values()) action()
    staged.current.clear()
    if (plotConfig && Object.keys(draftRef.current).length) plotConfig.update(draftRef.current)
    draftRef.current = {}
    setDraft({})
    if (heldSelectedOnly != null) onSelectedOnly(heldSelectedOnly)
    if (heldOrient != null) onOrient(heldOrient)
    setHeldSelectedOnly(null)
    setHeldOrient(null)
  }
  const apply = (): void => {
    commit()
    onClose()
  }
  return (
    <TileDialog
      title={`Settings · ${title}`}
      label="Panel settings"
      anchor={anchor}
      onClose={onClose}
      footer={
        <>
          {/* Edits land as they're made, except those that need a re-run (held until "Apply",
              which then re-runs them); "Apply to all"
              copies these settings onto every other plot of the same kind — a write the user can't
              otherwise see happen (those tiles are usually off-screen), so it answers with a tick. */}
          {plotConfig && (
            <ApplyAllButton
              kind={plotConfig.kind}
              label={plotLabel(plotConfig.kind, plotConfig.config)}
              count={otherPlots}
              // The settings as the window shows them: this plot takes its held edits too.
              onApply={() => {
                const settings = { ...plotConfig.config, ...draftRef.current }
                commit()
                useGraph
                  .getState()
                  .applyConfigToKind(
                    plotConfig.kind,
                    settings as unknown as Record<string, unknown>,
                    plotConfig.selfId
                  )
              }}
            />
          )}
          <button
            style={styles.btnPrimary}
            onClick={apply}
            title="Apply the changes (re-runs the Compare or Contrast if its statistic changed)"
          >
            Apply
          </button>
          <button style={styles.btnGhost} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {(hasView || plotConfig) && (
        // The canvas panel's sections, verbatim — the tile's own View section in the same look
        // (section head, field labels, switches) ahead of them. Its Selects read React Flow's zoom
        // to scale their dropdowns; a fresh provider here pins that to 1 (screen scale) outside
        // the canvas.
        <ReactFlowProvider>
          <ApplyStageContext.Provider value={stage}>
            <div style={styles.plotConfig}>
              {hasView && (
                <Section title="View">
                  {canToggle && (
                    <Field label="genes">
                      <ToggleSwitch
                        label="Genes"
                        value={(heldSelectedOnly ?? selectedOnly) ? 'selected' : 'all'}
                        options={[
                          { value: 'all', label: 'All' },
                          { value: 'selected', label: 'Selected' }
                        ]}
                        onChange={(v) => setHeldSelectedOnly(v === 'selected')}
                      />
                    </Field>
                  )}
                  {canOrient && (
                    <Field label="orientation">
                      <ToggleSwitch
                        label="Orientation"
                        value={heldOrient ?? orient}
                        options={[
                          { value: 'landscape', label: 'Landscape' },
                          { value: 'portrait', label: 'Portrait' }
                        ]}
                        onChange={(v) => setHeldOrient(v as PlotOrient)}
                      />
                    </Field>
                  )}
                </Section>
              )}
              {plotConfig && (
                <PlotConfig
                  kind={plotConfig.kind}
                  config={shownConfig ?? plotConfig.config}
                  update={draftUpdate}
                  edgeNodeId={plotConfig.edgeNodeId}
                  axisDefaults={axisDefaults}
                />
              )}
            </div>
          </ApplyStageContext.Provider>
        </ReactFlowProvider>
      )}
    </TileDialog>
  )
}
