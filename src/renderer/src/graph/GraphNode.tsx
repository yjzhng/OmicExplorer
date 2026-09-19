import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'

import { StatusNote } from '../ui/StatusNote'
import { UI } from '../ui/theme'
import { AddPlotMenu, NodeConfigPanel, PANEL_WIDTH } from './NodeConfigPanel'
import {
  accentOf,
  categoryOf,
  CATEGORIES,
  hasSourceHandle,
  NODE_SPECS,
  plotLabel
} from './registry'
import { unmetRequirement } from './requirements'
import { useUpstreamFacts } from './useUpstreamFacts'
import { useGraph } from './store'
import { TilePicker } from './TilePicker'
import { isCompareConfigured, isStep, normalizeCompareConfig, resolveLoadMode } from './types'
import { VALID_CONDITIONS } from '../engine'
import type {
  CompareConfig,
  LoadConfig,
  NodeData,
  NodeKind,
  PlaceholderData,
  PlotGroupConfig,
  StepStatus
} from './types'

/** Tile names may only hold letters, digits, space, `.`, `_` and `-`: they lead the file name of
 *  every plot/table downloaded from the tile, so anything else is dropped as it's typed. */
const safeTileName = (v: string): string => v.replace(/[^A-Za-z0-9 ._-]+/g, '')

// One-time keyframes for the running-status pulse (self-contained; canvas nodes don't share
// the dashboard stylesheet).
if (typeof document !== 'undefined' && !document.getElementById('oe-status-kf')) {
  const el = document.createElement('style')
  el.id = 'oe-status-kf'
  el.textContent = '@keyframes oe-status-pulse{0%,100%{opacity:1}50%{opacity:.3}}'
  document.head.appendChild(el)
}

