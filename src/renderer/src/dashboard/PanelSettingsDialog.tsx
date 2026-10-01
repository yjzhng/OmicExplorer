/** Per-tile config window, opened from the gear button in a panel header and shown beside the
 *  tile, so a change is visible on the plot as it's made. Carries the tile's
 *  view controls (the All/Selected gene toggle, the landscape/portrait switch) and the SAME
 *  plot config the canvas tile offers in its detail panel (label caps, cluster method, …),
 *  so a plot is configurable from either view. Everything applies live.
 *  Portalled to <body> because a dashboard tile sits inside react-grid-layout's transformed
 *  item, where a position:fixed panel would otherwise be offset instead of viewport-centred. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ReactFlowProvider } from '@xyflow/react'

import { PlotConfig } from '../graph/NodeConfigPanel'
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
import { useUiTheme } from '../ui/useUiTheme'
import { Field, Segmented, TileDialog, type Anchor } from './TileDialog'
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
  return (
    <TileDialog
      title={`Settings · ${title}`}
      label="Panel settings"
      anchor={anchor}
      onClose={onClose}
      footer={
        <>
          {/* Edits land as they're made, so "Apply" only confirms and closes; "Apply to all"
              copies these settings onto every other plot of the same kind — a write the user can't
              otherwise see happen (those tiles are usually off-screen), so it answers with a tick. */}
          {plotConfig && (
            <ApplyAllButton
              kind={plotConfig.kind}
              label={plotLabel(plotConfig.kind, plotConfig.config)}
              count={otherPlots}
              onApply={() =>
                useGraph
                  .getState()
                  .applyConfigToKind(
                    plotConfig.kind,
                    plotConfig.config as unknown as Record<string, unknown>,
                    plotConfig.selfId
                  )
              }
            />
          )}
          <button
            style={styles.btnPrimary}
            onClick={onClose}
            title="Close — changes are applied as you make them"
          >
            Apply
          </button>
          <button style={styles.btnGhost} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {hasView && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>View</div>
          {canToggle && (
            <Field label="Genes">
              <Segmented
                value={selectedOnly ? 'selected' : 'all'}
                onChange={(v) => onSelectedOnly(v === 'selected')}
                options={[
                  { v: 'all', label: 'All' },
                  { v: 'selected', label: 'Selected' }
                ]}
              />
            </Field>
          )}
          {canOrient && (
            <Field label="Orientation">
              <Segmented
                value={orient}
                onChange={(v) => onOrient(v as PlotOrient)}
                options={[
                  { v: 'landscape', label: 'Landscape' },
                  { v: 'portrait', label: 'Portrait' }
                ]}
              />
            </Field>
          )}
        </div>
      )}
      {plotConfig && (
        // The canvas panel's sections, verbatim. Its Selects read React Flow's zoom to scale
        // their dropdowns; a fresh provider here pins that to 1 (screen scale) outside the canvas.
        <ReactFlowProvider>
          <div style={styles.plotConfig}>
            <PlotConfig
              kind={plotConfig.kind}
              config={plotConfig.config}
              update={plotConfig.update}
              edgeNodeId={plotConfig.edgeNodeId}
              axisDefaults={axisDefaults}
            />
          </div>
        </ReactFlowProvider>
      )}
    </TileDialog>
  )
}
