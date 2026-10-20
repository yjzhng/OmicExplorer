import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import {
  applyNodeChanges,
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
  type Node,
  type NodeChange,
  type OnConnectStartParams
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './app.css'

import { ResultsView } from './dashboard/ResultsView'
import { useShallow } from 'zustand/react/shallow'
import { menuParts, useGeneMenuTabs } from './dashboard/useGeneMenuTabs'
import { GeneSelectMenu } from './ui/GeneSelectMenu'
import { FormWorkflow } from './form/FormWorkflow'
import { UserGuide } from './ui/UserGuide'
import { SaveAsMenu } from './ui/SaveAsMenu'
import { REPO_URL, useUpdateCheck, type UpdateInfo } from './ui/useUpdateCheck'
import { edgeTypes } from './graph/GraphEdge'
import { FRAME_LABEL_H, FRAME_PAD, type FrameData } from './graph/FrameNode'
import { frameDepths, frameTiles, outermostFrame, topFullFrames } from './graph/frames'
import { nodeTypes } from './graph/GraphNode'
import { useGraph } from './graph/store'
import {
  accentOf,
  ALL_OPS,
  canConnect,
  wiredKindOf,
  categoryOf,
  entryKey,
  NODE_SPECS,
  PLOT_SECTIONS,
  plotEntriesFor,
  type PlotMenuEntry
} from './graph/registry'
import { PlotConfig, PlotEntryMenu } from './graph/NodeConfigPanel'
import { projectStanding } from './graph/project'
import {
  isStep,
  type GraphNode,
  type NodeConfig,
  type NodeData,
  type NodeKind,
  type PlotGroupConfig,
  type StepNode
} from './graph/types'
import { Chevron } from './ui/Chevron'
import { IconGear, IconMenu, IconTrash } from './ui/icons'
import { REVEAL } from './ui/fileLabels'
import { placeMenu } from './ui/placeMenu'
import { StatusIcon, StatusNote } from './ui/StatusNote'
import {
  accentColors,
  ACCENT_LABELS,
  cssVars,
  PALETTES,
  PLOT_FONTS,
  UI,
  type PlotFontId
} from './ui/theme'
import { ColorPicker } from './ui/ColorPicker'
import { ToggleSwitch } from './ui/ToggleSwitch'
import { FreezeNotice } from './ui/FreezeNotice'
import { useAppView, type AppView } from './ui/useAppView'
import { DPI_CHOICES, useAppSettings } from './ui/useAppSettings'
import { CategoricalLabel, PaletteSelect } from './ui/PaletteSelect'
import { Select } from './ui/Select'
import { InfoTip } from './ui/InfoTip'
import { CategoryBuilder, SpectrumBuilder } from './ui/PaletteBuilder'
import { categoricalIds, PALETTE_ROLES, type CategoricalId } from './ui/palettes'
import { useUiTheme } from './ui/useUiTheme'
import appLogo from './assets/logo-256.png'
import { ProjectFolderViewer } from './ui/ProjectFolderViewer'
import { AnnotationCache } from './ui/AnnotationCache'

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

/** How long the Workflow ⇄ Results slide takes, and its easing (quick out, gentle settle). */
const VIEW_SLIDE = '320ms cubic-bezier(0.2, 0.7, 0.2, 1)'

/** The flow layout's two pages, side by side — Workflow on the left, Results on the right — with
 *  a switch between them sliding the whole page across. Both ways of switching (the canvas's
 *  "Results →", the dashboard's "← Workflow") set the same view, so both slide.
 *
 *  Both pages exist only for the length of the slide; once it settles, the one left behind is
 *  unmounted, as before — Results' many Plotly charts mustn't sit in the DOM (and in memory) while
 *  you work on the canvas. Re-opening Results rebuilds its tiles, paced by the reveal queue. */
function FlowViews({ view }: { view: AppView }) {
  // The page on show, the one sliding out (null when settled), and the slide's phase: `start`
  // places the incoming page off-screen with no transition; `run` lets it glide in.
  const [slide, setSlide] = useState<{ to: AppView; from: AppView | null; run: boolean }>({
    to: view,
    from: null,
    run: false
  })
  // A new view: start a slide from the current page — adjusted during render, so the first frame
  // already has both pages in place. Reduced motion just swaps.
  if (view !== slide.to) {
    const still =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setSlide({ to: view, from: still ? null : slide.to, run: false })
  }
  // Once the starting positions have painted, let the slide run (two frames: one to commit the
  // start, one to be sure it was drawn, or the browser skips straight to the end).
  useLayoutEffect(() => {
    if (!slide.from || slide.run) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSlide((s) => (s.from ? { ...s, run: true } : s)))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [slide])
  const settle = (): void => setSlide((s) => (s.from ? { to: s.to, from: null, run: false } : s))
  // Settle even if transitionend never comes (a tab hidden mid-slide).
  useEffect(() => {
    if (!slide.run) return
    const t = window.setTimeout(settle, 450)
    return () => window.clearTimeout(t)
  }, [slide.run])

  // The pages' content, built once: the slide re-renders this component three times (start, run,
  // settle), and re-rendering the canvas or a full dashboard at the moment the slide starts is
  // what made it stutter. The same elements let React skip them; they update from their own
  // stores as usual.
  const canvasPage = useMemo(
    () => (
      <div style={styles.canvasArea}>
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
      </div>
    ),
    []
  )
  const resultsPage = useMemo(
    () => (
      <div style={styles.resultsArea}>
        <ResultsView />
      </div>
    ),
    []
  )

  // Results sits to the right: going there moves everything left, and back moves it right.
  const dir = slide.to === 'results' ? 1 : -1
  const offset = (page: AppView): string => {
    if (!slide.from) return 'none'
    if (page === slide.to) return slide.run ? 'none' : `translateX(${dir * 100}%)`
    return slide.run ? `translateX(${-dir * 100}%)` : 'none'
  }
  const page = (p: AppView): ReactNode => (
    <div
      key={p}
      style={{
        ...styles.viewPage,
        transform: offset(p),
        transition: slide.run ? `transform ${VIEW_SLIDE}` : 'none',
        // Its own compositor layer while sliding, so the move doesn't repaint the page each frame.
        willChange: slide.from ? 'transform' : undefined
      }}
      // The incoming page finishing its glide ends the slide.
      onTransitionEnd={(e) => {
        if (p === slide.to && e.target === e.currentTarget) settle()
      }}
      aria-hidden={p !== slide.to}
    >
      {p === 'canvas' ? canvasPage : resultsPage}
    </div>
  )
  return (
    <div style={styles.viewStage}>
      {/* Fixed order, so a page keeps its element (and its state) as the other comes and goes. */}
      {(['canvas', 'results'] as const).filter((p) => p === slide.to || p === slide.from).map(page)}
    </div>
  )
}

/** Top-right button from the canvas to the results dashboard — the way there; the dashboard's
 *  "← Workflow" is the way back. */
function ResultsLink() {
  const setView = useAppView((s) => s.setView)
  return (
    <Panel position="top-right">
      <button
        className="new-step-btn oe-view-btn oe-press"
        style={styles.resultsLink}
        onClick={() => setView('results')}
        title="Open the results dashboard"
      >
        Results →
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

const CONNECTION_LINE: CSSProperties = {
  stroke: '#7c7c8c',
  strokeWidth: 2,
  strokeDasharray: '6 4',
  opacity: 0.85
}

/** Action bar for the current marquee selection (Group/Ungroup/Duplicate/Delete). */
function SelectionActions({
  count,
  canGroup,
  canUngroup,
  onGroup,
  onUngroup,
  onTidy,
  onCascade,
  canExpand,
  canCollapse,
  onExpand,
  onCollapse,
  onDuplicate,
  onDelete
}: {
  count: number
  canGroup: boolean
  canUngroup: boolean
  onGroup: () => void
  onUngroup: () => void
  onTidy: () => void
  canExpand: boolean
  canCollapse: boolean
  onExpand: () => void
  onCollapse: () => void
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
        {btn(
          'Group',
          canGroup,
          onGroup,
          'Frame the selected tiles: a labelled area that moves them together'
        )}
        {btn(
          'Ungroup',
          canUngroup,
          onUngroup,
          'Remove the frame around the selection (the tiles stay)'
        )}
        {btn(
          'Tidy',
          count > 1,
          onTidy,
          'Lay the selection out left to right along its connections'
        )}
        {btn('Cascade', count > 1, onCascade, 'Auto-arrange the selection in a cascade')}
        {btn('Expand', canExpand, onExpand, 'Show the plots in the selected plot groups')}
        {btn(
          'Collapse',
          canCollapse,
          onCollapse,
          'Fold away the plots in the selected plot groups'
        )}
        {btn('Duplicate', true, onDuplicate, 'Duplicate the selection')}
        {btn('Delete', true, onDelete, 'Delete the selection', true)}
      </div>
    </Panel>
  )
}

function Canvas() {
  const mode = useUiTheme((s) => s.mode)
  const storeNodes = useGraph((s) => s.nodes)
  const storeOnNodesChange = useGraph((s) => s.onNodesChange)
  // Transient drag positions live in LOCAL state and are pushed to the global store only on
  // drag-STOP. Writing every drag frame to the store would notify every subscriber (RunButton,
  // each node's selectors, …) and re-evaluate them; with large result arrays sharing the heap,
  // that per-frame allocation churn surfaces as GC jank and the drag stutters. Keeping it local
  // confines per-frame work to React Flow + this component.
  const draggingRef = useRef(false)
  const [nodes, setNodes] = useState(storeNodes)
  // Keep a ref to the latest local nodes so drag-STOP can read the final layout without a stale
  // closure (updated in an effect, never during render).
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])
  const { screenToFlowPosition, getViewport, setViewport } = useReactFlow()
  // Frames React Flow's drag-select is touching, while one is under way (null otherwise). Frames
  // aren't selected themselves (see onNodesChange) — at the drag's end each stands for its tiles.
  const marqueeFrames = useRef<Set<string> | null>(null)
  // The same, as state, so the groups being touched light up live during the drag.
  const [touchedFrames, setTouchedFrames] = useState<string[] | null>(null)
  // Canvas frames (Group): each drawn as a node behind its tiles, sized to their box. Derived from
  // the LOCAL tile positions, so a frame follows its tiles live during a drag.
  const frames = useGraph((s) => s.frames)
  const unframeNodes = useGraph((s) => s.unframeNodes)
  const selectTiles = useGraph((s) => s.selectTiles)
  const frameNodes = useMemo((): Node<FrameData>[] => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const fById = new Map(frames.map((f) => [f.id, f]))
    const depth = frameDepths(frames)
    // Selection is kept on tiles: a frame shows as selected when all its tiles are (outermost only).
    // During a drag-select, a group lights up as soon as it — or any tile in it — is touched:
    // the outermost group is what the drag will select.
    const shownSel = new Set(
      touchedFrames
        ? [...nodes.filter((n) => n.selected).map((n) => n.id), ...touchedFrames].flatMap(
            (id) => outermostFrame(frames, id) ?? (frames.some((f) => f.id === id) ? [id] : [])
          )
        : topFullFrames(frames, (id) => !!byId.get(id)?.selected)
    )
    type Box = { x0: number; y0: number; x1: number; y1: number }
    // A frame's box wraps its members' boxes — a tile's own, a nested frame's (with its padding
    // and label strip) — so frames nest visibly.
    const boxes = new Map<string, Box | null>()
    const boxOf = (id: string, seen: Set<string>): Box | null => {
      const f = fById.get(id)
      if (!f) {
        const n = byId.get(id)
        if (!n) return null
        return {
          x0: n.position.x,
          y0: n.position.y,
          x1: n.position.x + (n.measured?.width ?? 230),
          y1: n.position.y + (n.measured?.height ?? 120)
        }
      }
      if (boxes.has(id)) return boxes.get(id)!
      if (seen.has(id)) return null
      seen.add(id)
      const inner = f.members.map((m) => boxOf(m, seen)).filter((b): b is Box => !!b)
      const box = inner.length
        ? {
            x0: Math.min(...inner.map((b) => b.x0)) - FRAME_PAD,
            y0: Math.min(...inner.map((b) => b.y0)) - FRAME_PAD - FRAME_LABEL_H,
            x1: Math.max(...inner.map((b) => b.x1)) + FRAME_PAD,
            y1: Math.max(...inner.map((b) => b.y1)) + FRAME_PAD
          }
        : null
      boxes.set(id, box)
      return box
    }
    return frames.flatMap((f) => {
      const b = boxOf(f.id, new Set())
      if (!b) return []
      const width = b.x1 - b.x0
      const height = b.y1 - b.y0
      return [
        {
          id: f.id,
          type: 'frame',
          position: { x: b.x0, y: b.y0 },
          data: { label: f.label, width, height },
          width,
          height,
          // behind every tile; an inner frame above the one holding it
          zIndex: -100 + (depth.get(f.id) ?? 0),
          selected: shownSel.has(f.id),
          deletable: false
        }
      ]
    })
  }, [frames, nodes, touchedFrames])
  const shown = useMemo(
    () => [...(frameNodes as unknown as GraphNode[]), ...nodes],
    [frameNodes, nodes]
  )
  // Mirror the store into local state whenever we're NOT mid-drag, so external changes (adds,
  // deletes, undo/redo, project load, selection) still show. During a drag the store isn't
  // touched, so this effect stays quiet.
  useEffect(() => {
    if (!draggingRef.current) setNodes(storeNodes)
  }, [storeNodes])
  const applyTileChanges = useCallback(
    (changes: NodeChange<GraphNode>[]) => {
      if (draggingRef.current) setNodes((cur) => applyNodeChanges(changes, cur))
      else storeOnNodesChange(changes)
    },
    [storeOnNodesChange]
  )
  // A frame is derived, not stored: its moves become its members' moves (by the same offset). Its
  // own selection changes are dropped — its tiles hold the selection — except that frames touched
  // by a drag-select are noted, for its end.
  const onNodesChange = useCallback(
    (changes: NodeChange<GraphNode>[]) => {
      const frameIds = new Set(frameNodes.map((f) => f.id))
      const tileChanges: NodeChange<GraphNode>[] = []
      const movedTiles = new Set(
        changes
          .filter((c) => c.type === 'position' && !frameIds.has(c.id))
          .map((c) => (c as { id: string }).id)
      )
      for (const c of changes) {
        if (!('id' in c) || !frameIds.has(c.id)) {
          tileChanges.push(c)
          continue
        }
        if (c.type === 'position' && c.position) {
          const fn = frameNodes.find((f) => f.id === c.id)!
          const dx = c.position.x - fn.position.x
          const dy = c.position.y - fn.position.y
          // Every tile inside, through nested frames.
          for (const m of frameTiles(frames, c.id)) {
            // A member dragged in the same gesture (selected with its frame) moves itself,
            // and one already moved by another frame in this batch (nested frames both
            // selected) isn't moved twice.
            if (movedTiles.has(m)) continue
            movedTiles.add(m)
            const n = nodesRef.current.find((x) => x.id === m)
            if (n)
              tileChanges.push({
                type: 'position',
                id: m,
                position: { x: n.position.x + dx, y: n.position.y + dy },
                dragging: c.dragging
              })
          }
        } else if (c.type === 'select' && marqueeFrames.current) {
          if (c.selected) marqueeFrames.current.add(c.id)
          else marqueeFrames.current.delete(c.id)
          setTouchedFrames([...marqueeFrames.current])
        }
      }
      if (tileChanges.length) applyTileChanges(tileChanges)
    },
    [frameNodes, frames, applyTileChanges]
  )
  // Drag-select picks what it touches (React Flow's Partial mode). At its end, a tile in a group —
  // or a group touched — stands for the outermost group holding it, which is selected whole.
  const onMarqueeStart = useCallback((): void => {
    marqueeFrames.current = new Set()
    setTouchedFrames([])
  }, [])
  const onMarqueeEnd = useCallback((): void => {
    const touched = [...(marqueeFrames.current ?? [])]
    marqueeFrames.current = null
    setTouchedFrames(null)
    const tiles = useGraph
      .getState()
      .nodes.filter((n) => isStep(n) && n.selected)
      .map((n) => n.id)
    const picked = new Set(tiles)
    for (const id of [...tiles, ...touched]) {
      const top = outermostFrame(frames, id) ?? (frames.some((f) => f.id === id) ? id : null)
      if (top) for (const t of frameTiles(frames, top)) picked.add(t)
    }
    selectTiles([...picked])
  }, [frames, selectTiles])
  const edges = useGraph((s) => s.edges)
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
  const frameNodesAction = useGraph((s) => s.frameNodes)
  const cascadeNodes = useGraph((s) => s.cascadeNodes)
  const tidyNodes = useGraph((s) => s.tidyNodes)
  const setGroupsCollapsed = useGraph((s) => s.setGroupsCollapsed)
  const duplicateNodes = useGraph((s) => s.duplicateNodes)
  const deleteNode = useGraph((s) => s.deleteNode)
  // No data folder yet ⇒ guide the user to set one (via the folder chip) before adding steps.
  const dataDir = useGraph((s) => s.dataDir)
  const needsFolder = !dataDir
  // Align the folder hint's left edge (and its ↑ arrow) to the folder chip in the top bar, whose x
  // depends on the chips before it. Measured relative to the canvas container so the hint stays an
  // in-canvas element (not a floating layer).
  const canvasRef = useRef<HTMLDivElement>(null)
  const [hintLeft, setHintLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!needsFolder) return
    const measure = (): void => {
      const chip = document.getElementById('oe-folder-chip')
      const box = canvasRef.current
      if (!chip || !box) return
      const c = chip.getBoundingClientRect()
      // Align to the chip's horizontal CENTRE (the arrow is centred on this x below).
      setHintLeft(c.left + c.width / 2 - box.getBoundingClientRect().left)
    }
    measure()
    // Re-measure on anything that can shift the chip's x: window resize, and any layout change in
    // the top bar (project/workflow name width, chip label) via a ResizeObserver on the header.
    window.addEventListener('resize', measure)
    const header = document.getElementById('oe-folder-chip')?.closest('header')
    const ro = header ? new ResizeObserver(measure) : null
    if (header && ro) ro.observe(header)
    return () => {
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [needsFolder])
  // Nudge the viewport for users without scroll input (the direction pad, below).
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const v = getViewport()
      setViewport({ ...v, x: v.x + dx, y: v.y + dy }, { duration: 150 })
    },
    [getViewport, setViewport]
  )

  // The selection (tiles only — frames follow them) drives the floating action bar.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const onSelectionChange = useCallback(
    ({ nodes: sel }: { nodes: Array<{ id: string; type?: string }> }) => {
      const ids = sel.filter((n) => n.type === 'step').map((n) => n.id)
      setSelectedIds(ids)
      useGraph.getState().setCanvasSelection(ids)
      // Opening a node's config float is the job of a CLICK (onNodeClick) — a marquee drag
      // (which is what drives selection change) must not open it, even when it happens to
      // catch a single node.
    },
    []
  )
  const selStep = selectedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is StepNode => !!n && isStep(n))
  // Items selected: each whole group counts once, plus the tiles not in one.
  const selGroupIds = topFullFrames(frames, (id) => selectedIds.includes(id))
  const inSelGroup = new Set(selGroupIds.flatMap((id) => frameTiles(frames, id)))
  const selCount = selGroupIds.length + selectedIds.filter((id) => !inSelGroup.has(id)).length
  const canGroup = selStep.length > 0
  const canUngroup = frames.some((f) => f.members.some((m) => selectedIds.includes(m)))
  // Fold / unfold the selected plot groups' plot lists (see GroupBody); each offered when it'd change one.
  const selGroups = selStep.filter((n) => n.data.kind === 'plotGroup')
  const isFolded = (n: StepNode): boolean => !!(n.data.config as PlotGroupConfig).collapsed
  const canCollapse = selGroups.some((n) => !isFolded(n))
  const canExpand = selGroups.some(isFolded)
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
      // Keep the ghost hidden while the pointer is over a floating canvas button (New step /
      // Cancel, Results →).
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
      const from = wiredKindOf(useGraph.getState(), sourceId) ?? sourceNode.data.kind
      const ops = ALL_OPS.filter((o) => canConnect(from, o))
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
      ref={canvasRef}
      style={{ ...styles.canvas, cursor: placing ? 'copy' : undefined }}
      onMouseMove={onCanvasMouseMove}
    >
      <ReactFlow
        nodes={shown}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // The line drawn while dragging out a connection: dashed (not made yet), in the grey and
        // width of an incomplete connection (GraphEdge).
        connectionLineStyle={CONNECTION_LINE}
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
          // A frame selects its tiles on pointer-down (FrameNode); it has no settings to open.
          if ((node.type as string) === 'frame') return selectNode(null)
          // A click (not a drag) takes the selection to just this tile — out of a selected group
          // too — unless adding to it with ⌘/Ctrl.
          if (!e.metaKey && !e.ctrlKey) selectTiles([node.id])
          // Clicking the tile whose panel is open again hides the panel (the tile stays selected);
          // a group's subcards handle their own clicks, so picking one never lands here.
          if (!e.metaKey && !e.ctrlKey && useGraph.getState().selectedId === node.id)
            return selectNode(null)
          selectNode(node.id)
        }}
        onPaneClick={(e) => {
          if (placing) return placeAt(e)
          dismissPlaceholders()
          selectNode(null)
        }}
        onNodeDragStart={() => {
          draggingRef.current = true
          commit()
        }}
        onNodeDragStop={() => {
          draggingRef.current = false
          // One write of the final layout to the store (marks the project dirty). Moving a node
          // has no downstream side effects, so setting nodes directly is safe.
          useGraph.setState({ nodes: nodesRef.current, dirty: true })
        }}
        onSelectionChange={onSelectionChange}
        // Don't lift a selected node above the rest: a selected frame would then cover its own tiles
        // and swallow clicks meant for them. Tiles get their own stacking (store's elevate / lift).
        elevateNodesOnSelect={false}
        onSelectionStart={onMarqueeStart}
        onSelectionEnd={onMarqueeEnd}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        // Scroll (trackpad two-finger / wheel, both axes) pans the canvas like a scrolling page —
        // so it follows the OS scroll-direction setting (natural vs classic) the same way any web
        // page does; a drag on empty canvas always marquee-selects, and a drag on a node moves it.
        // This makes a pan/select mode toggle unnecessary.
        panOnScroll
        panOnDrag={false}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        zoomOnScroll={false}
        zoomOnPinch
        // Frame existing nodes when a saved workflow is opened (Canvas mounts per project open), but
        // do NOT auto-fit an empty canvas — the bare `fitView` prop defers and fires on the first
        // dropped tile, recentring it instead of leaving it where it was placed. maxZoom caps a
        // single small node from blowing up to the default 2×.
        onInit={(instance) => {
          if (useGraph.getState().nodes.length > 0) instance.fitView({ maxZoom: 1, padding: 0.2 })
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1.4}
          color={PALETTES[mode].axis}
        />
        {/* No data folder yet: an in-canvas hint anchored top-left, its ↑ arrow pointing up toward
            the folder selector in the top bar, before any step can be added. */}
        {needsFolder && (
          <div style={{ ...styles.folderHint, left: hintLeft ?? 18 }}>
            <div style={styles.folderHintArrow}>↑</div>
            <div style={styles.emptyTitle}>Select a data folder</div>
            <div style={styles.emptyText}>
              Choose the folder where this project&apos;s data is saved (the folder selector above)
              to start building.
            </div>
          </div>
        )}
        {/* Empty canvas (folder set): a bottom-centre prompt whose ↓ arrow points to the
            "+ New step" button just below it. */}
        {!needsFolder && nodes.length === 0 && !placing && (
          <div style={styles.stepHint}>
            <div style={styles.emptyTitle}>Empty workflow</div>
            <div style={styles.emptyText}>Add your first step to start building the pipeline.</div>
            <div style={styles.stepHintArrow}>↓</div>
          </div>
        )}
        {/* Bottom-centre; hidden while the selection action bar occupies that spot, and until a data
            folder is set (so steps can't be added before there's data). */}
        {!needsFolder && selectedIds.length === 0 && (
          <NewStep placing={placing} onToggle={togglePlacing} />
        )}
        {selectedIds.length > 0 && (
          <SelectionActions
            count={selCount}
            canGroup={canGroup}
            canUngroup={canUngroup}
            onGroup={() => frameNodesAction(selectedIds)}
            onUngroup={() => unframeNodes(selectedIds)}
            onTidy={() => tidyNodes(selectedIds)}
            onCascade={() => cascadeNodes(selectedIds)}
            canExpand={canExpand}
            canCollapse={canCollapse}
            onExpand={() => setGroupsCollapsed(selectedIds, false)}
            onCollapse={() => setGroupsCollapsed(selectedIds, true)}
            // Copies land on top and become the selection (via node.selected), so the
            // action bar follows them — no clearSelection here.
            onDuplicate={() => duplicateNodes(selectedIds)}
            onDelete={() => {
              // A selected group's tiles go with it (and so the group); Ungroup keeps them.
              selectedIds.forEach((id) => deleteNode(id))
              clearSelection()
            }}
          />
        )}
        <PanControls onPan={panBy} />
        <Controls position="bottom-left" showInteractive={false} />
        <ResultsLink />
        {showMini && (
          <MiniMap
            // Top-left, clear of the Results button in the top-right corner.
            position="top-left"
            pannable
            zoomable
            // Only step tiles have a category: a placeholder or a frame (no `kind`) gets a neutral
            // colour — reading a frame's kind threw and blanked the app.
            nodeColor={(n) =>
              n.type === 'step' ? accentOf(categoryOf((n.data as NodeData).kind)) : UI.border
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

/**
 * Settings → Customisation → Defaults: the settings a NEW tile of a plot kind starts with. It's the same
 * config panel a tile shows, bound to the stored defaults instead of a node — so anything a tile
 * can be set to can be a default. Kept in app settings (not the project), so it holds across
 * projects and updates; existing tiles are never touched.
 */
function PaletteSettings(): ReactNode {
  const palettes = useAppSettings((s) => s.palettes)
  const categorical = useAppSettings((s) => s.categorical)
  const customSpectrum = useAppSettings((s) => s.customSpectrum)
  const customCategorical = useAppSettings((s) => s.customCategorical)
  const update = useAppSettings((s) => s.update)
  // One row per role: its name (what it's about behind an (i)), then its selector.
  const row = (key: string, label: string, info: string, control: ReactNode): ReactNode => (
    <div key={key} style={styles.paletteRow}>
      <span style={styles.paletteRowLabel}>
        {label}
        <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
          <InfoTip label={`About ${label}`}>{info}</InfoTip>
        </span>
      </span>
      <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: 360 }}>{control}</div>
    </div>
  )
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={styles.settingsSubTitle}>
        Default palettes
        <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
          <InfoTip label="About default palettes">
            Each plot’s Automatic palette, by what it colours. A plot can still pick its own.
          </InfoTip>
        </span>
      </div>
      {PALETTE_ROLES.map(({ role, label, hint }) =>
        row(
          role,
          label,
          hint,
          <PaletteSelect
            value={palettes[role]}
            onChange={(v) => v && update({ palettes: { ...palettes, [role]: v } })}
          />
        )
      )}
      {row(
        'categorical',
        'Categories',
        'Groups and conditions: QC, bar plots, the heatmap’s category tracks, legends.',
        <Select
          value={categorical}
          onChange={(v) => update({ categorical: v as CategoricalId })}
          options={categoricalIds().map((id) => ({
            value: id,
            label: id,
            render: <CategoricalLabel id={id} />
          }))}
        />
      )}
      <div style={{ ...styles.settingsSubTitle, marginTop: 20 }}>
        Custom palettes
        <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
          <InfoTip label="About custom palettes">
            Build your own spectrum and category palette. Once made, each is offered as “custom” in
            every palette selector — here and in each plot’s settings.
          </InfoTip>
        </span>
      </div>
      {row(
        'customSpectrum',
        'Spectrum',
        'Up to 5 colours, evenly spaced from the low end to the high end. Drag the marker between two colours to move where they blend half-way; double-click it to reset.',
        // keyed on the applied palette: an Apply or Delete starts the draft afresh
        <SpectrumBuilder
          key={JSON.stringify(customSpectrum ?? null)}
          value={customSpectrum}
          onChange={(v) => update({ customSpectrum: v })}
        />
      )}
      {row(
        'customCategorical',
        'Categories',
        'Up to 20 colours, used in order for groups and conditions.',
        <CategoryBuilder
          key={JSON.stringify(customCategorical ?? null)}
          value={customCategorical}
          onChange={(v) => update({ customCategorical: v })}
        />
      )}
    </div>
  )
}

/** The process steps a plot can be added after, in the editor's order — the Plot defaults page's
 *  first pick. */
const DEFAULT_STEPS = ALL_OPS.filter(
  (k) => categoryOf(k) !== 'plotting' && plotEntriesAfter(k).length > 0
)
/** The plot menu's entries for a step, in its section order (PLOT_SECTIONS). */
function plotEntriesAfter(step: NodeKind): PlotMenuEntry[] {
  return PLOT_SECTIONS.flatMap((sec) => sec.kinds)
    .filter((k) => canConnect(step, k))
    .flatMap((k) => plotEntriesFor(k))
}

function PlotDefaults(): ReactNode {
  // Pick the process step first, then one of the plots it feeds — the plot tile's own menu, so
  // Dose response and Time response are their own entries, as in the editor.
  const [step, setStep] = useState<NodeKind>(DEFAULT_STEPS[0])
  const entries = plotEntriesAfter(step)
  const [pickedKey, setPickedKey] = useState('')
  const entry = entries.find((e) => entryKey(e) === pickedKey) ?? entries[0]
  const kind = entry.kind
  const plotDefaults = useAppSettings((s) => s.plotDefaults)
  const setPlotDefault = useAppSettings((s) => s.setPlotDefault)
  const clearPlotDefault = useAppSettings((s) => s.clearPlotDefault)
  const own = plotDefaults[kind]
  // The panel edits a full config: what a new tile from this entry starts with — the kind's
  // built-in defaults, the stored overrides on top, then the entry's own (dr's axis).
  const config = {
    ...NODE_SPECS[kind].defaultConfig(),
    ...(own ?? {}),
    ...(entry.override ?? {})
  } as NodeConfig
  // The Response plots over each condition (or pair) are one plot kind: one set of defaults serves
  // them all.
  const shared = kind === 'dr' || kind === 'tdr'
  return (
    <>
      {/* One row: the process step, then the plot it feeds (and Reset, once there's a default). */}
      <div style={styles.defaultsHead}>
        <span style={styles.defaultsLabel}>Process:</span>
        <span style={styles.defaultsPick}>
          <Select
            value={step}
            options={DEFAULT_STEPS.map((k) => ({ value: k, label: NODE_SPECS[k].label }))}
            onChange={(v) => setStep(v as NodeKind)}
          />
        </span>
        <span style={{ ...styles.defaultsLabel, marginLeft: 8 }}>Plot:</span>
        {/* The workflow tile's plot menu, single-choice: same sections, same rows. Its themed
            dropdown reads the canvas zoom, so it needs a provider of its own out here. */}
        <span style={styles.defaultsPick}>
          <ReactFlowProvider>
            <PlotEntryMenu
              value={entryKey(entry)}
              upstreamKind={step}
              onChange={(e) => setPickedKey(entryKey(e))}
            />
          </ReactFlowProvider>
        </span>
        {own && (
          <button
            style={styles.defaultsReset}
            onClick={() => clearPlotDefault(kind)}
            title={`Forget the saved defaults for ${entry.label}`}
          >
            Reset
          </button>
        )}
      </div>
      <div style={styles.settingsHint}>
        {own
          ? `New ${entry.label} tiles start with these settings.`
          : `New ${entry.label} tiles start with the built-in settings — change anything below to save a default.`}
        {shared &&
          ` Every ${entry.kind === 'tdr' ? 'two-condition' : 'one-condition'} Response plot shares one set of defaults.`}
      </div>
      {/* The panel's Selects read React Flow's zoom for their dropdown metrics; a provider of its
          own pins that to 1 here, outside the canvas. `edgeNodeId` matches no node, so the panels
          that look upstream simply offer everything. */}
      <ReactFlowProvider>
        <div style={styles.defaultsPanel}>
          <PlotConfig
            key={entryKey(entry)}
            kind={kind}
            config={config}
            update={(patch) => setPlotDefault(kind, patch)}
            edgeNodeId=""
          />
        </div>
      </ReactFlowProvider>
    </>
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
  const accent = useUiTheme((s) => s.accent)
  const setAccent = useUiTheme((s) => s.setAccent)
  const customAccent = useUiTheme((s) => s.customAccent)
  const setCustomAccent = useUiTheme((s) => s.setCustomAccent)
  const mode = useUiTheme((s) => s.mode)
  const copyFormat = useAppSettings((s) => s.copyFormat)
  const copyDpi = useAppSettings((s) => s.copyDpi)
  const downloadFormat = useAppSettings((s) => s.downloadFormat)
  const downloadDpi = useAppSettings((s) => s.downloadDpi)
  const tableFormat = useAppSettings((s) => s.tableFormat)
  const exportBackground = useAppSettings((s) => s.exportBackground)
  const plotFont = useAppSettings((s) => s.plotFont)
  const uiStyle = useAppSettings((s) => s.uiStyle)
  const updateSettings = useAppSettings((s) => s.update)
  const DPI_OPTS = DPI_CHOICES.map((d) => ({ v: String(d), label: `${d} dpi` }))
  const [active, setActive] = useState<
    'appearance' | 'plots' | 'plotDefaults' | 'export' | 'database' | 'about'
  >('appearance')
  const showDot = update.updateAvailable && !silenced
  const APPEARANCE = [
    { v: 'light', label: '☀ Light' },
    { v: 'dark', label: '☾ Dark' },
    { v: 'auto', label: '◐ Auto' }
  ] as const
  const SECTIONS = [
    { id: 'appearance', title: 'Appearance', dot: false },
    { id: 'plots', title: 'Customisation', dot: false },
    { id: 'plotDefaults', title: 'Plot defaults', dot: false },
    { id: 'export', title: 'Export', dot: false },
    { id: 'database', title: 'Database', dot: false },
    { id: 'about', title: 'About', dot: showDot }
  ] as const
  /** A settings choice: the app's ToggleSwitch. */
  const seg = <V extends string>(
    value: V,
    options: readonly { v: V; label: string }[],
    onChange: (v: V) => void
  ): ReactNode => (
    <ToggleSwitch
      label="Setting"
      value={value}
      options={options.map((o) => ({ value: o.v, label: o.label }))}
      onChange={onChange}
    />
  )
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
                <div style={styles.settingsSubTitle}>Colour scheme</div>
                {seg(preference, APPEARANCE, (v) => setPreference(v))}
                {preference === 'auto' && (
                  <div style={styles.settingsHint}>Following your system colour scheme.</div>
                )}
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Accent colour</div>
                <div style={styles.accentRow} role="radiogroup" aria-label="Accent colour">
                  {(['graphite', 'blue', 'orange'] as const).map((id) => {
                    const on = accent === id
                    const [color] = accentColors(id, mode, customAccent)
                    return (
                      <button
                        key={id}
                        role="radio"
                        aria-checked={on}
                        onClick={() => setAccent(id)}
                        style={{
                          ...styles.accentSwatch,
                          outline: on ? `2px solid ${color}` : 'none'
                        }}
                      >
                        <span style={{ ...styles.accentDot, background: color }} />
                        <span style={styles.accentLabel}>{ACCENT_LABELS[id]}</span>
                      </button>
                    )
                  })}
                  {/* Custom: the whole chip opens the app's colour picker and selects it (with its
                      saved colour) — a pick also switches to it. */}
                  <span
                    role="radio"
                    aria-checked={accent === 'custom'}
                    onClick={() => setAccent('custom')}
                  >
                    <ColorPicker
                      value={customAccent}
                      onPick={setCustomAccent}
                      label="Custom accent colour"
                      title="Pick the custom colour"
                      triggerStyle={{
                        ...styles.accentSwatch,
                        outline: accent === 'custom' ? `2px solid ${customAccent}` : 'none'
                      }}
                    >
                      <span
                        style={{
                          ...styles.accentDot,
                          background: customAccent,
                          boxShadow: `0 0 0 1px ${UI.border}`
                        }}
                      />
                      <span style={styles.accentLabel}>{ACCENT_LABELS.custom}</span>
                    </ColorPicker>
                  </span>
                </div>
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>
                  Workflow editor mode
                </div>
                <div style={styles.layoutTiles} role="radiogroup" aria-label="Workflow editor mode">
                  {LAYOUTS.map((o) => {
                    const on = uiStyle === o.v
                    return (
                      <button
                        key={o.v}
                        role="radio"
                        aria-checked={on}
                        onClick={() => updateSettings({ uiStyle: o.v })}
                        style={{
                          ...styles.layoutTile,
                          // Whole shorthand, so nothing is left behind when the choice moves.
                          border: `2px solid ${on ? UI.accent : UI.border}`,
                          background: on ? UI.panelAlt : 'transparent'
                        }}
                      >
                        <span style={{ color: on ? UI.accent : UI.textMuted }}>
                          <LayoutGlyph kind={o.v} />
                        </span>
                        <span style={styles.layoutTileTitle}>{o.label}</span>
                        <span style={styles.layoutTileText}>{o.hint}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : active === 'plots' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Customisation</h2>
                <div style={styles.settingsSubTitle}>
                  Plot font
                  <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                    <InfoTip label="About the plot font">
                      All plot text, on screen and in every copy and export. Arial and Helvetica are
                      what most journals ask for in figures.
                    </InfoTip>
                  </span>
                </div>
                <div style={{ marginBottom: 24 }}>
                  {seg(
                    plotFont,
                    (Object.keys(PLOT_FONTS) as PlotFontId[]).map((id) => ({
                      v: id,
                      label: PLOT_FONTS[id].label
                    })),
                    (v) => updateSettings({ plotFont: v })
                  )}
                </div>
                <PaletteSettings />
              </>
            ) : active === 'plotDefaults' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Plot defaults</h2>
                <PlotDefaults />
              </>
            ) : active === 'export' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Export</h2>
                {/* A tile's Copy and Download buttons act straight away (no window of their own):
                    Copy in this format/DPI; Download opens the OS save window for this format. */}
                <div style={styles.settingsSubTitle}>
                  Background
                  <span style={{ marginLeft: 4, verticalAlign: 'middle' }}>
                    <InfoTip label="About the export background">
                      What every copied or exported plot sits on. Transparent leaves no backdrop,
                      for placing a plot on a coloured slide or into a figure.
                    </InfoTip>
                  </span>
                </div>
                {seg(
                  exportBackground,
                  [
                    { v: 'white', label: 'White' },
                    { v: 'transparent', label: 'Transparent' }
                  ] as const,
                  (v) => updateSettings({ exportBackground: v })
                )}

                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Copy to clipboard</div>
                {/* format, then resolution in line to its right */}
                <div style={styles.settingsInline}>
                  <div>
                    <div style={styles.settingsFieldLabel}>Format</div>
                    {seg(
                      copyFormat,
                      [
                        { v: 'png', label: 'PNG' },
                        { v: 'svg', label: 'SVG' }
                      ] as const,
                      (v) => updateSettings({ copyFormat: v })
                    )}
                  </div>
                  <div>
                    <div style={styles.settingsFieldLabel}>Resolution</div>
                    {seg(String(copyDpi), DPI_OPTS, (v) => updateSettings({ copyDpi: Number(v) }))}
                  </div>
                </div>

                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Download</div>
                <div style={styles.settingsInline}>
                  <div>
                    <div style={styles.settingsFieldLabel}>Plot format</div>
                    {seg(
                      downloadFormat,
                      [
                        { v: 'svg', label: 'SVG' },
                        { v: 'png', label: 'PNG' },
                        { v: 'pdf', label: 'PDF' }
                      ] as const,
                      (v) => updateSettings({ downloadFormat: v })
                    )}
                  </div>
                  <div>
                    <div style={styles.settingsFieldLabel}>Resolution</div>
                    {seg(String(downloadDpi), DPI_OPTS, (v) =>
                      updateSettings({ downloadDpi: Number(v) })
                    )}
                  </div>
                </div>
                <div style={{ ...styles.settingsFieldLabel, marginTop: 16 }}>Table format</div>
                {seg(
                  tableFormat,
                  [
                    { v: 'csv', label: 'CSV' },
                    { v: 'xlsx', label: 'XLSX' }
                  ] as const,
                  (v) => updateSettings({ tableFormat: v })
                )}
              </>
            ) : active === 'database' ? (
              <>
                <h2 style={styles.settingsContentTitle}>Database</h2>
                <AnnotationCache />
              </>
            ) : (
              <>
                <h2 style={styles.settingsContentTitle}>About</h2>
                {/* The namecard; the update status follows in full, so no tag on it here. */}
                <AppCard update={update} showUpdate={false} />
                {/* Updates: check again, and what the check found. */}
                <div style={{ ...styles.settingsSubTitle, marginTop: 24 }}>Updates</div>
                <div style={styles.updateActions}>
                  <button
                    style={styles.updateButton}
                    onClick={update.check}
                    disabled={update.checking}
                  >
                    Check now
                  </button>
                  {update.checking ? (
                    <span style={styles.aboutMuted}>Checking…</span>
                  ) : update.updateAvailable ? (
                    <span style={styles.aboutUpdate}>
                      <span style={styles.aboutDot} /> v{update.latest} is available —{' '}
                      <a
                        href={update.releaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.aboutLink}
                      >
                        download
                      </a>
                    </span>
                  ) : update.failed ? (
                    <span style={styles.aboutMuted}>Couldn’t check — try again later.</span>
                  ) : (
                    <span style={styles.aboutMuted}>You’re on the latest version.</span>
                  )}
                </div>
                <label style={{ ...styles.silenceRow, marginTop: 14 }}>
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

/** The two layouts, as the Settings tiles present them. */
const LAYOUTS = [
  {
    v: 'flow' as const,
    label: 'Flowchart',
    hint: 'Workflow as a node canvas; results as a drag-and-drop dashboard.'
  },
  {
    v: 'form' as const,
    label: 'Form',
    hint: 'Workflow as a list of steps, each with its settings and plots beside it.'
  }
]

/** Flowchart / Form, in the main nav after the workflow selector: the same setting as the Settings
 *  tiles. */
/** A nav dropdown's menu: drops open under its chip and lifts away on close (.oe-menu-in / -out,
 *  as the gene selector's) — staying mounted through its exit, then unmounting. */
function NavMenu({
  open,
  style,
  children
}: {
  open: boolean
  style: CSSProperties
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  const leaving = mounted && !open
  if (!mounted) return null
  return (
    <div
      className={leaving ? 'oe-menu-out' : 'oe-menu-in'}
      style={{ ...style, ...(leaving ? { pointerEvents: 'none' } : null) }}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && leaving) setMounted(false)
      }}
    >
      {children}
    </div>
  )
}

/** A nav dropdown's caret: the app's line chevron, pointing down, flipping up while it's open. */
function NavCaret({ open }: { open: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        flex: '0 0 auto',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: 'transform 160ms ease-out'
      }}
    >
      <Chevron deg={90} size={10} />
    </span>
  )
}

function LayoutToggle() {
  const uiStyle = useAppSettings((s) => s.uiStyle)
  const update = useAppSettings((s) => s.update)
  // The app's sliding switch, pill-shaped and in the subtle tone, so it sits as quietly as the
  // folder / workflow chip beside it.
  return (
    <ToggleSwitch
      label="Workflow editor mode"
      size="lg"
      tone="subtle"
      value={uiStyle}
      options={LAYOUTS.map((o) => ({
        value: o.v,
        label: (
          // One text line tall, so the switch matches the workflow chip's height; the negative
          // margin takes back some of the padding meant for a word.
          <span style={styles.layoutIconBox} aria-label={o.label}>
            <LayoutIcon kind={o.v} />
          </span>
        ),
        title: `${o.label} — ${o.hint}`
      }))}
      onChange={(v) => update({ uiStyle: v })}
    />
  )
}

/** A layout's small icon for the nav switch: the Settings glyph (below) redrawn at icon size —
 *  Flow, one node wired to two; Form, a step list beside two panels. */
function LayoutIcon({ kind }: { kind: 'flow' | 'form' }): ReactNode {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    style: { display: 'block', flex: '0 0 auto' }
  }
  return kind === 'flow' ? (
    <svg {...common}>
      <rect x="1" y="6" width="4" height="4" rx="1" />
      <rect x="11" y="1.5" width="4" height="4" rx="1" />
      <rect x="11" y="10.5" width="4" height="4" rx="1" />
      <path d="M5 8 C8 8 8 3.5 11 3.5" />
      <path d="M5 8 C8 8 8 12.5 11 12.5" />
    </svg>
  ) : (
    <svg {...common}>
      <rect x="1" y="1.5" width="5" height="13" rx="1" />
      <rect x="8" y="1.5" width="7" height="5.5" rx="1" />
      <rect x="8" y="9" width="7" height="5.5" rx="1" />
    </svg>
  )
}

