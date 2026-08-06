import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type FinalConnectionState,
  type OnConnectStartParams
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { ResultsView } from './dashboard/ResultsView'
import { ExportModal } from './export/ExportModal'
import { UserGuide } from './ui/UserGuide'
import { RELEASES_URL, useUpdateCheck, type UpdateInfo } from './ui/useUpdateCheck'
import { edgeTypes } from './graph/GraphEdge'
import { nodeTypes } from './graph/GraphNode'
import { useGraph } from './graph/store'
import { accentOf, ALL_OPS, canConnect, categoryOf, NODE_SPECS } from './graph/registry'
import { isStep, type NodeData, type StepNode } from './graph/types'
import { cssVars, PALETTES, UI } from './ui/theme'
import { useAppView, type AppView } from './ui/useAppView'
import { useUiTheme } from './ui/useUiTheme'

/** Bottom-center "New step" button; toggles placement mode (becomes "Cancel" while placing). */
function NewStep({
  placing,
  onToggle
}: {
  placing: boolean
  onToggle: (e: ReactMouseEvent) => void
}) {
  return (
    <Panel position="bottom-center">
      <button
        className="new-step-btn"
        style={{ ...styles.newStepBtn, ...(placing ? styles.newStepBtnActive : {}) }}
        onClick={onToggle}
      >
        {placing ? 'Cancel' : '+ New step'}
      </button>
    </Panel>
  )
}

/** Dashed ghost tile that follows the cursor while placing a new step. */
function PlacementGhost({ x, y }: { x: number; y: number }) {
  return <div style={{ ...styles.ghost, left: x, top: y }}>+ New step</div>
}

/** Bottom-right direction pad — four house-shaped wedges (a 24×24 square fused to a
 *  right-angled 45-45-90 triangle roof, whose hypotenuse is the square's side) whose
 *  pointy ends meet at the centre; pans the canvas for users without scroll input.
 *  Rounded corners come from the fill+round-join trick (clip-path can't round corners). */
