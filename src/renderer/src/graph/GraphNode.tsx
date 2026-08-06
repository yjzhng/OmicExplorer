import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Fragment, useState, type CSSProperties } from 'react'

import { UI } from '../ui/theme'
import { NodeConfigPanel } from './NodeConfigPanel'
import { accentOf, categoryOf, CATEGORIES, hasSourceHandle, NODE_SPECS } from './registry'
import { useGraph } from './store'
import { TilePicker } from './TilePicker'
import type {
  CompareConfig,
  LoadConfig,
  NodeData,
  NodeKind,
  PlaceholderData,
  PlotGroupConfig,
  StepStatus
} from './types'

/** Text-chip run control: Run (idle) · Stop (running) · Re-run (done) · Retry (error). */
function RunControl({
  status,
  accent,
  onRun,
  onStop
}: {
  status: StepStatus
  accent: string
  onRun: () => void
  onStop: () => void
}) {
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
  if (status === 'running') return chip('Stop', '#e2b93b', onStop)
  if (status === 'done') return chip('Re-run', accent, onRun)
  if (status === 'error') return chip('Retry', '#e15759', onRun)
  return chip('Run', accent, onRun)
}

/** A group tile's body: a stack of subcards, one per child plot. Clicking a subcard
 *  opens that child's config (via `selectChildCard`) and highlights it. */
function GroupBody({
  id,
  config,
  accent
}: {
  id: string
  config: PlotGroupConfig
  accent: string
}) {
  const selectedSub = useGraph((s) => s.selectedSub)
  const selectChildCard = useGraph((s) => s.selectChildCard)
  const moveGroupChild = useGraph((s) => s.moveGroupChild)
  // id of the subcard being dragged, and the gap it's over (target card + which side).
  const [dragId, setDragId] = useState<string | null>(null)
  const [gap, setGap] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const reset = (): void => {
    setDragId(null)
    setGap(null)
  }
  if (config.children.length === 0) return <div style={muted}>Empty group.</div>
  return (
    <div style={subList}>
      {config.children.map((c) => {
        const active = selectedSub === c.id
        // The insertion line renders in the gap above/below the target card so it
        // clearly sits *between* two subcards, marking exactly where the drop lands.
        const lineBefore = gap?.id === c.id && gap.place === 'before'
        const lineAfter = gap?.id === c.id && gap.place === 'after'
        return (
          <Fragment key={c.id}>
            {lineBefore && <div style={dropLine} />}
            <button
              className="nodrag"
              // HTML5 drag to reorder. `nodrag` keeps React Flow from moving the node.
              draggable
              onDragStart={(e) => {
                setDragId(c.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (!dragId || dragId === c.id) return
                // Drop into the gap on whichever half of the card the cursor is over.
                const r = e.currentTarget.getBoundingClientRect()
                const place = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
                if (gap?.id !== c.id || gap.place !== place) setGap({ id: c.id, place })
              }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (dragId && gap) moveGroupChild(id, dragId, gap.id, gap.place)
                reset()
              }}
              onDragEnd={reset}
              onClick={(e) => {
                e.stopPropagation() // don't let the node's onClick clear the subcard selection
                selectChildCard(id, c.id)
              }}
              style={{
                ...subCard,
                borderColor: active ? accent : UI.border,
                background: active ? UI.panelAlt : UI.panel,
                opacity: dragId === c.id ? 0.4 : 1
              }}
            >
              <span style={grip}>⠿</span>
              <span style={{ ...dot, background: accent }} />
              <span style={subLabel}>{NODE_SPECS[c.kind].label}</span>
            </button>
            {lineAfter && <div style={dropLine} />}
          </Fragment>
        )
      })}
    </div>
  )
}

