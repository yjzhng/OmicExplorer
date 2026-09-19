/** Per-tile config window, opened from the gear button in a panel header. Carries the tile's
 *  view controls (the All/Selected gene toggle, the landscape/portrait switch) and the SAME
 *  plot config the canvas tile offers in its detail panel (label caps, cluster method, …),
 *  so a plot is configurable from either view. Everything applies live.
 *  Portalled to <body> because a dashboard tile sits inside react-grid-layout's transformed
 *  item, where a position:fixed panel would otherwise be offset instead of viewport-centred. */
import type { ReactNode } from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import { PlotConfig } from '../graph/NodeConfigPanel'
import type { NodeConfig, NodeKind, PlotOrient } from '../graph/types'
import { Field, Segmented, TileDialog, type Anchor } from './TileDialog'
import { styles } from './tileDialogStyles'

/** The canvas detail panel's config for this tile's plot kind, bound to the tile's updater. */
export interface TilePlotConfig {
  kind: NodeKind
  config: NodeConfig
  update: (patch: Record<string, unknown>) => void
  /** the node whose incoming edge is the plot's upstream (the group node for a subcard) */
  edgeNodeId: string
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
  onClose
}: {
  title: string
  /** the header button it hangs from */
  anchor: Anchor
  canToggle: boolean
  selectedOnly: boolean
  onSelectedOnly: (v: boolean) => void
  canOrient: boolean
  orient: PlotOrient
  onOrient: (o: PlotOrient) => void
  plotConfig?: TilePlotConfig
  onClose: () => void
}): ReactNode {
  const hasView = canToggle || canOrient
  return (
    <TileDialog
      title={`Settings · ${title}`}
      label="Panel settings"
      anchor={anchor}
      onClose={onClose}
      footer={
        <button style={styles.btnGhost} onClick={onClose}>
          Close
        </button>
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
            />
          </div>
        </ReactFlowProvider>
      )}
    </TileDialog>
  )
}