function PanControls({ onPan }: { onPan: (dx: number, dy: number) => void }) {
  const STEP = 150
  const [hover, setHover] = useState<string | null>(null)
  // Base house pointing DOWN toward the centre: 24×24 square (y 11→35), then a right-angle
  // roof whose base (hypotenuse) is 24 wide and apex sits 12 below (half the base) at
  // (50,47) — a 90° tip, 45° base angles. Each button rotates this around the pad centre.
  const HOUSE = 'M38 11 L62 11 L62 35 L50 47 L38 35 Z'
  // A small arrow near the OUTER edge of the square, pointing outward (= the pan
  // direction), so each button shows which way it moves the view.
  const ARROW = 'M50 13 L57 23 L43 23 Z'
  const GAP = 6 // nudge each house outward (local −y) so a small gap opens at the centre
  const dirs = [
    { k: 'u', deg: 0, dx: 0, dy: STEP, t: 'Pan up' },
    { k: 'r', deg: 90, dx: -STEP, dy: 0, t: 'Pan right' },
    { k: 'd', deg: 180, dx: 0, dy: -STEP, t: 'Pan down' },
    { k: 'l', deg: 270, dx: STEP, dy: 0, t: 'Pan left' }
  ]
  return (
    <Panel position="bottom-right">
      <svg width={58} height={58} viewBox="0 0 100 100" style={{ overflow: 'visible' }}>
        {dirs.map((d) => {
          // Faint OPAQUE house (fill == stroke, so the round-join corners don't double
          // up into a visible outline the way a translucent fill+stroke did); the arrow
          // carries the direction and stays brighter than the house.
          const col = hover === d.k ? UI.textMuted : UI.border
          return (
            <g
              key={d.k}
              // translate (local −y = outward) is applied before the rotation, so every
              // house shifts away from the centre along its own arm by the same GAP, and
              // the arrow rotates with it to point outward.
              transform={`rotate(${d.deg} 50 50) translate(0 ${-GAP})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(d.k)}
              onMouseLeave={() => setHover((h) => (h === d.k ? null : h))}
              onClick={() => onPan(d.dx, d.dy)}
            >
              <title>{d.t}</title>
              <path d={HOUSE} fill={col} stroke={col} strokeWidth={5} strokeLinejoin="round" />
              <path
                d={ARROW}
                fill={hover === d.k ? UI.text : UI.textMuted}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          )
        })}
      </svg>
    </Panel>
  )
}

/** Action bar for the current marquee selection (Group/Ungroup/Duplicate/Delete). */
function SelectionActions({
  count,
  canGroup,
  canUngroup,
  onGroup,
  onUngroup,
  onCascade,
  onDuplicate,
  onDelete
}: {
  count: number
  canGroup: boolean
  canUngroup: boolean
  onGroup: () => void
  onUngroup: () => void
  onCascade: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const btn = (label: string, enabled: boolean, fn: () => void, title: string, danger = false) => (
    <button
      disabled={!enabled}
      title={title}
      onClick={fn}
      style={{
        ...styles.actBtn,
        ...(danger ? styles.actBtnDanger : {}),
        opacity: enabled ? 1 : 0.4,
        cursor: enabled ? 'pointer' : 'not-allowed'
      }}
    >
      {label}
    </button>
  )
  return (
    <Panel position="bottom-center">
      <div style={styles.actBar}>
        <span style={styles.actCount}>{count} selected</span>
        {btn('Group', canGroup, onGroup, 'Group ≥2 plots that share one upstream')}
        {btn('Ungroup', canUngroup, onUngroup, 'Split the selected group(s) back into plots')}
        {btn('Cascade', count > 1, onCascade, 'Auto-arrange the selection in a cascade')}
        {btn('Duplicate', true, onDuplicate, 'Duplicate the selection')}
        {btn('Delete', true, onDelete, 'Delete the selection', true)}
      </div>
    </Panel>
  )
}

function Canvas() {
  const mode = useUiTheme((s) => s.mode)
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const onNodesChange = useGraph((s) => s.onNodesChange)
  const onEdgesChange = useGraph((s) => s.onEdgesChange)
  const onConnect = useGraph((s) => s.onConnect)
  const onReconnect = useGraph((s) => s.onReconnect)
  const onEdgesDelete = useGraph((s) => s.onEdgesDelete)
  const isValidConnection = useGraph((s) => s.isValidConnection)
  const selectNode = useGraph((s) => s.selectNode)
  const addNode = useGraph((s) => s.addNode)
  const addPlaceholder = useGraph((s) => s.addPlaceholder)
  const cancelPlaceholder = useGraph((s) => s.cancelPlaceholder)
  const commit = useGraph((s) => s.commit)
  const groupNodes = useGraph((s) => s.groupNodes)
  const ungroupNodes = useGraph((s) => s.ungroupNodes)
  const cascadeNodes = useGraph((s) => s.cascadeNodes)
  const duplicateNodes = useGraph((s) => s.duplicateNodes)
  const deleteNode = useGraph((s) => s.deleteNode)
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow()
  // Nudge the viewport for users without scroll input (the direction pad, below).
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = getViewport()
      setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 150 })
    },
    [getViewport, setViewport]
  )

  // Marquee multi-selection (drag on empty canvas) drives the floating action bar.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Array<{ id: string; type?: string }> }) => {
      const ids = sel.filter((n) => n.type !== 'placeholder').map((n) => n.id)
      setSelectedIds(ids)
      useGraph.getState().setCanvasSelection(ids)
      // A deliberate single selection also opens that node's config float; 0 or many
      // leave the float alone (so grouping, which reselects the new group, isn't undone).
      if (ids.length === 1) selectNode(ids[0])
    },
    [selectNode]
  )
  // Group is offered only for ≥2 plotting tiles sharing one upstream (see store.groupNodes).
  const selStep = selectedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is StepNode => !!n && isStep(n))
  const oneUpstream = (() => {
    const ups = new Set<string>()
    for (const n of selStep) {
      const u = edges.filter((e) => e.target === n.id).map((e) => e.source)
      if (u.length !== 1) return false
      ups.add(u[0])
    }
    return ups.size === 1
  })()
  const canGroup =
    selStep.length >= 2 &&
    selStep.length === selectedIds.length &&
    selStep.every((n) => categoryOf(n.data.kind) === 'plotting') &&
    oneUpstream
  const canUngroup = selStep.some((n) => n.data.kind === 'plotGroup')
  const clearSelection = useCallback(() => setSelectedIds([]), [])

  // Any pending placeholder is dismissed when the user does anything but pick a type.
  const dismissPlaceholders = useCallback(() => {
    for (const n of useGraph.getState().nodes) if (n.type === 'placeholder') cancelPlaceholder(n.id)
  }, [cancelPlaceholder])

  // "New step" placement mode: a ghost tile follows the cursor; a pane click drops a
  // free (source-less) placeholder there, which then shows its inline type picker.
  const [placing, setPlacing] = useState(false)
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const togglePlacing = useCallback(() => {
    dismissPlaceholders()
    if (placing) {
      setPlacing(false)
      setGhost(null)
    } else {
      // Enter placing mode with NO ghost yet — it appears only once the cursor leaves
      // the button area (see onCanvasMouseMove), so it never flashes under the button.
      setPlacing(true)
      setGhost(null)
    }
  }, [placing, dismissPlaceholders])
  const onCanvasMouseMove = useCallback(
    (e: ReactMouseEvent) => {
      if (!placing) return
      // Keep the ghost hidden while the pointer is still over the New step / Cancel button.
      if ((e.target as HTMLElement).closest?.('.new-step-btn')) {
        setGhost(null)
        return
      }
      setGhost({ x: e.clientX, y: e.clientY })
    },
    [placing]
  )
  // Drop a free placeholder at the click point (offset so it lands under the cursor).
  const placeAt = useCallback(
    (e: ReactMouseEvent) => {
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addPlaceholder(null, ALL_OPS, { x: flow.x - 80, y: flow.y - 20 })
      setPlacing(false)
      setGhost(null)
    },
    [screenToFlowPosition, addPlaceholder]
  )
  // Esc cancels placement.
  useEffect(() => {
    if (!placing) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPlacing(false)
        setGhost(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [placing])

  // MiniMap is shown only while the user pans/zooms, then fades out.
  const [showMini, setShowMini] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const onMoveStart = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    setShowMini(true)
  }, [])
  const onMoveEnd = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowMini(false), 900)
  }, [])

  // Drag from a node's output handle and release over empty canvas → create + connect a
  // new tile right there (edge persists). A single valid next step is created directly; if
  // several are valid, a placeholder tile with an inline type picker lands at the drop point.
  const connectingFrom = useRef<string | null>(null)

  const onConnectStart = useCallback((_e: unknown, params: OnConnectStartParams) => {
    connectingFrom.current = params.handleType === 'source' ? params.nodeId : null
  }, [])

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      const sourceId = connectingFrom.current
      connectingFrom.current = null
      if (!sourceId) return
      if (connectionState.isValid || connectionState.toNode) return // dropped on a node → normal connect
      const pt = 'changedTouches' in event ? event.changedTouches[0] : event
      const sourceNode = useGraph.getState().nodes.find((n) => n.id === sourceId)
      if (!sourceNode || !isStep(sourceNode)) return
      const ops = ALL_OPS.filter((o) => canConnect(sourceNode.data.kind, o))
      if (ops.length === 0) return
      const flow = screenToFlowPosition({ x: pt.clientX, y: pt.clientY })
      const position = { x: flow.x, y: flow.y - 45 }
      dismissPlaceholders() // never stack two pending placeholders
      if (ops.length === 1) addNode(ops[0], { position, connectFrom: sourceId })
      else addPlaceholder(sourceId, ops, position)
    },
    [screenToFlowPosition, addNode, addPlaceholder, dismissPlaceholders]
  )

  return (
    <div
      style={{ ...styles.canvas, cursor: placing ? 'copy' : undefined }}
      onMouseMove={onCanvasMouseMove}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onEdgesDelete={onEdgesDelete}
        isValidConnection={isValidConnection}
        onNodeClick={(e, node) => {
          if (placing) return placeAt(e)
          if (node.type === 'placeholder') return // clicks inside are the type picker
          dismissPlaceholders()
          selectNode(node.id)
        }}
        onPaneClick={(e) => {
          if (placing) return placeAt(e)
          dismissPlaceholders()
          selectNode(null)
        }}
        onNodeDragStart={() => commit()}
        onSelectionChange={onSelectionChange}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        // Scroll (trackpad two-finger / wheel, both axes) pans the canvas; a drag on
        // empty canvas always marquee-selects, and a drag on a node moves it. This makes
        // a pan/select mode toggle unnecessary.
        panOnScroll
        panOnDrag={false}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        zoomOnScroll={false}
        zoomOnPinch
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.4}
          color={PALETTES[mode].axis}
        />
        {/* Bottom-centre; hidden while the selection action bar occupies that spot. */}
        {selectedIds.length === 0 && <NewStep placing={placing} onToggle={togglePlacing} />}
        {selectedIds.length > 0 && (
          <SelectionActions
            count={selectedIds.length}
            canGroup={canGroup}
            canUngroup={canUngroup}
            onGroup={() => {
              groupNodes(selectedIds)
              clearSelection()
            }}
            onUngroup={() => {
              ungroupNodes(selectedIds)
              clearSelection()
            }}
            onCascade={() => cascadeNodes(selectedIds)}
            // Copies land on top and become the selection (via node.selected), so the
            // action bar follows them — no clearSelection here.
            onDuplicate={() => duplicateNodes(selectedIds)}
            onDelete={() => {
              selectedIds.forEach((id) => deleteNode(id))
              clearSelection()
            }}
          />
        )}
        <PanControls onPan={panBy} />
        <Controls position="bottom-left" showInteractive={false} />
        {showMini && (
          <MiniMap
            position="top-right"
            pannable
            zoomable
            nodeColor={(n) =>
              n.type === 'placeholder' ? UI.border : accentOf(categoryOf((n.data as NodeData).kind))
            }
            style={{ background: UI.panel, width: 88, height: 60 }}
            maskColor="rgba(0,0,0,0.5)"
          />
        )}
      </ReactFlow>
      {placing && ghost && <PlacementGhost x={ghost.x} y={ghost.y} />}
    </div>
  )
}

function SettingsPopover({
  onClose,
  update,
  silenced,
  onToggleSilence
}: {
  onClose: () => void
  update: UpdateInfo
  silenced: boolean
  onToggleSilence: () => void
}) {
  const preference = useUiTheme((s) => s.preference)
  const setPreference = useUiTheme((s) => s.setPreference)
  const [active, setActive] = useState<'appearance' | 'about'>('appearance')
  const showDot = update.updateAvailable && !silenced
  const APPEARANCE = [
    { v: 'auto', label: '◐ Auto' },
    { v: 'dark', label: '☾ Dark' },
    { v: 'light', label: '☀ Light' }
  ] as const
  const SECTIONS = [
    { id: 'appearance', title: 'Appearance', dot: false },
    { id: 'about', title: 'About', dot: showDot }
  ] as const
  return (
    <>
      <div style={styles.dialogScrim} onClick={onClose} />
      <div style={styles.settingsModal} role="dialog" aria-label="Settings">
        <div style={styles.settingsModalHead}>
          <span style={styles.settingsModalTitle}>Settings</span>
          <button style={styles.settingsClose} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div style={styles.settingsBody}>
          <nav style={styles.settingsNav}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                style={{
                  ...styles.settingsNavItem,
                  background: active === s.id ? UI.accent : 'transparent',
                  color: active === s.id ? UI.accentText : UI.text
                }}
              >
                <span>{s.title}</span>
                {s.dot && <span style={styles.settingsNavDot} />}
              </button>
            ))}
          </nav>
          <div style={styles.settingsContent}>
            {active === 'appearance' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Appearance</h2>
                <div style={{ ...styles.segmented, display: 'inline-flex' }}>
                  {APPEARANCE.map((o) => (
                    <button
                      key={o.v}
                      onClick={() => setPreference(o.v)}
                      style={{
                        ...styles.segment,
                        padding: '5px 12px',
                        background: preference === o.v ? UI.accent : 'transparent',
                        color: preference === o.v ? UI.accentText : UI.text
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {preference === 'auto' && (
                  <div style={styles.settingsHint}>Following your system colour scheme.</div>
                )}
              </>
            ) : (
              <>
                <h2 style={styles.settingsContentTitle}>About</h2>
                <div style={styles.aboutName}>
                  {__APP_NAME__} · v{update.current}
                </div>
                {update.updateAvailable ? (
                  <>
                    <div style={styles.aboutUpdate}>
                      <span style={styles.aboutDot} /> Update available — v{update.latest}
                    </div>
                    <a
                      href={update.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.aboutLink}
                    >
                      Download the latest release →
                    </a>
                  </>
                ) : update.latest ? (
                  <div style={styles.aboutMuted}>You&apos;re on the latest version.</div>
                ) : (
                  <a href={RELEASES_URL} target="_blank" rel="noreferrer" style={styles.aboutLink}>
                    Releases on GitHub →
                  </a>
                )}
                <label style={styles.silenceRow}>
                  <span>Silence update dot</span>
                  <input type="checkbox" checked={silenced} onChange={onToggleSilence} />
                </label>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** Segmented Canvas | Results switch for the top nav. */
function ViewToggle() {
  const view = useAppView((s) => s.view)
  const setView = useAppView((s) => s.setView)
  return (
    <div style={styles.segmented}>
      {(['canvas', 'results'] as const).map((v: AppView) => (
        <button
          key={v}
          onClick={() => setView(v)}
          style={{
            ...styles.segment,
            background: view === v ? UI.accent : 'transparent',
            color: view === v ? UI.accentText : UI.text
          }}
        >
          {v === 'canvas' ? 'Workflow' : 'Results'}
        </button>
      ))}
    </div>
  )
}

/** The folder chip: shows the active folder and a dropdown to switch/add/delete. */
function FolderChip() {
  const folders = useGraph((s) => s.folders)
  const activeFolderId = useGraph((s) => s.activeFolderId)
  const dataDirMissing = useGraph((s) => s.dataDirMissing)
  const switchFolder = useGraph((s) => s.switchFolder)
  const addFolder = useGraph((s) => s.addFolder)
  const deleteFolder = useGraph((s) => s.deleteFolder)
  const repathFolder = useGraph((s) => s.repathFolder)
  const [open, setOpen] = useState(false)
  const active = folders.find((f) => f.id === activeFolderId) ?? null
  const label = active ? (active.path ? active.name : 'Select folder…') : 'no folder'

  return (
    <div style={{ position: 'relative' }}>
      <button
        style={{ ...styles.chipSeg, ...(dataDirMissing ? styles.chipSegWarn : null) }}
        title={dataDirMissing ? `Folder not found: ${active?.path}` : active?.path || 'folder'}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.chipIcon}>{dataDirMissing ? '⚠' : <IconFolder />}</span>
        {label} ▾
      </button>
      {open && (
        <>
          <div style={styles.scrim} onClick={() => setOpen(false)} />
          <div style={styles.folderMenu}>
            {folders.map((f) => {
              const missing = f.id === activeFolderId && dataDirMissing
              return (
                <div
                  key={f.id}
                  style={{
                    ...styles.folderRow,
                    background: f.id === activeFolderId ? UI.panelAlt : 'transparent'
                  }}
                >
                  <button
                    style={styles.folderPick}
                    title={f.path || 'no path set'}
                    onClick={() => {
                      if (missing) void repathFolder(f.id)
                      else switchFolder(f.id)
                      setOpen(false)
                    }}
                  >
                    <span style={styles.folderName}>
                      {missing
                        ? `⚠ ${f.name} — not found`
                        : f.path
                          ? f.name
                          : `${f.name} (no path)`}
                    </span>
                    <span style={{ ...styles.folderPath, ...(missing ? styles.pathWarn : null) }}>
                      {f.path || '—'}
                    </span>
                    {missing && <span style={styles.repathHint}>Click to re-select folder…</span>}
                  </button>
                  {folders.length > 1 && (
                    <button
                      style={styles.folderDel}
                      title="Delete folder"
                      onClick={() => deleteFolder(f.id)}
                    >
                      🗑
                    </button>
                  )}
                </div>
              )
            })}
            <button
              style={styles.folderAdd}
              onClick={() => {
                void addFolder()
                setOpen(false)
              }}
            >
              ＋ Add folder…
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Workflow chip: switch/rename/delete workflows in the active folder, or add one. */
function WorkflowChip() {
  const folders = useGraph((s) => s.folders)
  const activeFolderId = useGraph((s) => s.activeFolderId)
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId)
  const switchWorkflow = useGraph((s) => s.switchWorkflow)
  const addWorkflow = useGraph((s) => s.addWorkflow)
  const renameWorkflow = useGraph((s) => s.renameWorkflow)
  const deleteWorkflow = useGraph((s) => s.deleteWorkflow)
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  const workflows = folders.find((f) => f.id === activeFolderId)?.workflows ?? []
  const active = workflows.find((w) => w.id === activeWorkflowId) ?? null

  const commitRename = (): void => {
    if (renamingId && renameText.trim()) renameWorkflow(renamingId, renameText.trim())
    setRenamingId(null)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button style={styles.chipSeg} title="Workflow menu" onClick={() => setOpen((o) => !o)}>
        <span style={styles.chipIcon}>⎇</span>
        {active ? active.name : 'no workflow'} ▾
      </button>
      {open && (
        <>
          <div
            style={styles.scrim}
            onClick={() => {
              setOpen(false)
              setRenamingId(null)
            }}
          />
          <div style={styles.projectMenu}>
            <div style={styles.menuHead}>Workflows</div>
            {workflows.map((w) => (
              <div
                key={w.id}
                style={{
                  ...styles.folderRow,
                  background: w.id === activeWorkflowId ? UI.panelAlt : 'transparent'
                }}
              >
                {renamingId === w.id ? (
                  <input
                    autoFocus
                    style={styles.renameInput}
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      else if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <button
                    style={styles.folderPick}
                    onClick={() => {
                      switchWorkflow(w.id)
                      setOpen(false)
                    }}
                  >
                    <span style={styles.folderName}>{w.name}</span>
                  </button>
                )}
                <button
                  style={styles.folderDel}
                  title="Rename workflow"
                  onClick={() => {
                    setRenamingId(w.id)
                    setRenameText(w.name)
                  }}
                >
                  ✎
                </button>
                {workflows.length > 1 && (
                  <button
                    style={styles.folderDel}
                    title="Delete workflow"
                    onClick={() => deleteWorkflow(w.id)}
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
            <button
              style={styles.folderAdd}
              onClick={() => {
                addWorkflow()
                setOpen(false)
              }}
            >
              ＋ New workflow
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Run/Stop the whole pipeline, mirroring a step tile's Run control. */
function RunButton() {
  const nodes = useGraph((s) => s.nodes)
  const runningAll = useGraph((s) => s.runningAll)
  const runAll = useGraph((s) => s.runAll)
  const stopAll = useGraph((s) => s.stopAll)

  const runnable = nodes.filter((n): n is StepNode => isStep(n) && NODE_SPECS[n.data.kind].hasRun)
  const hasRunnable = runnable.length > 0
  const allDone = hasRunnable && runnable.every((n) => n.data.status === 'done')
  const anyError = runnable.some((n) => n.data.status === 'error')
  const rs = runningAll
    ? { icon: '■', title: 'Stop', bg: '#e2b93b', fg: '#1a1a1a' }
    : allDone
      ? { icon: '↻', title: 'Re-run all steps', bg: UI.accent, fg: UI.accentText }
      : anyError
        ? { icon: '↻', title: 'Retry failed steps', bg: '#e15759', fg: '#fff' }
        : { icon: '▶', title: 'Run all steps', bg: UI.accent, fg: UI.accentText }

  return (
    <button
      style={{
        ...styles.navBtn,
        background: rs.bg,
        color: rs.fg,
        borderColor: rs.bg,
        fontSize: 13,
        opacity: !hasRunnable && !runningAll ? 0.5 : 1
      }}
      disabled={!hasRunnable && !runningAll}
      onClick={() => (runningAll ? stopAll() : void runAll())}
      title={rs.title}
      aria-label={rs.title}
    >
      {rs.icon}
    </button>
  )
}

/** Project name as a dropdown chip: switch to a recent project, open one, or start new.
 *  With no project open it shows a placeholder; the dropdown still offers open/new. */
function ProjectMenu() {
  const projectOpen = useGraph((s) => s.projectOpen)
  const projectName = useGraph((s) => s.projectName)
  const projectPath = useGraph((s) => s.projectPath)
  const dirty = useGraph((s) => s.dirty)
  const recents = useGraph((s) => s.recentProjects)
  const openProject = useGraph((s) => s.openProject)
  const newProject = useGraph((s) => s.newProject)
  const forgetRecent = useGraph((s) => s.forgetRecent)
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        style={{ ...styles.projectChip, color: projectOpen ? UI.text : UI.textMuted }}
        title="Project menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.projectChipName}>{projectOpen ? projectName : 'No project'}</span>
        {projectOpen && (
          <span
            style={{ ...styles.statusDot, background: dirty ? '#e2b93b' : '#3fb950' }}
            title={dirty ? 'Unsaved changes' : 'All changes saved'}
          />
        )}
        <span style={styles.chipCaret}>▾</span>
      </button>
      {open && (
        <>
          <div style={styles.scrim} onClick={() => setOpen(false)} />
          <div style={styles.projectMenu}>
            <div style={styles.menuHead}>Recent projects</div>
            {recents.length === 0 ? (
              <div style={styles.menuEmpty}>None yet</div>
            ) : (
              recents.map((r) => (
                <div
                  key={r.path}
                  style={{
                    ...styles.menuRow,
                    background: r.path === projectPath ? UI.panelAlt : 'transparent'
                  }}
                >
                  <button
                    title={r.path}
                    style={styles.menuRowOpen}
                    onClick={() => {
                      void openProject(r.path)
                      setOpen(false)
                    }}
                  >
                    <span style={styles.menuName}>{r.name}</span>
                    <span style={styles.menuPath}>{r.path}</span>
                  </button>
                  <button
                    style={styles.recentForget}
                    title="Remove from recents"
                    onClick={(e) => {
                      e.stopPropagation()
                      forgetRecent(r.path)
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
            <div style={styles.menuDivider} />
            <button
              style={styles.menuAction}
              onClick={() => {
                void openProject()
                setOpen(false)
              }}
            >
              Open project…
            </button>
            <button
              style={styles.menuAction}
              onClick={() => {
                newProject()
                setOpen(false)
              }}
            >
              New project
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Minimal monochrome line icons (inline SVG → no font/emoji dependency). */
function IconSave() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v5h6V4" />
      <rect x="8" y="13" width="8" height="7" />
    </svg>
  )
}
function IconGuide() {
  // Open book — "user guide".
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 6.5C10.8 5.5 9 5 6.5 5H3v13h3.5c2.5 0 4.3.5 5.5 1.5" />
      <path d="M12 6.5C13.2 5.5 15 5 17.5 5H21v13h-3.5c-2.5 0-4.3.5-5.5 1.5z" />
    </svg>
  )
}
function IconExport() {
  // Tray with a downward arrow — "save plots out to disk".
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v11" />
      <path d="M8 10l4 4 4-4" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  )
}
function IconHome() {
  // House — "back to the project home".
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M9 20v-6h6v6" />
    </svg>
  )
}
function IconFolder() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5h5l2 2h9V19H4z" />
    </svg>
  )
}
function IconPencil() {
  // Two passes: a thick panel-coloured underlay knocks out just the pencil's silhouette
  // from the floppy behind it (so the disk draws right up to the pencil, trimmed only a
  // hair), then the pencil is stroked on top.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20l1-4L17 4l3 3L8 19z" stroke={UI.panel} strokeWidth="6" />
      <path d="M4 20l1-4L17 4l3 3L8 19z" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  )
}

/** Control chip: save / save-as / undo / redo, one bordered group split by dividers. */
function ControlChip() {
  const dirty = useGraph((s) => s.dirty)
  const saveProject = useGraph((s) => s.saveProject)
  const saveProjectAs = useGraph((s) => s.saveProjectAs)
  const canUndo = useGraph((s) => s.past.length > 0)
  const canRedo = useGraph((s) => s.future.length > 0)
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)
  return (
    <div style={styles.ctrlChip}>
      <button
        style={{
          ...styles.ctrlBtn,
          color: dirty ? UI.text : UI.textMuted,
          opacity: dirty ? 1 : 0.5,
          cursor: dirty ? 'pointer' : 'default'
        }}
        title={dirty ? 'Save project' : 'All changes saved'}
        disabled={!dirty}
        onClick={() => void saveProject()}
      >
        <IconSave />
      </button>
      <button style={styles.ctrlBtn} title="Save project as…" onClick={() => void saveProjectAs()}>
        <span style={styles.saveAsWrap}>
          <IconSave />
          <span style={styles.pencilBadge}>
            <IconPencil />
          </span>
        </span>
      </button>
      <button
        style={{ ...styles.ctrlBtn, opacity: canUndo ? 1 : 0.4 }}
        title="Undo"
        disabled={!canUndo}
        onClick={undo}
      >
        ↺
      </button>
      <button
        style={{ ...styles.ctrlBtn, opacity: canRedo ? 1 : 0.4 }}
        title="Redo"
        disabled={!canRedo}
        onClick={redo}
      >
        ↻
      </button>
    </div>
  )
}

/** Landing page: create/open a project, with a recent-projects list. */
function Home() {
  const newProject = useGraph((s) => s.newProject)
  const openProject = useGraph((s) => s.openProject)
  const recents = useGraph((s) => s.recentProjects)
  const forgetRecent = useGraph((s) => s.forgetRecent)
  return (
    <div style={styles.home}>
      <div style={styles.homeInner}>
        <h1 style={styles.homeTitle}>{__APP_NAME__}</h1>
        <p style={styles.homeSub}>Create or open a project to begin.</p>
        <div style={styles.homeActions}>
          <button style={styles.homePrimary} onClick={() => newProject()}>
            ＋ New project
          </button>
          <button style={styles.homeSecondary} onClick={() => void openProject()}>
            Open project…
          </button>
        </div>
        <div style={styles.recentHead}>Recent projects</div>
        {recents.length === 0 ? (
          <div style={styles.recentEmpty}>No recent projects yet.</div>
        ) : (
          <div style={styles.recentList}>
            {recents.map((r) => (
              <div key={r.path} style={styles.recentRow}>
                <button
                  style={styles.recentItem}
                  title={r.path}
                  onClick={() => void openProject(r.path)}
                >
                  <span style={styles.recentName}>{r.name}</span>
                  <span style={styles.recentPath}>{r.path}</span>
                </button>
                <button
                  style={styles.recentForget}
                  title="Remove from recents"
                  onClick={(e) => {
                    e.stopPropagation()
                    forgetRecent(r.path)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function App() {
  const mode = useUiTheme((s) => s.mode)
  const view = useAppView((s) => s.view)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  // Update check drives a notification dot on the settings gear + the About section.
  const update = useUpdateCheck()
  const [silenced, setSilenced] = useState(() => {
    try {
      return localStorage.getItem('omicexplorer.silenceUpdates') === '1'
    } catch {
      return false
    }
  })
  const toggleSilence = (): void =>
    setSilenced((s) => {
      const next = !s
      try {
        localStorage.setItem('omicexplorer.silenceUpdates', next ? '1' : '0')
      } catch {
        /* storage unavailable — keep in-memory only */
      }
      return next
    })
  const showUpdateDot = update.updateAvailable && !silenced

  const projectOpen = useGraph((s) => s.projectOpen)
  const goHome = useGraph((s) => s.goHome)
  const initProject = useGraph((s) => s.initProject)
  const pruneMissingRecents = useGraph((s) => s.pruneMissingRecents)
  useEffect(() => {
    void initProject().then(() => pruneMissingRecents())
  }, [initProject, pruneMissingRecents])
  useEffect(() => {
    document.documentElement.style.background = PALETTES[mode].bg
    // Make native UI (scrollbars, form controls) follow the app theme — otherwise
    // e.g. table scrollbars stay light in dark mode. The app paints its own surfaces
    // via CSS vars, so this only governs the browser-drawn chrome.
    document.documentElement.style.colorScheme = mode
  }, [mode])

  return (
    <div style={{ ...styles.root, ...cssVars(PALETTES[mode]) }}>
      <header style={styles.header}>
        <button
          style={styles.navBtn}
          onClick={() => goHome()}
          title="Home (all projects)"
          aria-label="Home"
        >
          <IconHome />
        </button>
        <ProjectMenu />
        {projectOpen && (
          <>
            {/* Control chip: save / save-as / undo / redo. */}
            <ControlChip />
            {/* Folder + workflow selectors in one chip, split by a divider. */}
            <div style={styles.chipGroup}>
              <FolderChip />
              <div style={styles.chipDivider} />
              <WorkflowChip />
            </div>
          </>
        )}
        <div style={styles.navSpacer} />
        {/* Workflow/Results switch, absolutely centred at 0.65 regardless of side groups. */}
        {projectOpen && (
          <div style={styles.centerToggle}>
            <ViewToggle />
          </div>
        )}
        {/* Workflow actions: run/re-run + export, grouped and split from the general buttons. */}
        {projectOpen && <RunButton />}
        {projectOpen && (
          <button
            style={styles.navBtn}
            onClick={() => setExportOpen(true)}
            title="Export plots & tables"
            aria-label="Export"
          >
            <IconExport />
          </button>
        )}
        {projectOpen && <div style={styles.navSep} />}
        <button
          style={styles.navBtn}
          onClick={() => setGuideOpen(true)}
          title="User guide"
          aria-label="User guide"
        >
          <IconGuide />
        </button>
        <button
          style={{ ...styles.navBtn, fontSize: 19, position: 'relative' }}
          onClick={() => setSettingsOpen((o) => !o)}
          title={showUpdateDot ? `Settings — v${update.latest} available` : 'Settings'}
          aria-label={showUpdateDot ? 'Settings (update available)' : 'Settings'}
        >
          ⚙{showUpdateDot && <span style={styles.navDot} />}
        </button>
        {settingsOpen && (
          <SettingsPopover
            onClose={() => setSettingsOpen(false)}
            update={update}
            silenced={silenced}
            onToggleSilence={toggleSilence}
          />
        )}
        {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
        {guideOpen && <UserGuide onClose={() => setGuideOpen(false)} />}
      </header>
      {!projectOpen ? (
        <Home />
      ) : view === 'canvas' ? (
        <div style={styles.canvasArea}>
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </div>
      ) : (
        <ResultsView />
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: UI.bg,
    color: UI.text,
    fontFamily: 'system-ui, sans-serif'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto',
    position: 'sticky',
    top: 0,
    background: UI.bg,
    zIndex: 20
  },
  title: { fontSize: 16, fontWeight: 700 },
  chipIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 13,
    opacity: 0.85,
    flex: '0 0 auto'
  },
  navSpacer: { flex: 1 },
  // Anchored so the toggle's centre sits at 0.65 regardless of the side groups' widths.
  centerToggle: {
    position: 'absolute',
    left: '65%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'inline-flex',
    zIndex: 1
  },
  // Vertical divider between the workflow-action buttons and the general buttons.
  navSep: { width: 1, height: 20, background: UI.border, alignSelf: 'center', flex: '0 0 auto' },
  chipGroup: {
    display: 'inline-flex',
    alignItems: 'stretch',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel
  },
  ctrlChip: {
    display: 'inline-flex',
    alignItems: 'stretch',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel
  },
  ctrlBtn: {
    background: 'transparent',
    color: UI.text,
    border: 'none',
    padding: '4px 9px',
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center'
  },
  // Faint, thin separator inset from the chip's top/bottom borders (margin keeps it
  // from touching them).
  chipDivider: {
    width: 1,
    alignSelf: 'stretch',
    margin: '5px 0',
    background: 'rgba(128,128,128,0.22)'
  },
  chipSegWarn: { color: '#e15759' },
  chipSeg: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    // Match the project chip's vertical rhythm (5px pad, 13px text) so heights line up.
    padding: '5px 11px',
    fontSize: 13,
    cursor: 'pointer',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.2
  },
  folderMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    minWidth: 260,
    maxWidth: 360,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
    padding: 4
  },
  folderRow: { display: 'flex', alignItems: 'stretch', borderRadius: 6 },
  folderPick: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '7px 10px',
    cursor: 'pointer',
    overflow: 'hidden'
  },
  folderName: { fontSize: 13, fontWeight: 600 },
  folderPath: {
    fontSize: 11,
    color: UI.textMuted,
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  folderDel: {
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    padding: '0 10px',
    fontSize: 13
  },
  pathWarn: { color: '#e15759' },
  repathHint: { fontSize: 11, color: '#e15759', fontWeight: 600, marginTop: 2 },
  renameInput: {
    flex: 1,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.accent}`,
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 13,
    margin: '2px 4px'
  },
  folderAdd: {
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    borderTop: `1px solid ${UI.border}`,
    color: UI.text,
    padding: '9px 10px',
    marginTop: 4,
    fontSize: 13,
    cursor: 'pointer'
  },
  home: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    background: UI.bg
  },
  homeInner: { width: 'min(680px, 92vw)', padding: '64px 0 40px' },
  homeTitle: { fontSize: 30, fontWeight: 800, margin: 0 },
  homeSub: { color: UI.textMuted, fontSize: 14, margin: '8px 0 28px' },
  homeActions: { display: 'flex', gap: 12, marginBottom: 36 },
  homePrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 8,
    padding: '11px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer'
  },
  homeSecondary: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: '11px 20px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer'
  },
  recentHead: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700,
    marginBottom: 10
  },
  recentEmpty: { color: UI.textMuted, fontSize: 13 },
  recentList: { display: 'flex', flexDirection: 'column', gap: 6 },
  recentRow: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 4,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    overflow: 'hidden'
  },
  recentItem: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    padding: '10px 14px',
    cursor: 'pointer',
    textAlign: 'left',
    overflow: 'hidden'
  },
  recentForget: {
    flex: '0 0 auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    padding: '0 12px',
    fontSize: 13
  },
  recentName: { fontSize: 14, fontWeight: 600, color: UI.text },
  recentPath: {
    fontSize: 12,
    color: UI.textMuted,
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  projectChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    maxWidth: 240
  },
  projectChipName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusDot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
  chipCaret: { color: UI.textMuted, fontSize: 11, flex: '0 0 auto' },
  projectMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    minWidth: 280,
    maxWidth: 380,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
    padding: 4
  },
  menuHead: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700,
    padding: '8px 10px 4px'
  },
  menuEmpty: { color: UI.textMuted, fontSize: 12, padding: '2px 10px 8px' },
  menuRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'stretch',
    borderRadius: 6
  },
  menuRowOpen: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '7px 10px',
    cursor: 'pointer',
    textAlign: 'left',
    overflow: 'hidden'
  },
  menuName: { fontSize: 13, fontWeight: 600 },
  menuPath: {
    fontSize: 11,
    color: UI.textMuted,
    maxWidth: 340,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  menuDivider: { height: 1, background: UI.border, margin: '4px 0' },
  menuAction: {
    width: '100%',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    color: UI.text,
    padding: '9px 10px',
    fontSize: 13,
    cursor: 'pointer',
    borderRadius: 6
  },
  projectName: {
    fontSize: 13,
    fontWeight: 600,
    color: UI.text,
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  saveAsWrap: { position: 'relative', display: 'inline-flex', lineHeight: 0 },
  // Pencil badge at the floppy's bottom-right corner. No box — the pencil SVG knocks out
  // only its own silhouette (see IconPencil), so the disk shows right up to the pencil.
  pencilBadge: {
    position: 'absolute',
    right: -3,
    bottom: -2,
    display: 'inline-flex',
    lineHeight: 0
  },
  newStepBtn: {
    background: UI.panel,
    color: UI.text,
    border: 'none',
    borderRadius: 18,
    padding: '9px 19px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)'
  },
  // "Cancel" state while placing — red to read as a stop/abort action.
  newStepBtnActive: {
    background: '#e15759',
    color: '#fff',
    borderColor: '#e15759'
  },
  actBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '6px 8px',
    boxShadow: '0 6px 22px rgba(0,0,0,0.45)'
  },
  actCount: { fontSize: 11, fontWeight: 700, color: UI.textMuted, padding: '0 6px' },
  actBtn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 700
  },
  actBtnDanger: { color: '#f2b8b9', borderColor: '#7a3a3f' },
  ghost: {
    position: 'fixed',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: 30,
    minWidth: 130,
    textAlign: 'center',
    background: UI.panelRaised,
    color: UI.textMuted,
    border: `1px dashed ${UI.accent}`,
    borderRadius: 8,
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 600,
    opacity: 0.9
  },
  navBtn: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    width: 30,
    height: 30,
    fontSize: 14,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  scrim: { position: 'fixed', inset: 0, zIndex: 40 },
  // Settings dialog (centred modal) + its dark scrim.
  dialogScrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 },
  settingsModal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 540,
    maxWidth: '94vw',
    height: 380,
    maxHeight: '86vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 61,
    overflow: 'hidden'
  },
  settingsModalHead: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    flex: '0 0 auto'
  },
  settingsModalTitle: { fontWeight: 700, fontSize: 14, color: UI.text },
  settingsClose: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
    lineHeight: 1
  },
  settingsBody: { display: 'flex', flex: 1, minHeight: 0 },
  settingsNav: {
    flex: '0 0 160px',
    borderRight: `1px solid ${UI.border}`,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'auto',
    background: UI.panelAlt
  },
  settingsNavItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    textAlign: 'left',
    border: 'none',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  settingsNavDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#3b82f6',
    flex: '0 0 auto'
  },
  settingsContent: { flex: 1, minWidth: 0, overflow: 'auto', padding: '16px 20px' },
  settingsContentTitle: { margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: UI.text },
  settingsSection: { padding: 12 },
  settingsLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted,
    marginBottom: 8,
    fontWeight: 700
  },
  settingsHint: { marginTop: 8, fontSize: 11, color: UI.textMuted },
  // Pill-shaped Workflow/Results switch, centred in the nav bar.
  segmented: {
    display: 'flex',
    gap: 4,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: 3,
    background: UI.panel,
    flex: '0 0 auto'
  },
  segment: {
    border: 'none',
    borderRadius: 999,
    padding: '5px 16px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  aboutName: { fontSize: 12, color: UI.text, marginBottom: 6 },
  aboutMuted: { fontSize: 12, color: UI.textMuted },
  aboutUpdate: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: UI.text
  },
  aboutDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#3b82f6',
    flex: '0 0 auto'
  },
  aboutLink: {
    display: 'inline-block',
    marginTop: 4,
    fontSize: 12,
    color: UI.accent,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  silenceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTop: `1px solid ${UI.border}`,
    fontSize: 12,
    color: UI.textMuted,
    cursor: 'pointer'
  },
  // Blue notification dot on the settings gear when an update is available.
  navDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3b82f6',
    border: `2px solid ${UI.panel}`
  },
  canvasArea: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    borderTop: `1px solid ${UI.border}`
  },
  canvas: { flex: 1, minWidth: 0, minHeight: 0 }
}