interface StatusInfo {
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

/** A persistent top-right status dot: run state for runnable tiles, upstream-readiness for
 *  live tiles (plots), so every tile shows its state at a glance. */
function StatusDot({ color, label, pulse }: StatusInfo) {
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
function RunControl({
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
  const addGroupChildren = useGraph((s) => s.addGroupChildren)
  const removeGroupChildren = useGraph((s) => s.removeGroupChildren)
  // The group's upstream: gates which plots the add-plot menu offers (kind + response axes).
  const upstreamKind = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return up && isStep(up) ? up.data.kind : undefined
  })
  // What the upstream data carries (stale-aware): gates the menu and flags unsupported subcards.
  const upId = useGraph((s) => s.edges.find((e) => e.target === id)?.source)
  const facts = useUpstreamFacts(upId)
  // id of the subcard being dragged, and the gap it's over (target card + which side).
  const [dragId, setDragId] = useState<string | null>(null)
  const [gap, setGap] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const reset = (): void => {
    setDragId(null)
    setGap(null)
  }
  return (
    <div style={subList}>
      {/* Add / remove plots right on the tile, above the subcard stack. nodrag/nowheel so the
          menu's interactions never move the node or zoom the canvas. */}
      <div className="nodrag nowheel" onClick={(e) => e.stopPropagation()} style={{ display: 'flex' }}>
        <AddPlotMenu
          children={config.children}
          upstreamKind={upstreamKind}
          upstream={facts}
          onAdd={(specs) => addGroupChildren(id, specs)}
          onRemove={(ids) => removeGroupChildren(id, ids)}
        />
      </div>
      {config.children.length === 0 && <div style={muted}>Empty group.</div>}
      {config.children.map((c) => {
        const active = selectedSub === c.id
        const unmet = unmetRequirement(c.kind, c.config, facts)
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
              // An unsupported plot (its requirement no longer holds after an upstream change) stays
              // in the group but reads disabled, with the reason on hover.
              title={unmet ?? undefined}
              style={{
                ...subCard,
                borderColor: active ? accent : UI.border,
                background: active ? UI.panelAlt : UI.panel,
                opacity: dragId === c.id ? 0.4 : unmet ? 0.45 : 1
              }}
            >
              <span style={grip}>⠿</span>
              <span style={{ ...dot, background: unmet ? UI.textMuted : accent }} />
              <span style={subLabel}>{plotLabel(c.kind, c.config)}</span>
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
  // Gate: a Standardize whose upstream is an Interactive Load that hasn't been converted yet is
  // blocked until the user completes the sample setup (which materializes the input files).
  const stdGate = useGraph((s) => {
    if (data.kind !== 'standardize') return null
    const upId = s.upstreamId(id)
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    if (up && isStep(up) && up.data.kind === 'load') {
      const c = up.data.config as LoadConfig
      if (resolveLoadMode(c) === 'interactive' && !c.data) return 'Configure samples first'
    }
    return null
  })
  const gate =
    stdGate ??
    (data.kind === 'compare' && !isCompareConfigured(data.config as CompareConfig)
      ? 'Configure comparison first'
      : null)
  // Config float opens for the single store selection; the accent border also lights up
  // for React Flow's own selection so every marquee-selected tile reads as selected.
  const configOpen = selectedId === id
  const selected = configOpen || !!rfSelected
  const [hovered, setHovered] = useState(false)
  const sideColor = selected ? accent : UI.border

  // Status dot: runnable tiles show their run lifecycle; live tiles (plots) are green only when
  // the upstream has a result AND every requirement holds (kind + data shape — see
  // requirements.ts), else grey with the reason. A group is green when all its plots are. Load
  // (no upstream) reads as ready.
  const plotUpId = useGraph((s) => (spec.hasRun ? undefined : s.upstreamId(id)))
  const plotFacts = useUpstreamFacts(plotUpId)
  const plotBlock = ((): string | null => {
    if (spec.hasRun) return null
    if (data.kind === 'load') return null
    if (!plotUpId) return 'Waiting for data'
    const kinds: { kind: NodeKind; config: unknown }[] =
      data.kind === 'plotGroup'
        ? (data.config as PlotGroupConfig).children.map((c) => ({ kind: c.kind, config: c.config }))
        : [{ kind: data.kind, config: data.config }]
    for (const k of kinds) {
      const why = unmetRequirement(k.kind, k.config, plotFacts)
      if (why) return kinds.length > 1 ? `${plotLabel(k.kind, k.config)}: ${why}` : why
    }
    if (!plotFacts.result) return 'Waiting for data'
    return null
  })()
  const statusInfo: StatusInfo = spec.hasRun
    ? runStatusInfo(data.status)
    : plotBlock
      ? { color: UI.textMuted, label: plotBlock, pulse: false }
      : { color: '#3fae5a', label: 'Ready', pulse: false }

  // Inline rename: double-click the title to edit; Enter/blur commits, Escape cancels.
  const renameNode = useGraph((s) => s.renameNode)
  const [editing, setEditing] = useState(false)
  const [nameHover, setNameHover] = useState(false)
  const [draft, setDraft] = useState('')
  const typeText =
    data.kind === 'plotGroup'
      ? `${spec.label} · ${(data.config as PlotGroupConfig).children.length}`
      : plotLabel(data.kind, data.config) // dr → axis-specific (Dose-/Time-response)
  const startRename = (): void => {
    setDraft(data.name ?? '')
    setEditing(true)
  }
  const commitRename = (): void => {
    renameNode(id, safeTileName(draft))
    setEditing(false)
  }

  const rf = useReactFlow()
  const cardRef = useRef<HTMLDivElement>(null)
  // Which side the detail panel opens on. Default right of the tile; flip to the left when the
  // panel would run past the canvas's right edge and there's room on the left. Decided ONCE when
  // the panel opens — it stays put while the user pans/zooms, so it never jumps mid-edit.
  const [panelSide, setPanelSide] = useState<'right' | 'left'>('right')
  useLayoutEffect(() => {
    if (!configOpen) return
    const el = cardRef.current
    if (!el) return
    const card = el.getBoundingClientRect()
    const canvas = el.closest('.react-flow')?.getBoundingClientRect()
    const right = canvas?.right ?? window.innerWidth
    const left = canvas?.left ?? 0
    // Read the zoom at open time (not subscribed — a later pan/zoom must not re-place the panel).
    const need = (PANEL_WIDTH + PANEL_GAP) * rf.getViewport().zoom
    const fitsRight = card.right + need <= right
    const fitsLeft = card.left - need >= left
    setPanelSide(!fitsRight && fitsLeft ? 'left' : 'right')
  }, [configOpen, rf])
  // Scrolling over a tile pans (React Flow's pan-on-scroll, same as empty canvas) and zoom is
  // pinch / ctrl+scroll — except inside the detail window (`.nowheel`), which React Flow ignores
  // entirely so its content can scroll natively. A pinch there (a trackpad pinch arrives as a
  // wheel event with ctrlKey) would otherwise be lost, so it's handled here and drives the
  // viewport directly.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || !(e.target as HTMLElement).closest?.('.nowheel')) return
      e.preventDefault()
      e.stopPropagation()
      const { x, y, zoom } = rf.getViewport()
      // Pinch deltas are small, so (like d3-zoom) they get a 10× rate.
      const nextZoom = Math.min(2, Math.max(0.5, zoom * Math.pow(1.0015, -e.deltaY * 10)))
      if (nextZoom === zoom) return
      // Keep the flow point under the cursor fixed: new translate = old + p·(zoom − nextZoom).
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      rf.setViewport({ x: x + p.x * (zoom - nextZoom), y: y + p.y * (zoom - nextZoom), zoom: nextZoom })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [rf])

  return (
    <div
      ref={cardRef}
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
      {spec.acceptsFrom.length > 0 && (
        <Handle type="target" position={Position.Left} style={handleStyle} />
      )}
      <div style={header}>
        <span style={titleWrap}>
          <span style={{ ...catTag, color: accent }}>{CATEGORIES[category].label}</span>
          {editing ? (
            <input
              // `nodrag` + stopPropagation so typing/clicking the field doesn't drag the node.
              className="nodrag"
              autoFocus
              value={draft}
              placeholder={typeText}
              // File-name-safe only: the name leads downloaded plots/tables (see PanelTile).
              onChange={(e) => setDraft(safeTileName(e.target.value))}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                else if (e.key === 'Escape') setEditing(false)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={nameInput}
            />
          ) : (
            <span
              // Dashed chip appears only while hovering the name itself; single click edits.
              // Border stays 1px (transparent when idle) so revealing it doesn't shift layout.
              style={{ ...opLabel, ...nameChip, borderColor: nameHover ? accent : 'transparent' }}
              onMouseEnter={() => setNameHover(true)}
              onMouseLeave={() => setNameHover(false)}
              onClick={(e) => {
                e.stopPropagation()
                startRename()
              }}
              title="Click to rename"
            >
              {data.name ?? typeText}
            </span>
          )}
          {/* Type label as a subtitle whenever there's a name, and always while editing (so the
              type stays visible as you name the tile). */}
          {(data.name || editing) && <span style={typeSub}>{plotLabel(data.kind, data.config)}</span>}
        </span>
        <div style={headerRight}>
          {spec.hasRun && (hovered || selected) && (
            <RunControl
              status={data.status}
              accent={accent}
              onRun={() => void runNode(id)}
              onStop={() => cancelNode(id)}
              gate={gate}
            />
          )}
          <StatusDot {...statusInfo} />
        </div>
      </div>
      <div style={body}>
        {data.kind === 'plotGroup' ? (
          <GroupBody id={id} config={data.config as PlotGroupConfig} accent={accent} />
        ) : (
          <NodeSummary kind={data.kind} id={id} result={result} config={data.config} />
        )}
        {data.error && (
          <StatusNote kind="error" style={{ fontSize: 10, marginTop: 4 }}>
            {data.error}
          </StatusNote>
        )}
      </div>
      {hasSourceHandle(data.kind) && (
        <Handle type="source" position={Position.Right} style={handleStyle} />
      )}
      {configOpen && (
        // Stop clicks inside the panel from bubbling to the node's onNodeClick, which
        // calls selectNode → clears selectedSub — that reset the active subcard to the
        // first on every interaction with a group's config.
        <div
          className="nodrag nowheel"
          style={{
            ...configFloat,
            ...(panelSide === 'left'
              ? { right: '100%', marginRight: PANEL_GAP }
              : { left: '100%', marginLeft: PANEL_GAP })
          }}
          onClick={(e) => e.stopPropagation()}
        >
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
  // Significant-row count is O(rows); memoize on the result so it isn't recomputed on every
  // re-render of the tile (e.g. a hover toggle) — that stalled on large comparison tables.
  const signfCount = useMemo(() => {
    if (result?.kind === 'compare') return result.cmp.rows.filter((r) => r.signf).length
    if (result?.kind === 'contrast') return result.ctr.rows.filter((r) => r.signf).length
    return 0
  }, [result])
  if (kind === 'load') {
    const cfg = config as LoadConfig
    const loaded = !!cfg.data && !!cfg.samplesheet
    return (
      <div style={muted}>
        {loaded
          ? `Data loaded ${resolveLoadMode(cfg) === 'interactive' ? 'interactively' : 'manually'}`
          : 'Data not yet loaded'}
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
    const cfg = normalizeCompareConfig(config as CompareConfig)
    const cmp = result?.kind === 'compare' ? result.cmp : null
    const sideShort = (sel: CompareConfig['num']): string =>
      VALID_CONDITIONS.filter((k) => (sel[k]?.length ?? 0) > 0)
        .map((k) => (sel[k] as string[]).join('/'))
        .join(',') || '—'
    // Once run, show just the comparison COUNT (the detailed strings can be long when a
    // comparison spans many values); before running, a concise config preview.
    const n = cmp?.comparisons.length ?? 0
    const label = cmp
      ? `${n} comparison${n === 1 ? '' : 's'}`
      : cfg.analysis === 'two_way_anova'
        ? `two-way · ${cfg.condition}×${cfg.condition2}`
        : `${sideShort(cfg.num)} vs ${sideShort(cfg.den)}`
    return (
      <div style={muted}>
        {label}
        {cmp && (
          <div style={stat}>
            {cmp.rows.length.toLocaleString()} rows · {signfCount} signif
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
            {ctr.rows.length.toLocaleString()} rows · {signfCount} signif
          </div>
        )}
      </div>
    )
  }
  if (kind === 'volcano') return <div style={muted}>log₂FC vs significance. Select to view.</div>
  if (kind === 'scatter') return <div style={muted}>Group A vs group B. Select to view.</div>
  if (kind === 'ma') return <div style={muted}>Abundance vs log₂FC. Select to view.</div>
  if (kind === 'dr') return <div style={muted}>Response curves. Select to view.</div>
  if (kind === 'bubble') return <div style={muted}>Gene × dose bubble grid. Select to view.</div>
  if (kind === 'dumbbell') return <div style={muted}>Group A ↔ group B per gene. Select to view.</div>
  if (kind === 'tdr')
    return <div style={muted}>Dose×time response per selected gene. Select to view.</div>
  if (kind === 'geneBar')
    return <div style={muted}>Selected gene value across conditions. Select to view.</div>
  if (kind === 'pca')
    return <div style={muted}>Cluster samples or responsome (PCA/UMAP/t-SNE). Select to view.</div>
  if (kind === 'qc')
    return <div style={muted}>Per-sample QC (intensity / CV / #proteins). Select to view.</div>
  if (kind === 'corr')
    return <div style={muted}>Sample × sample correlation matrix. Select to view.</div>
  return <div style={muted}>Genes × samples. Select to view.</div>
}

/** Transient tile shown between drop and op selection — the type picker *is* the tile,
 *  so there is a single surface at the drop point (not a separate floating menu). */
export function PlaceholderNode({ id, data }: NodeProps<Node<PlaceholderData>>) {
  const resolvePlaceholder = useGraph((s) => s.resolvePlaceholder)
  // Gate plot options by what the upstream data actually carries (see requirements.ts), reading
  // through a stale upstream to the Clean data tile's declared conditions.
  const facts = useUpstreamFacts(data.source ?? undefined)
  return (
    <div style={{ position: 'relative' }}>
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <TilePicker
        ops={data.ops}
        header="New step"
        upstream={data.source ? facts : undefined}
        onPick={(picks) => resolvePlaceholder(id, picks)}
      />
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const nodeTypes = {
  step: GraphNode,
  placeholder: PlaceholderNode
}

// Connection handles: enlarge React Flow's default ~6px dots so the edge
// attach/detach points between step tiles are easier to see and grab. Fill/stroke
// use theme vars so they invert in dark mode (light dot + dark ring, and vice versa).
const handleStyle: CSSProperties = {
  width: 12,
  height: 12,
  background: UI.bg,
  border: `2px solid ${UI.textMuted}`
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
// flex:1 + minWidth:0 so the title column (and the rename input inside it) shares the header width
// and shrinks — otherwise a fixed-width input grows the column and shoves the run/status cluster.
const titleWrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  flex: 1,
  minWidth: 0
}
// Header right cluster: the run chip (on hover) and the always-on status dot. The fixed
// minHeight matches the run chip so the dot keeps its vertical position whether or not the
// chip is present (otherwise the taller chip re-centers the dot when it appears).
const headerRight: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
  minHeight: 21
}
const catTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6
}
const opLabel: CSSProperties = { fontWeight: 600 }
// Dashed pill around the tile name, hinting it's editable (double-click to rename).
const nameChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  alignSelf: 'flex-start',
  maxWidth: '100%',
  padding: '0 6px',
  border: `1px dashed ${UI.border}`,
  borderRadius: 5,
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}
// Type subtitle, shown under a user-given name (the intrinsic kind label, e.g. "Compare").
const typeSub: CSSProperties = { fontSize: 10, color: UI.textMuted, fontWeight: 500 }
// Inline rename field — matches the name chip's box (same font, padding, border, radius) so
// swapping the label for the input doesn't change the header's height or push the body.
const nameInput: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 'inherit',
  background: UI.panelAlt,
  color: UI.text,
  border: `1px solid ${UI.accent}`,
  borderRadius: 5,
  padding: '0 6px',
  margin: 0,
  width: '100%', // fill the (flex) title column instead of a fixed width that pushes the header
  boxSizing: 'border-box'
}
const body: CSSProperties = { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }
const muted: CSSProperties = {
  color: UI.textMuted,
  fontSize: 11,
  lineHeight: 1.45,
  // Break long unbroken filenames (underscores/paths) so they wrap inside the fixed-width tile
  // instead of overflowing it.
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  minWidth: 0
}
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
/** Gap between a tile and its detail panel (flow units). */
const PANEL_GAP = 14
/** Detail panel float: top-aligned beside the tile; the side is chosen at render (see panelSide). */
const configFloat: CSSProperties = {
  position: 'absolute',
  top: 0,
  zIndex: 1000,
  cursor: 'default'
}