/** A layout's glyph for its Settings tile, drawn in currentColor. Flow: three nodes wired left to
 *  right, the canvas in miniature. Form: a step list down the left beside a stack of panels. */
function LayoutGlyph({ kind }: { kind: 'flow' | 'form' }): ReactNode {
  const common = {
    width: 72,
    height: 48,
    viewBox: '0 0 72 48',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true
  }
  return kind === 'flow' ? (
    <svg {...common}>
      <rect x="3" y="18" width="16" height="12" rx="3" />
      <rect x="29" y="5" width="16" height="12" rx="3" />
      <rect x="29" y="31" width="16" height="12" rx="3" />
      <rect x="54" y="18" width="15" height="12" rx="3" />
      <path d="M19 24 C24 24 24 11 29 11" />
      <path d="M19 24 C24 24 24 37 29 37" />
      <path d="M45 11 C50 11 49 24 54 24" />
    </svg>
  ) : (
    <svg {...common}>
      <rect x="3" y="4" width="20" height="40" rx="3" />
      <path d="M8 12h10M8 20h10M8 28h10M8 36h6" />
      <rect x="29" y="4" width="40" height="17" rx="3" />
      <rect x="29" y="27" width="40" height="17" rx="3" />
      <path d="M35 12h20M35 35h14" />
    </svg>
  )
}