/** One component renders every category; the body varies by the node's operation. */
export function GraphNode({ id, data, selected: rfSelected }: NodeProps<Node<NodeData>>) {
  const spec = NODE_SPECS[data.kind]
  const category = categoryOf(data.kind)
  const accent = accentOf(category)
  const selectedId = useGraph((s) => s.selectedId)
  const result = useGraph((s) => s.results[id])
  const runNode = useGraph((s) => s.runNode)
  const cancelNode = useGraph((s) => s.cancelNode)
  // Config float opens for the single store selection; the accent border also lights up
  // for React Flow's own selection so every marquee-selected tile reads as selected.
  const configOpen = selectedId === id
  const selected = configOpen || !!rfSelected
  const [hovered, setHovered] = useState(false)
  const sideColor = selected ? accent : UI.border

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...card,
        position: 'relative',
        // Set each side explicitly (never the `borderColor` shorthand): React's style
        // diffing writes the shorthand into the DOM and clobbers borderTopColor without
        // rewriting it, which made the accent top strip vanish on deselect.
        borderTopColor: accent,
        borderRightColor: sideColor,
        borderBottomColor: sideColor,
        borderLeftColor: sideColor,
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 3px 14px rgba(0,0,0,0.4)` : card.boxShadow
      }}
    >
      {spec.acceptsFrom.length > 0 && <Handle type="target" position={Position.Left} />}
      <div style={header}>
        <span style={titleWrap}>
          <span style={{ ...catTag, color: accent }}>{CATEGORIES[category].label}</span>
          <span style={opLabel}>
            {data.kind === 'plotGroup'
              ? `${spec.label} · ${(data.config as PlotGroupConfig).children.length}`
              : spec.label}
          </span>
        </span>
        {spec.hasRun && (hovered || selected) && (
          <RunControl
            status={data.status}
            accent={accent}
            onRun={() => void runNode(id)}
            onStop={() => cancelNode(id)}
          />
        )}
      </div>
      <div style={body}>
        {data.kind === 'plotGroup' ? (
          <GroupBody id={id} config={data.config as PlotGroupConfig} accent={accent} />
        ) : (
          <NodeSummary kind={data.kind} id={id} result={result} config={data.config} />
        )}
        {data.error && <div style={errText}>{data.error}</div>}
      </div>
      {hasSourceHandle(data.kind) && <Handle type="source" position={Position.Right} />}
      {configOpen && (
        // Stop clicks inside the panel from bubbling to the node's onNodeClick, which
        // calls selectNode → clears selectedSub — that reset the active subcard to the
        // first on every interaction with a group's config.
        <div className="nodrag nowheel" style={configFloat} onClick={(e) => e.stopPropagation()}>
          <NodeConfigPanel id={id} />
        </div>
      )}
    </div>
  )
}

function NodeSummary({
  kind,
  result,
  config
}: {
  kind: NodeKind
  id: string
  result: ReturnType<typeof useGraph.getState>['results'][string] | undefined
  config: NodeData['config']
}) {
  if (kind === 'load') {
    const cfg = config as LoadConfig
    return (
      <div style={muted}>
        {cfg.data ? (
          <>
            {cfg.data}
            <br />
            {cfg.samplesheet ?? 'no samplesheet'}
            {cfg.db ? ` · ${cfg.db}` : ''}
          </>
        ) : (
          'Pick input files in the inspector.'
        )}
      </div>
    )
  }
  if (kind === 'standardize') {
    const std = result?.kind === 'standardize' ? result.std : null
    return std ? (
      <div style={stat}>
        {std.rows.length.toLocaleString()} rows · {std.activeConditions.join(', ')}
      </div>
    ) : (
      <div style={muted}>Tidy uniqID × sample table.</div>
    )
  }
  if (kind === 'compare') {
    const cfg = config as CompareConfig
    const cmp = result?.kind === 'compare' ? result.cmp : null
    return (
      <div style={muted}>
        {cfg.pairNum || '—'} vs {cfg.pairDen || '—'}
        {cmp && (
          <div style={stat}>
            {cmp.rows.length.toLocaleString()} rows · {cmp.rows.filter((r) => r.signf).length}{' '}
            signif
          </div>
        )}
      </div>
    )
  }
  if (kind === 'contrast') {
    const ctr = result?.kind === 'contrast' ? result.ctr : null
    return (
      <div style={muted}>
        {ctr
          ? ctr.comparisons.join(', ') || 'contrast'
          : 'Connect a Compare tile, then pick two levels.'}
        {ctr && (
          <div style={stat}>
            {ctr.rows.length.toLocaleString()} rows · {ctr.rows.filter((r) => r.signf).length}{' '}
            signif
          </div>
        )}
      </div>
    )
  }
  if (kind === 'volcano') return <div style={muted}>log₂FC vs significance. Select to view.</div>
  if (kind === 'scatter') return <div style={muted}>FC1 vs FC2 contrast. Select to view.</div>
  if (kind === 'ma') return <div style={muted}>Abundance vs log₂FC. Select to view.</div>
  if (kind === 'dr') return <div style={muted}>Dose/time response curves. Select to view.</div>
  if (kind === 'bubble') return <div style={muted}>Gene × dose bubble grid. Select to view.</div>
  if (kind === 'dumbbell') return <div style={muted}>FC1↔FC2 per gene. Select to view.</div>
  if (kind === 'tdr')
    return <div style={muted}>Dose×time response per focus gene. Select to view.</div>
  if (kind === 'geneBar')
    return <div style={muted}>Focus gene value across conditions. Select to view.</div>
  if (kind === 'pca')
    return <div style={muted}>Cluster samples or responsome (PCA/UMAP/t-SNE). Select to view.</div>
  return <div style={muted}>Genes × samples. Select to view.</div>
}

/** Transient tile shown between drop and op selection — the type picker *is* the tile,
 *  so there is a single surface at the drop point (not a separate floating menu). */
export function PlaceholderNode({ id, data }: NodeProps<Node<PlaceholderData>>) {
  const resolvePlaceholder = useGraph((s) => s.resolvePlaceholder)
  return (
    <div style={{ position: 'relative' }}>
      <Handle type="target" position={Position.Left} />
      <TilePicker ops={data.ops} header="New step" onPick={(ops) => resolvePlaceholder(id, ops)} />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const nodeTypes = {
  step: GraphNode,
  placeholder: PlaceholderNode
}

const card: CSSProperties = {
  width: 230,
  background: UI.panel,
  border: `1px solid ${UI.border}`,
  borderTop: `3px solid ${UI.accent}`,
  borderRadius: 8,
  color: UI.text,
  fontSize: 12,
  boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
}
const header: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: '7px 10px',
  borderBottom: `1px solid ${UI.border}`
}
const titleWrap: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 1 }
const catTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6
}
const opLabel: CSSProperties = { fontWeight: 600 }
const body: CSSProperties = { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }
const muted: CSSProperties = { color: UI.textMuted, fontSize: 11, lineHeight: 1.45 }
const subList: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5 }
const subCard: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  border: `1px solid ${UI.border}`,
  borderRadius: 6,
  padding: '6px 8px',
  cursor: 'pointer',
  color: UI.text
}
const dot: CSSProperties = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' }
const subLabel: CSSProperties = { fontSize: 12, fontWeight: 600 }
const grip: CSSProperties = { color: UI.textMuted, fontSize: 11, cursor: 'grab', flex: '0 0 auto' }
// A drop-target line shown in the gap between subcards while dragging. Negative margin
// pulls it into the flex gap so it reads as a divider, not an added row.
const dropLine: CSSProperties = {
  height: 2,
  margin: '-2px 2px',
  borderRadius: 1,
  background: UI.accent,
  pointerEvents: 'none'
}
const stat: CSSProperties = {
  color: UI.text,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  marginTop: 2
}
const errText: CSSProperties = { color: '#f2b8b9', fontSize: 10, lineHeight: 1.4 }
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
const configFloat: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: '100%',
  marginLeft: 14,
  zIndex: 1000,
  cursor: 'default'
}