/** The gene selector, in the top nav in both layouts: the selection it drives is shared by every
 *  plot, on the dashboard and in the form alike, so it sits with the app-wide controls rather than
 *  inside one view. */
function NavGeneSelector() {
  // Only the results' gene names and annotations, so a plot's run (which stores a marker) doesn't
  // rebuild the menu — see menuParts.
  const tabs = useGeneMenuTabs(useGraph(useShallow(menuParts)))
  return <GeneSelectMenu tabs={tabs} />
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
  const moveFolder = useGraph((s) => s.moveFolder)
  const [open, setOpen] = useState(false)
  const active = folders.find((f) => f.id === activeFolderId) ?? null
  const label = active ? (active.path ? active.name : 'Select folder…') : 'no folder'

  return (
    <div style={{ position: 'relative' }}>
      <button
        id="oe-folder-chip"
        data-open={open}
        style={{ ...styles.chipSeg, ...(dataDirMissing ? styles.chipSegWarn : null) }}
        title={dataDirMissing ? `Folder not found: ${active?.path}` : active?.path || 'folder'}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ ...styles.chipIcon, ...(dataDirMissing ? { color: UI.warn } : null) }}>
          {dataDirMissing ? <StatusIcon kind="warn" /> : <IconFolder />}
        </span>
        {label}
        <NavCaret open={open} />
      </button>
      {open && <div style={styles.scrim} onClick={() => setOpen(false)} />}
      <NavMenu open={open} style={styles.folderMenu}>
        {folders.map((f) => {
          const missing = f.id === activeFolderId && dataDirMissing
          // A path-less folder is an unset placeholder: show a plain call-to-action to pick a
          // folder, not a dummy "(no path)" tile (and nothing to delete).
          const noPath = !f.path && !missing
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
                title={f.path || 'Select a data folder'}
                onClick={() => {
                  // A missing OR path-less folder needs a folder picked for it; otherwise just
                  // switch to it.
                  if (missing || !f.path) void repathFolder(f.id)
                  else switchFolder(f.id)
                  setOpen(false)
                }}
              >
                {noPath ? (
                  <span style={styles.folderName}>
                    Select folder where project data is saved to
                  </span>
                ) : (
                  <>
                    {missing ? (
                      <StatusNote kind="warn" style={{ marginTop: 0, fontSize: 12 }}>
                        {f.name} — not found
                      </StatusNote>
                    ) : (
                      <span style={styles.folderName}>{f.name}</span>
                    )}
                    <span style={{ ...styles.folderPath, ...(missing ? styles.pathWarn : null) }}>
                      {f.path || '—'}
                    </span>
                    {missing && (
                      <StatusNote kind="warn" style={{ marginTop: 2, fontWeight: 600 }}>
                        Click to re-select folder…
                      </StatusNote>
                    )}
                  </>
                )}
              </button>
              {!noPath && !missing && (
                <button
                  style={styles.rowIconBtn}
                  title="Change location… (moves the project data; copies the input files used)"
                  aria-label="Change folder location"
                  onClick={() => {
                    void moveFolder(f.id)
                    setOpen(false)
                  }}
                >
                  <IconEdit />
                </button>
              )}
              {!noPath && (
                <button
                  style={{ ...styles.rowIconBtn, color: '#e15759' }}
                  title={
                    folders.length > 1
                      ? 'Delete folder'
                      : 'Delete folder (resets to an empty folder)'
                  }
                  aria-label="Delete folder"
                  onClick={() => deleteFolder(f.id)}
                >
                  <IconTrash />
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
      </NavMenu>
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
      <button
        data-open={open}
        style={styles.chipSeg}
        title="Workflow menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.chipIcon}>⎇</span>
        {active ? active.name : 'no workflow'}
        <NavCaret open={open} />
      </button>
      {open && (
        <div
          style={styles.scrim}
          onClick={() => {
            setOpen(false)
            setRenamingId(null)
          }}
        />
      )}
      <NavMenu open={open} style={styles.projectMenu}>
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
              style={styles.rowIconBtn}
              title="Rename workflow"
              aria-label="Rename workflow"
              onClick={() => {
                setRenamingId(w.id)
                setRenameText(w.name)
              }}
            >
              <IconEdit />
            </button>
            {workflows.length > 1 && (
              <button
                style={{ ...styles.rowIconBtn, color: '#e15759' }}
                title="Delete workflow"
                aria-label="Delete workflow"
                onClick={() => deleteWorkflow(w.id)}
              >
                <IconTrash />
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
      </NavMenu>
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
    <>
      {/* While the whole pipeline runs, say so beside its Stop button. Positioned out of the
          row's flow, so it never shifts the centred gene selector. */}
      {runningAll && (
        // zero width, and the header's 12px gap cancelled, so the row lays out as if absent
        <span style={{ position: 'relative', width: 0, marginRight: -12, alignSelf: 'stretch' }}>
          <StatusNote
            kind="progress"
            inline
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 12
            }}
          >
            Running…
          </StatusNote>
        </span>
      )}
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
    </>
  )
}

/** Opens the project-folder viewer on the active data folder; disabled when there's none on disk. */
function FolderViewerButton() {
  const dataDir = useGraph((s) => s.dataDir)
  const dataDirMissing = useGraph((s) => s.dataDirMissing)
  const [open, setOpen] = useState(false)
  const usable = !!dataDir && !dataDirMissing
  const title = usable ? 'Project folder' : 'No project folder — add one from the folder chip'
  return (
    <>
      <button
        data-open={open}
        style={{ ...styles.navBtn, opacity: usable ? 1 : 0.5 }}
        disabled={!usable}
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
      >
        <IconFolderTree />
      </button>
      {open && dataDir && <ProjectFolderViewer root={dataDir} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Project name as a dropdown chip: switch to a recent project, open one, or start new.
 *  With no project open it shows a placeholder; the dropdown still offers open/new. */
function ProjectMenu() {
  const projectOpen = useGraph((s) => s.projectOpen)
  const projectName = useGraph((s) => s.projectName)
  const projectPath = useGraph((s) => s.projectPath)
  const dirty = useGraph((s) => s.dirty)
  const saving = useGraph((s) => s.saving)
  const recents = useGraph((s) => s.recentProjects)
  const openProject = useGraph((s) => s.openProject)
  const newProject = useGraph((s) => s.newProject)
  const newFromTemplate = useGraph((s) => s.newFromTemplate)
  const forgetRecent = useGraph((s) => s.forgetRecent)
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        data-open={open}
        style={{ ...styles.projectChip, color: projectOpen ? UI.text : UI.textMuted }}
        title="Project menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={styles.projectChipName}>{projectOpen ? projectName : 'No project'}</span>
        {projectOpen &&
          (saving ? (
            // While a save is written: the spinner (on the compositor, so it turns regardless).
            <span style={styles.savingIcon} title="Saving…">
              <StatusIcon kind="progress" />
            </span>
          ) : (
            <span
              style={{ ...styles.statusDot, background: dirty ? '#e2b93b' : '#3fb950' }}
              title={dirty ? 'Unsaved changes' : 'All changes saved'}
            />
          ))}
        <NavCaret open={open} />
      </button>
      {open && <div style={styles.scrim} onClick={() => setOpen(false)} />}
      <NavMenu open={open} style={styles.projectMenu}>
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
            void newProject()
            setOpen(false)
          }}
        >
          New project
        </button>
        <button
          style={styles.menuAction}
          onClick={() => {
            void newFromTemplate()
            setOpen(false)
          }}
        >
          New project from template…
        </button>
      </NavMenu>
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
function IconGuide({ size = 17 }: { size?: number } = {}) {
  // Open book — "user guide".
  return (
    <svg
      width={size}
      height={size}
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
function IconStart({ size = 17 }: { size?: number } = {}) {
  // A flag on its pole — the tutorial.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  )
}
function IconGlobe() {
  // Globe — the project website.
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
  )
}

function IconPaper({ size = 13 }: { size?: number }) {
  // A page of text — the publication.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}

function IconGitHub() {
  // GitHub mark — the source repository.
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
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
function IconFolderTree() {
  // Plain folder outline — the project-folder viewer.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6.5h5l2 2h10V18.5h-17z" />
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

/** Minimalist rename (pencil) icon for menu rows. */
function IconEdit() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20l1-4L16 5l3 3L8 19z" />
      <path d="M14 7l3 3" />
    </svg>
  )
}
/** Control chip: save / save-as / undo / redo, one bordered group split by dividers. */
function ControlChip() {
  const dirty = useGraph((s) => s.dirty)
  const saveProject = useGraph((s) => s.saveProject)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const canUndo = useGraph((s) => s.past.length > 0)
  const canRedo = useGraph((s) => s.future.length > 0)
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)
  const saveError = useGraph((s) => s.saveError)
  const saveWarning = useGraph((s) => s.saveWarning)
  const clearSaveError = useGraph((s) => s.clearSaveError)
  // Cmd/Ctrl+S saves, as the save button does (nothing to save, or a save running → no-op);
  // with Shift it saves as a new project file (the save-as menu's first entry).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      const s = useGraph.getState()
      if (s.saving) return
      if (e.shiftKey) void s.saveProjectAs()
      else if (s.dirty) void s.saveProject()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div style={{ ...styles.ctrlChip, position: 'relative' }}>
      {/* A failed save says why, just under the controls — as does a save whose folders couldn't
          all be renamed to match. Click to dismiss. */}
      {(saveError || saveWarning) && (
        <div style={styles.saveError} onClick={clearSaveError} title="Dismiss">
          <StatusNote kind={saveError ? 'error' : 'warn'} style={{ margin: 0 }}>
            {saveError ?? saveWarning}
          </StatusNote>
        </div>
      )}
      <button
        style={{
          ...styles.ctrlBtn,
          color: saveError ? UI.err : dirty ? UI.text : UI.textMuted,
          opacity: dirty ? 1 : 0.5,
          cursor: dirty ? 'pointer' : 'default'
        }}
        title={dirty ? 'Save project' : 'All changes saved'}
        disabled={!dirty}
        onClick={() => void saveProject()}
      >
        <IconSave />
      </button>
      {/* Save as: a dropdown — a new project file, or a template (its sections expand in place). */}
      <div style={{ position: 'relative', display: 'flex' }}>
        <button
          style={styles.ctrlBtn}
          title="Save as project or template…"
          onClick={() => setSaveAsOpen((o) => !o)}
        >
          <span style={styles.saveAsWrap}>
            <IconSave />
            <span style={styles.pencilBadge}>
              <IconPencil />
            </span>
          </span>
        </button>
        {saveAsOpen && <div style={styles.scrim} onClick={() => setSaveAsOpen(false)} />}
        <NavMenu open={saveAsOpen} style={styles.saveAsMenu}>
          <SaveAsMenu onClose={() => setSaveAsOpen(false)} />
        </NavMenu>
      </div>
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

const WEBSITE_URL = 'https://yjzhng.github.io/open-bioware/apps/omicexplorer/'

/** The app's Website and GitHub buttons (part of the namecard, AppCard). */
function AppLinks() {
  return (
    <div style={styles.homeLinks}>
      <a href={WEBSITE_URL} target="_blank" rel="noreferrer" style={styles.homeLink}>
        <IconGlobe />
        Website
      </a>
      <a href={REPO_URL} target="_blank" rel="noreferrer" style={styles.homeLink}>
        <IconGitHub />
        GitHub
      </a>
    </div>
  )
}

/** The app's namecard — logo, name, version (with the update tag), Website / GitHub, and how to
 *  cite it. The same card on the home page's left column and in Settings → About; `children` go
 *  between the name and the citation (the home page's Getting started section). */
function AppCard({
  update,
  showUpdate,
  children
}: {
  update: UpdateInfo
  showUpdate: boolean
  children?: ReactNode
}) {
  return (
    <>
      <div style={styles.homeBrand}>
        <img src={appLogo} alt="" style={styles.homeLogo} draggable={false} />
        <div>
          <div style={styles.homeTitle}>{__APP_NAME__}</div>
          <div style={styles.homeVersion}>
            v{__APP_VERSION__}
            {showUpdate && (
              <a
                href={update.releaseUrl}
                target="_blank"
                rel="noreferrer"
                style={styles.homeUpdateTag}
                title={`Download v${update.latest}`}
              >
                Update available · v{update.latest}
              </a>
            )}
          </div>
          <AppLinks />
        </div>
      </div>
      {children}
      <AppCitation />
    </>
  )
}

/** The namecard's "Cite this software": the reference (and DOI) from this version's release notes,
 *  baked in at build time (config/citation.ts), with a copy button — or a note that there's none
 *  yet. */
function AppCitation() {
  const [copied, setCopied] = useState(false)
  const cite = __APP_CITATION__
  const copy = (): void => {
    if (!cite) return
    void window.api.copyText(cite.reference).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <>
      <div style={styles.recentHead}>Cite this software</div>
      <div style={{ ...styles.homeCard, ...styles.citeCard }}>
        {cite ? (
          <>
            <p style={styles.citeRef}>{cite.reference}</p>
            <div style={styles.citeFoot}>
              {/* doi.org resolves the DOI to the publication's page. */}
              {cite.doi && (
                <span style={styles.citeDoi}>
                  DOI:{' '}
                  <a
                    href={`https://doi.org/${cite.doi}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.citeDoiLink}
                    title={`Open the publication (https://doi.org/${cite.doi})`}
                  >
                    {cite.doi}
                  </a>
                </span>
              )}
              <button
                style={{ ...styles.homeLink, ...styles.citeCopy }}
                onClick={copy}
                title="Copy the reference"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </>
        ) : (
          <p style={styles.citeNone}>No reference available yet.</p>
        )}
      </div>
    </>
  )
}

/** The home page's Getting started section, under the namecard: Tutorial (a walkthrough — not
 *  ready yet, so shown disabled), Documentation (the user guide, as the nav's book button opens)
 *  and Publication (the paper, by the DOI in this version's citation — config/citation.ts —
 *  disabled until there is one). */
function HomeGuides({ onGuide }: { onGuide: () => void }) {
  const doi = __APP_CITATION__?.doi
  return (
    <>
      <div style={styles.recentHead}>Getting started</div>
      <div style={styles.homeGuides}>
        <button
          className="oe-press oe-guide-btn"
          style={{ ...styles.homeSecondary, ...styles.homeGuideBtn, ...styles.homeGuideOff }}
          disabled
          title="Tutorial — coming soon"
        >
          <IconStart size={15} />
          Tutorial
        </button>
        <button
          className="oe-press oe-guide-btn"
          style={{ ...styles.homeSecondary, ...styles.homeGuideBtn }}
          onClick={onGuide}
          title="User guide"
        >
          <IconGuide size={15} />
          Documentation
        </button>
        <button
          className="oe-press oe-guide-btn"
          style={{
            ...styles.homeSecondary,
            ...styles.homeGuideBtn,
            ...(doi ? null : styles.homeGuideOff)
          }}
          disabled={!doi}
          onClick={() => doi && window.open(`https://doi.org/${doi}`, '_blank', 'noreferrer')}
          title={
            doi ? `The publication (https://doi.org/${doi})` : 'Publication — not available yet'
          }
        >
          <IconPaper size={15} />
          Publication
        </button>
      </div>
    </>
  )
}

/** Landing page: create/open a project, with a recent-projects list. */
/** This build's version, for comparing a project file against. */
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null

/** A recent project's version tag, beside its name: the app version that last saved the file —
 *  amber when this app's migrations would change the file (Fix rewrites it) — not merely because an
 *  older release saved it — red when a newer app saved it. The tooltip has the file format and the version it was created with. */
function ProjectVersionTag({ path }: { path: string | null }): ReactNode {
  const h = useGraph((s) => (path ? s.recentHeaders[path] : undefined))
  const upgrades = useGraph((s) => (path ? s.recentUpgrades[path] : undefined))
  if (!h) return null
  const standing = projectStanding(h, APP_VERSION, upgrades)
  const color = standing === 'older' ? '#e2b93b' : standing === 'newer' ? UI.err : UI.textMuted
  const title = [
    h.savedBy ? `Last saved by OmicExplorer ${h.savedBy}` : 'Saved before OmicExplorer 0.3.5',
    `Created with ${h.createdWith ?? 'an unrecorded version (before 0.3.7)'}`,
    `File format ${h.format ?? '?'}`,
    standing === 'older'
      ? 'Written in an older form — it opens fine; Fix rewrites it in the current one'
      : standing === 'newer'
        ? `Saved by a newer app than this one (${APP_VERSION ?? '?'}) — update before editing it`
        : ''
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span
      title={title}
      style={{ ...styles.versionTag, color, borderColor: `${color}66`, background: `${color}14` }}
    >
      {h.savedBy ? `v${h.savedBy}` : 'pre-0.3.5'}
    </span>
  )
}

/** The menu width (px) of a project row's actions. */
const ROW_MENU_W = 200

/** A Last / Recent project row's actions, behind the hamburger at its right: open it (resume, for
 *  the session still live), show the file in the OS file manager, Fix — only for a file in an older
 *  form: rewrite it in the current format, a copy of the old file kept beside it, then say how it
 *  went — and remove it from the list (the file itself stays on disk). */
function ProjectRowMenu({
  path,
  openLabel = 'Open',
  onOpen,
  onDelete
}: {
  path: string | null
  /** the open item's label ('Resume' for the live session) */
  openLabel?: string
  onOpen: () => void
  /** remove from the recents; unset = not listed there (an unsaved live session) */
  onDelete?: () => void
}): ReactNode {
  const h = useGraph((s) => (path ? s.recentHeaders[path] : undefined))
  const upgradeProject = useGraph((s) => s.upgradeProject)
  const isOpen = useGraph((s) => s.projectOpen && s.projectPath === path)
  const [state, setState] = useState<
    { busy: true } | { busy: false; ok: boolean; text: string } | null
  >(null)
  const [at, setAt] = useState<CSSProperties | null>(null)
  // The menu is portalled to <body>, outside the app root that carries the theme's CSS variables,
  // so it's coloured from the palette itself (as the app's Select menu is).
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const upgrades = useGraph((s) => (path ? s.recentUpgrades[path] : undefined))
  const older = !!path && !!h && projectStanding(h, APP_VERSION, upgrades) === 'older'
  const fix = async (): Promise<void> => {
    if (!path) return
    setState({ busy: true })
    const r = await upgradeProject(path)
    setState(
      r.error
        ? { busy: false, ok: false, text: `Couldn't fix: ${r.error}` }
        : {
            busy: false,
            ok: true,
            text: `Fixed — old file kept as ${(r.backup ?? '').split(/[/\\]/).pop()}`
          }
    )
  }
  // Each item closes the menu, then acts.
  const item = (
    label: string,
    act: (() => void) | null,
    title?: string,
    danger?: boolean
  ): ReactNode => (
    <button
      style={{
        ...styles.menuAction,
        color: danger ? p.err : p.text,
        ...(act ? null : { color: p.textMuted, opacity: 0.5, cursor: 'default' })
      }}
      disabled={!act}
      title={title}
      onClick={() => {
        setAt(null)
        act?.()
      }}
    >
      {label}
    </button>
  )
  return (
    <span style={styles.fixWrap}>
      {state && (
        <span
          style={{ ...styles.fixNote, color: state.busy || state.ok ? UI.textMuted : UI.err }}
          title={state.busy ? undefined : state.text}
        >
          {state.busy ? 'Fixing…' : state.text}
        </span>
      )}
      <button
        className="oe-row-menu-btn"
        style={{ ...styles.recentMenuBtn, ...(at ? styles.recentMenuBtnOpen : null) }}
        title="Project actions"
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          e.stopPropagation()
          if (at) return setAt(null)
          // Under the button, its right edge lined up with the button's (it sits at the row's end).
          const r = e.currentTarget.getBoundingClientRect()
          const place = placeMenu(r, ROW_MENU_W, 220)
          setAt({ ...place, left: Math.max(8, r.right - ROW_MENU_W) })
        }}
      >
        <IconMenu />
      </button>
      {at &&
        createPortal(
          <>
            <div style={styles.scrim} onClick={() => setAt(null)} />
            <div
              className="oe-menu-in oe-row-menu"
              role="menu"
              style={{ ...styles.rowMenu, background: p.panel, borderColor: p.border, ...at }}
              onClick={(e) => e.stopPropagation()}
            >
              {item(openLabel, onOpen)}
              {item(REVEAL.item, path ? () => void window.api.revealPath(path) : null)}
              {item(
                'Fix',
                older && !state?.busy ? () => void fix() : null,
                older
                  ? isOpen
                    ? 'Save the open project in the current format (its unsaved changes too); a copy of the old file is kept beside it'
                    : 'Rewrite this project in the current format; a copy of the old file is kept beside it'
                  : 'Already in the current format'
              )}
              <div style={{ ...styles.menuDivider, background: p.border }} />
              {item(
                'Remove',
                onDelete ?? null,
                'Remove from recent projects — the file stays on disk',
                true
              )}
            </div>
          </>,
          document.body
        )}
    </span>
  )
}

function Home({
  update,
  showUpdate,
  onGuide
}: {
  update: UpdateInfo
  showUpdate: boolean
  /** open the user guide */
  onGuide: () => void
}) {
  const newProject = useGraph((s) => s.newProject)
  const newFromTemplate = useGraph((s) => s.newFromTemplate)
  const openProject = useGraph((s) => s.openProject)
  const resumeProject = useGraph((s) => s.resumeProject)
  const recents = useGraph((s) => s.recentProjects)
  const forgetRecent = useGraph((s) => s.forgetRecent)
  const loadRecentHeaders = useGraph((s) => s.loadRecentHeaders)
  // Each recent file's header, for its version tag — re-read whenever the list changes.
  useEffect(() => {
    void loadRecentHeaders()
  }, [recents, loadRecentHeaders])
  const openError = useGraph((s) => s.openError)
  const projectName = useGraph((s) => s.projectName)
  const projectPath = useGraph((s) => s.projectPath)
  const dirty = useGraph((s) => s.dirty)
  // "Last project": resume the project still live in this session (goHome keeps it in memory, so its
  // unsaved changes survive an accidental trip home). On a fresh session with none live, fall back to
  // the most-recently opened project, which "resumes" by opening it from disk.
  const hasSession = useGraph((s) => s.folders.length > 0)
  const last = hasSession
    ? { mode: 'resume' as const, name: projectName, path: projectPath, dirty }
    : recents.length > 0
      ? { mode: 'open' as const, name: recents[0].name, path: recents[0].path, dirty: false }
      : null
  // Don't list the last project again under Recent (avoid a duplicate row).
  const recentRest = last?.path ? recents.filter((r) => r.path !== last.path) : recents
  return (
    <div style={styles.home}>
      <div style={styles.homeInner}>
        {/* Left: the app's namecard. */}
        <div style={styles.homeLeft}>
          <AppCard update={update} showUpdate={showUpdate}>
            <HomeGuides onGuide={onGuide} />
          </AppCard>
        </div>
        {/* Right: projects — new / open, the last one, recent ones (only the list scrolls). */}
        <div style={styles.homeRight}>
          <p style={styles.homeSub}>Create or open a project to begin.</p>
          <div style={styles.homeActions}>
            <button
              style={{ ...styles.homePrimary, ...styles.homeAction }}
              onClick={() => void newProject()}
            >
              ＋ New project
            </button>
            <button
              style={{ ...styles.homeSecondary, ...styles.homeAction }}
              onClick={() => void openProject()}
            >
              Open project…
            </button>
            <button
              style={{ ...styles.homeSecondary, ...styles.homeAction }}
              onClick={() => void newFromTemplate()}
            >
              From template…
            </button>
            {/* not wired up yet: shown so the home page's layout is final */}
            <button
              style={{
                ...styles.homeSecondary,
                ...styles.homeAction,
                opacity: 0.45,
                cursor: 'default'
              }}
              disabled
              title="Coming soon"
            >
              Example project
            </button>
          </div>
          {openError && (
            <div style={styles.openError}>
              <StatusNote kind="error" style={{ marginTop: 0, fontSize: 12 }}>
                {openError}
              </StatusNote>
            </div>
          )}
          {last && (
            <>
              <div style={styles.recentHead}>Last project</div>
              <div style={styles.homeCard}>
                <div style={styles.recentRow}>
                  <button
                    style={styles.recentItem}
                    title={
                      last.mode === 'resume'
                        ? 'Resume where you left off (keeps unsaved changes)'
                        : (last.path ?? '')
                    }
                    onClick={() =>
                      last.mode === 'resume'
                        ? resumeProject()
                        : void openProject(last.path ?? undefined)
                    }
                  >
                    <span
                      style={{
                        ...styles.recentName,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <span
                        style={{
                          ...styles.statusDot,
                          background: last.dirty ? '#e2b93b' : '#3fb950'
                        }}
                      />
                      {last.name}
                      <ProjectVersionTag path={last.path} />
                    </span>
                    <span style={styles.recentPath}>
                      {last.mode === 'resume'
                        ? last.dirty
                          ? 'Unsaved changes — resume to keep them'
                          : (last.path ?? 'Resume this session')
                        : (last.path ?? '')}
                    </span>
                  </button>
                  <ProjectRowMenu
                    path={last.path}
                    openLabel={last.mode === 'resume' ? 'Resume' : 'Open'}
                    onOpen={() =>
                      last.mode === 'resume'
                        ? resumeProject()
                        : void openProject(last.path ?? undefined)
                    }
                    onDelete={
                      last.path && recents.some((r) => r.path === last.path)
                        ? () => forgetRecent(last.path!)
                        : undefined
                    }
                  />
                </div>
              </div>
            </>
          )}
          {/* Recent list, minus whatever is already shown as the Last project. This card fills the
            rest of the window and is the only part that scrolls; the header above stays put. */}
          <div style={styles.recentHead}>Recent projects</div>
          <div
            className="oe-scroll"
            style={{ ...styles.homeCard, ...(recentRest.length > 2 ? styles.recentScroll : null) }}
          >
            {recentRest.length === 0 ? (
              <div style={styles.recentEmpty}>
                {last ? 'No other recent projects.' : 'No recent projects yet.'}
              </div>
            ) : (
              recentRest.map((r, i) => (
                <div
                  key={r.path}
                  style={{ ...styles.recentRow, ...(i > 0 ? styles.recentDivider : null) }}
                >
                  <button
                    style={styles.recentItem}
                    title={r.path}
                    onClick={() => void openProject(r.path)}
                  >
                    <span style={styles.recentNameLine}>
                      <span style={styles.recentName}>{r.name}</span>
                      <ProjectVersionTag path={r.path} />
                    </span>
                    <span style={styles.recentPath}>{r.path}</span>
                  </button>
                  <ProjectRowMenu
                    path={r.path}
                    onOpen={() => void openProject(r.path)}
                    onDelete={() => forgetRecent(r.path)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  // A window opened for a project file (double-clicked in Finder) opens it. Main hands the path
  // out once, so StrictMode's second run gets null.
  useEffect(() => {
    void window.api
      .takeLaunchProject?.()
      .then((path) => {
        if (path) void useGraph.getState().openProject(path)
      })
      .catch(() => undefined)
  }, [])
  const mode = useUiTheme((s) => s.mode)
  // Read here so a change re-renders the app (portals pick it up through cssVars on their next render).
  const accent = useUiTheme((s) => s.accent)
  const customAccent = useUiTheme((s) => s.customAccent)
  const view = useAppView((s) => s.view)
  const uiStyle = useAppSettings((s) => s.uiStyle)
  const [settingsOpen, setSettingsOpen] = useState(false)
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
    <div
      style={{ ...styles.root, ...cssVars(PALETTES[mode], { id: accent, custom: customAccent }) }}
    >
      {/* "Working…" while the main thread is stuck on heavy work, so a pause doesn't read as a hang. */}
      <FreezeNotice />
      <header className="oe-nav" style={styles.header}>
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
            {/* The layout, switchable from the nav as well as Settings. */}
            <LayoutToggle />
          </>
        )}
        <div style={styles.navSpacer} />
        {/* The gene selector, centred in the space between the left group (ending at the
            folder / workflow selector) and the Run button: equal spacers on either side. */}
        {projectOpen && (
          <>
            <NavGeneSelector />
            <div style={styles.navSpacer} />
          </>
        )}
        {/* Workflow action: run/re-run, split from the general buttons. */}
        {projectOpen && <RunButton />}
        {projectOpen && <FolderViewerButton />}
        {projectOpen && <div style={styles.navSep} />}
        <button
          data-open={guideOpen}
          style={styles.navBtn}
          onClick={() => setGuideOpen(true)}
          title="User guide"
          aria-label="User guide"
        >
          <IconGuide />
        </button>
        <button
          data-open={settingsOpen}
          style={{ ...styles.navBtn, position: 'relative' }}
          onClick={() => setSettingsOpen((o) => !o)}
          title={showUpdateDot ? `Settings — v${update.latest} available` : 'Settings'}
          aria-label={showUpdateDot ? 'Settings (update available)' : 'Settings'}
        >
          <IconGear size={15} strokeWidth={1.7} />
          {showUpdateDot && <span style={styles.navDot} />}
        </button>
        {settingsOpen && (
          <SettingsPopover
            onClose={() => setSettingsOpen(false)}
            update={update}
            silenced={silenced}
            onToggleSilence={toggleSilence}
          />
        )}
        {guideOpen && <UserGuide onClose={() => setGuideOpen(false)} />}
      </header>
      {!projectOpen ? (
        <Home update={update} showUpdate={showUpdateDot} onGuide={() => setGuideOpen(true)} />
      ) : uiStyle === 'form' ? (
        // Form mode has no Workflow/Results split — a step and its output are one view, so both
        // entries land on it (a project saved in Results still reopens on something).
        <div style={styles.canvasArea}>
          <FormWorkflow />
        </div>
      ) : (
        <FlowViews view={view} />
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
  // The layout switch's icon: one text line tall, with the side padding for a word cut back.
  // Option = 2×12 padding − 2×4 margin + 14 icon = 30 wide, by 6 padding + 15.6 line ≈ 22 tall.
  layoutIconBox: { display: 'flex', alignItems: 'center', height: '1.2em', margin: '0 -4px' },
  chipDivider: {
    width: 1,
    alignSelf: 'stretch',
    margin: '5px 0',
    background: 'rgba(128,128,128,0.22)'
  },
  chipSegWarn: { color: UI.warn },

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
  rowIconBtn: {
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    cursor: 'pointer',
    padding: '0 7px',
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto'
  },
  pathWarn: { color: UI.warn },
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
    // Fallback only: the recent-projects card takes the overflow unless the window is shorter than the
    // header plus its minimum height.
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    background: UI.bg
  },
  // Two columns: the app on the left, projects on the right. A narrow window wraps the right one
  // below (the page then scrolls as a whole — see `home`).
  homeInner: {
    width: 'min(1040px, 94vw)',
    padding: '64px 0 40px',
    boxSizing: 'border-box',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    columnGap: 56,
    rowGap: 32
  },
  homeLeft: { flex: '0 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column' },
  homeRight: {
    // wide enough for the four project buttons on one line before the columns stack
    flex: '1 1 520px',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column'
  },
  citeCard: { padding: '12px 14px' },
  citeRef: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: UI.text,
    userSelect: 'text',
    overflowWrap: 'anywhere'
  },
  citeNone: { margin: 0, fontSize: 12.5, color: UI.textMuted },
  citeFoot: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 },
  citeCopy: { marginLeft: 'auto', flex: '0 0 auto', background: 'transparent', cursor: 'pointer' },
  citeDoi: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    color: UI.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  // As the app's other links (About → releases): accent, underlined.
  citeDoiLink: { color: UI.accent, textDecoration: 'underline', cursor: 'pointer' },
  // The logo spans the three text rows (title, version, links): their pinned heights sum to 100px
  // (36 + 6 + 22 + 10 + 26), so keep the logo size in step if any of them change.
  homeBrand: { display: 'flex', alignItems: 'center', gap: 20 },
  homeLogo: { width: 100, height: 100, flex: 'none', userSelect: 'none' },
  homeTitle: { fontSize: 30, lineHeight: '36px', fontWeight: 800, margin: 0 },
  homeVersion: {
    color: UI.textMuted,
    fontSize: 16,
    fontWeight: 500,
    marginTop: 6,
    height: 22,
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  homeLinks: { display: 'flex', gap: 8, marginTop: 10 },
  homeLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    lineHeight: '16px',
    fontWeight: 500,
    textDecoration: 'none'
  },
  homeUpdateTag: {
    fontSize: 12,
    fontWeight: 600,
    color: '#fff',
    background: '#3b82f6',
    borderRadius: 999,
    padding: '2px 8px',
    textDecoration: 'none'
  },
  homeSub: { color: UI.textMuted, fontSize: 14, margin: '6px 0 20px' },
  homeActions: { display: 'flex', gap: 8, marginBottom: 12 },
  /** the four project buttons share one line: they shrink together rather than wrap, and a label
   *  that still can't fit (a very narrow window) is cut short rather than broken over two lines */
  homeAction: {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '10px 12px',
    fontSize: 13,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
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
  // Getting started: Tutorial / Documentation / Publication side by side, each its own width
  // (wrapping onto a second line in a narrow column).
  homeGuides: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  homeGuideBtn: {
    flex: '0 0 auto',
    padding: '7px 14px',
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    borderRadius: 7,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5
  },
  homeGuideOff: { opacity: 0.45, cursor: 'not-allowed' },
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
    marginTop: 24,
    marginBottom: 10
  },
  recentEmpty: { color: UI.textMuted, fontSize: 13, padding: '12px 14px' },
  saveError: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    width: 320,
    zIndex: 60,
    cursor: 'pointer',
    background: UI.panel,
    borderRadius: 6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.25)'
  },
  openError: {
    marginTop: 12,
    padding: '8px 12px',
    borderRadius: 6,
    border: `1px solid ${UI.err}`,
    background: 'rgba(225,87,89,0.12)',
    color: UI.text,
    fontSize: 12
  },
  homeCard: {
    flex: 'none',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    // The two axes apart, not the `overflow` shorthand: recentScroll swaps in overflowY, and React
    // can't add / remove a longhand over a shorthand cleanly.
    overflowX: 'hidden',
    overflowY: 'hidden'
  },
  // Sized to its rows, shrinking (and scrolling) only when the window is too short to show them all.
  // Short lists (≤ 2 rows) are already under the 120px floor, so they just keep their natural height.
  recentScroll: { flex: '0 1 auto', minHeight: 120, overflowY: 'auto' },
  recentRow: { display: 'flex', alignItems: 'stretch', gap: 4 },
  recentDivider: { borderTop: `1px solid ${UI.border}` },
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
  // A project row's hamburger (ProjectRowMenu), and its menu — the project menu's look, floated
  // over the page (the recent list scrolls, so it would clip a menu inside it).
  recentMenuBtn: {
    alignSelf: 'center',
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    marginRight: 8,
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: UI.textMuted,
    cursor: 'pointer'
  },
  recentMenuBtnOpen: { background: UI.panelAlt, color: UI.text },
  rowMenu: {
    position: 'fixed',
    width: ROW_MENU_W,
    boxSizing: 'border-box',
    // background and border colour set per theme at render (see ProjectRowMenu)
    border: '1px solid',
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflowY: 'auto',
    padding: 4
  },
  recentName: { fontSize: 14, fontWeight: 600, color: UI.text },
  recentNameLine: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  // A recent project's version tag (ProjectVersionTag): colours set per standing.
  versionTag: {
    fontSize: 10.5,
    fontWeight: 600,
    padding: '0 6px',
    lineHeight: '16px',
    borderRadius: 8,
    border: '1px solid',
    fontVariantNumeric: 'tabular-nums'
  },
  fixWrap: { display: 'inline-flex', alignItems: 'center', gap: 8, flex: '0 1 auto', minWidth: 0 },
  fixNote: {
    fontSize: 11,
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
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
  savingIcon: { display: 'inline-flex', flex: '0 0 auto', color: UI.textMuted },
  saveAsMenu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    minWidth: 180,
    whiteSpace: 'nowrap',
    maxHeight: '80vh',
    overflowY: 'auto',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
    zIndex: 50,
    padding: 4
  },
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
  // Floating, like "+ New step", but a rounded square with a lighter shadow — it navigates away
  // rather than acting on the canvas, so it sits back a little.
  resultsLink: {
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)'
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
  actCount: {
    fontSize: 11,
    fontWeight: 700,
    color: UI.textMuted,
    padding: '0 6px',
    // "5 selected" on one line, never squeezed by the buttons beside it
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  actBtn: {
    whiteSpace: 'nowrap',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 700
  },
  // The theme's error red, so Delete reads in light mode too (a fixed pale pink vanished there).
  actBtnDanger: { color: UI.err, borderColor: `color-mix(in srgb, ${UI.err} 55%, transparent)` },
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
    // Roomy enough for the widest pane — Plots holds a whole tile config panel (group table,
    // highlight blocks, axes), which was cramped in the old 540×380 card.
    width: 760,
    maxWidth: '94vw',
    height: 620,
    maxHeight: '88vh',
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
  // two fields side by side (Export: format, then resolution), wrapping when narrow
  settingsInline: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 24 },
  settingsSubTitle: { fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 10 },
  // Settings › Customisation › Palettes: a role's name (and its (i)) left of its selector.
  // Top-aligned (a builder runs several lines), the label nudged down to a selector's text line.
  paletteRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  paletteRowLabel: {
    fontSize: 12,
    color: UI.textMuted,
    width: 160,
    flex: '0 0 160px',
    paddingTop: 5
  },
  // Settings › Appearance › Accent colour: a swatch per choice, the chosen one ringed in its colour.
  accentRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  accentSwatch: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px 4px 6px',
    borderRadius: 999,
    border: `1px solid ${UI.border}`,
    background: 'transparent',
    color: UI.text,
    cursor: 'pointer',
    outlineOffset: 1
  },
  accentDot: { width: 14, height: 14, borderRadius: '50%', flex: 'none' },
  accentLabel: { fontSize: 12 },
  // Settings › Appearance › Layout: two large side-by-side choices, glyph over name over description.
  layoutTiles: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  layoutTile: {
    flex: '1 1 180px',
    maxWidth: 240,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '18px 14px 14px',
    borderRadius: 10,
    color: UI.text,
    cursor: 'pointer',
    textAlign: 'center'
  },
  layoutTileTitle: { fontSize: 13, fontWeight: 700 },
  layoutTileText: { fontSize: 11, color: UI.textMuted, lineHeight: 1.4 },
  /** the plot-defaults block: its type picker, and the tile config panel under it */
  defaultsHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  defaultsLabel: { flex: '0 0 auto', fontSize: 12, color: UI.textMuted },
  defaultsPick: { flex: 1, minWidth: 0, display: 'flex' },
  defaultsSelect: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '5px 8px',
    fontSize: 12
  },
  defaultsReset: {
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    fontSize: 11,
    textDecoration: 'underline',
    cursor: 'pointer'
  },
  defaultsPanel: {
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    overflow: 'hidden',
    marginTop: 8
  },
  settingsFieldLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    marginBottom: 6
  },
  // Settings › About › Updates: the Check now button and what it found, in a line
  updateActions: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  updateButton: {
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
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
  // The flow layout's page area: the two pages overlap here, each sliding in or out (FlowViews).
  viewStage: { position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' },
  viewPage: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' },
  // Results dashboard fill.
  resultsArea: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    borderTop: `1px solid ${UI.border}`
  },
  canvas: { flex: 1, minWidth: 0, minHeight: 0 },
  // Centred empty-canvas prompt. The wrapper ignores pointer events (so the pane stays clickable);
  // only the button re-enables them.
  // Empty-workflow hint: anchored bottom-centre, just above the "+ New step" button, so its ↓ arrow
  // points down to it.
  stepHint: {
    position: 'absolute',
    bottom: 58,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    textAlign: 'center',
    maxWidth: 300,
    pointerEvents: 'none',
    zIndex: 5
  },
  stepHintArrow: { fontSize: 20, lineHeight: 1, color: UI.accent, fontWeight: 700 },
  // Data-folder hint: in-canvas (like the empty-workflow guide) but anchored top-left so its ↑
  // arrow points up toward the folder selector in the top bar, rather than sitting centred.
  // Box centred on the chip's centre x (left = that x, translateX(-50%)), content centred like the
  // new-step guide, so the ↑ arrow and text sit under the middle of the folder selector.
  folderHint: {
    position: 'absolute',
    top: 14,
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    textAlign: 'center',
    width: 240,
    pointerEvents: 'none',
    zIndex: 5
  },
  folderHintArrow: { fontSize: 20, lineHeight: 1, color: UI.accent, fontWeight: 700 },
  emptyTitle: { fontSize: 15, fontWeight: 700, color: UI.text },
  emptyText: { fontSize: 12, color: UI.textMuted, maxWidth: 260, lineHeight: 1.5 },
  emptyBtn: {
    marginTop: 4,
    pointerEvents: 'auto',
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
