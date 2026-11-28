import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  type FinalConnectionState,
  MiniMap,
  type NodeChange,
  type OnConnectStartParams,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  type Node,
  type Viewport
} from '@xyflow/react'
import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { setBackgroundPaused } from '../dashboard/renderQueue'
import { ResultsView } from '../dashboard/ResultsView'
import { useFrameEdit } from '../graph/frameEdit'
import { FRAME_LABEL_H, FRAME_PAD, type FrameData } from '../graph/FrameNode'
import {
  editMembers,
  frameLayers,
  frameTiles,
  outermostFrame,
  topFullFrames
} from '../graph/frames'
import { edgeTypes } from '../graph/GraphEdge'
import { nodeTypes } from '../graph/GraphNode'
import { accentOf, ALL_OPS, canConnect, categoryOf, wiredKindOf } from '../graph/registry'
import { SELECTED_Z } from '../graph/state/canvas'
import { useGraph } from '../graph/store'
import { clipCorner, parseClip, type TileClip } from '../graph/tileClipboard'
import {
  type GraphNode,
  isStep,
  type NodeData,
  type PlotGroupConfig,
  type StepNode
} from '../graph/types'
import { DOT_GRID, EASE, MOTION_MS, NOTICE_MS, PALETTES, UI } from '../ui/theme'
import { useAppView, type AppView } from '../ui/useAppView'
import { setCanvasNav } from '../ui/tutorial/canvasNav'
import { useUiTheme } from '../ui/useUiTheme'
import {
  ACT_DONE,
  CONNECTION_LINE,
  countText,
  lastViewports,
  MOD,
  viewportKey
} from './canvasModel'
import { ResultsLink } from './NavBar'
import { styles } from './styles'

/** Room kept round what the tutorial brings into view (canvasNav's reveal), in screen pixels. */
const REVEAL_MARGIN = 48

/** Bottom-center "New step" button; toggles placement mode (becomes "Cancel" while placing). */
export function NewStep({
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
        data-tour="new-step"
        style={{ ...styles.newStepBtn, ...(placing ? styles.newStepBtnActive : {}) }}
        onClick={onToggle}
      >
        {placing ? 'Cancel' : '+ New step'}
      </button>
    </Panel>
  )
}
/** How long the Workflow ⇄ Results slide takes, and its easing (quick out, gentle settle). */
export const VIEW_SLIDE = `${MOTION_MS.page}ms ${EASE.enter}`
/** The flow layout's two pages, side by side — Workflow on the left, Results on the right — with
 *  a switch between them sliding the whole page across. Both ways of switching (the canvas's
 *  "Results →", the dashboard's "← Workflow") set the same view, so both slide.
 *
 *  The canvas exists while on show (and for the length of a slide). Results, once opened, stays
 *  mounted behind the canvas, hidden (`display:none`, as a dashboard tab not on view): rebuilding
 *  every tile on each return held the UI thread for seconds, and going back and forth is the
 *  common way to check a step. Its charts stay in memory meanwhile; its tiles brought up to date
 *  by a run wait (the reveal queue's background lane, held) until it's back on show. */
export function FlowViews({ view }: { view: AppView }) {
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
  // Results is kept once opened (see above); not mounted before then.
  const [resultsKept, setResultsKept] = useState(view === 'results')
  if (view === 'results' && !resultsKept) setResultsKept(true)
  // Its tiles' background rebuilds wait while it's hidden.
  useEffect(() => setBackgroundPaused(slide.to !== 'results'), [slide.to])
  const settle = (): void => setSlide((s) => (s.from ? { to: s.to, from: null, run: false } : s))
  // Settle even if transitionend never comes (a tab hidden mid-slide).
  useEffect(() => {
    if (!slide.run) return
    const t = window.setTimeout(settle, MOTION_MS.page * 1.5)
    return () => window.clearTimeout(t)
  }, [slide.run])
  // Settled (or swapped with no slide): the cues waiting on it — the tile you came back to, the
  // tab chip you jumped to — play now, on a page at rest.
  useEffect(() => {
    if (!slide.from) useAppView.getState().pageSettled()
  }, [slide.from])

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
        // kept but not on show (Results behind the canvas)
        ...(p === slide.to || p === slide.from ? null : { display: 'none' }),
        transform: offset(p),
        transition: slide.run ? `transform ${VIEW_SLIDE}` : 'none',
        // Its own compositor layer while sliding, so the move doesn't repaint the page each frame.
        willChange: slide.from ? 'transform' : undefined
      }}
      // The incoming page finishing its glide ends the slide.
      onTransitionEnd={(e) => {
        if (p === slide.to && e.target === e.currentTarget) settle()
      }}
      // The outgoing page: inert, not aria-hidden — the button that started the slide still holds
      // focus, and aria-hidden over a focused element is blocked; inert also drops that focus.
      inert={p !== slide.to}
      // kept but not on show: its plots wait to be drawn until it is (PlotlyChart)
      data-offscreen={p === slide.to || p === slide.from ? undefined : true}
    >
      {p === 'canvas' ? canvasPage : resultsPage}
    </div>
  )
  return (
    <div style={styles.viewStage}>
      {/* Fixed order, so a page keeps its element (and its state) as the other comes and goes. */}
      {(['canvas', 'results'] as const)
        .filter((p) => p === slide.to || p === slide.from || (p === 'results' && resultsKept))
        .map(page)}
    </div>
  )
}
/** Dashed ghost tile that follows the cursor while placing a new step. */
export function PlacementGhost({ x, y }: { x: number; y: number }) {
  return <div style={{ ...styles.ghost, left: x, top: y }}>+ New step</div>
}
/** Bottom-right direction pad — four house-shaped wedges (a 24×24 square fused to a
 *  right-angled 45-45-90 triangle roof, whose hypotenuse is the square's side) whose
 *  pointy ends meet at the centre; pans the canvas for users without scroll input.
 *  Rounded corners come from the fill+round-join trick (clip-path can't round corners). */
export function PanControls({ onPan }: { onPan: (dx: number, dy: number) => void }) {
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
export function SelectionActions({
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
  onCopy,
  onDelete,
  running,
  onRun,
  onStop,
  done
}: {
  count: number
  /** any selected tile running: Run turns to Stop */
  running: boolean
  onRun: () => void
  onStop: () => void
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
  onCopy: () => void
  onDelete: () => void
  /** the action just done: its button shows the tick (held by the canvas, so a selection that
   *  changes with it — Duplicate's — keeps it) */
  done: string | null
}) {
  const btn = (label: string, enabled: boolean, fn: () => void, title: string, danger = false) => {
    const ticked = done === label
    return (
      <button
        disabled={!enabled && !ticked}
        title={title}
        onClick={fn}
        style={{
          ...styles.actBtn,
          ...(danger ? styles.actBtnDanger : {}),
          ...(ticked ? styles.actBtnDone : {}),
          opacity: enabled || ticked ? 1 : 0.4,
          cursor: enabled ? 'pointer' : 'not-allowed'
        }}
      >
        {ticked ? `✓ ${ACT_DONE[label] ?? label}` : label}
      </button>
    )
  }
  return (
    <Panel position="bottom-center">
      <div style={styles.actBar}>
        <span style={styles.actCount}>{count} selected</span>
        {running
          ? btn('Stop', true, onStop, 'Stop running the selection')
          : btn(
              'Run',
              true,
              onRun,
              'Run the selection — and any step above it that it needs and hasn’t run'
            )}
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
        {btn(
          'Copy',
          true,
          onCopy,
          'Copy the selection (⌘C) — paste it with ⌘V into any workflow, window or project'
        )}
        {btn('Delete', true, onDelete, 'Delete the selection', true)}
      </div>
    </Panel>
  )
}
/** In the selection bar's place while a group's tiles are edited (its frame's pencil): what to
 *  click, how many went in or out, and Cancel / Done (Done = the frame's ✓). */
export function EditGroupBar({
  label,
  adding,
  removing
}: {
  label: string
  adding: number
  removing: number
}) {
  const marked = [adding && `${adding} added`, removing && `${removing} taken out`].filter(Boolean)
  return (
    <Panel position="bottom-center">
      <div style={styles.actBar}>
        <span style={styles.actCount}>
          Editing {label}: click tiles or groups to select or deselect them
          {marked.length ? ` · ${marked.join(', ')}` : ''}
        </span>
        <button
          title="Leave the group as it was (Esc)"
          onClick={() => useFrameEdit.getState().cancel()}
          style={{ ...styles.actBtn, cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          title="Apply the changes to the group"
          onClick={() => useFrameEdit.getState().finish()}
          style={{ ...styles.actBtn, cursor: 'pointer' }}
        >
          Done
        </button>
      </div>
    </Panel>
  )
}
export function Canvas() {
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
  // The tutorial moves the view while its dimming covers the canvas (ui/tutorial/canvasNav).
  useEffect(() => {
    setCanvasNav({
      setView: (v) => void setViewport(v),
      zoom: () => getViewport().zoom,
      reveal: (b, pane) => {
        const v = getViewport()
        const z = Math.max(v.zoom, 1)
        const k = z / v.zoom
        // the box at the new zoom, its centre kept where it is on screen, then moved just enough
        // to be inside the pane (centred, if it's bigger than the pane)
        const w = b.w * k
        const h = b.h * k
        const into = (start: number, size: number, room: number): number =>
          size + 2 * REVEAL_MARGIN > room
            ? (room - size) / 2
            : Math.min(Math.max(start, REVEAL_MARGIN), room - REVEAL_MARGIN - size)
        const left = into(b.x + b.w / 2 - pane.x - w / 2, w, pane.w)
        const top = into(b.y + b.h / 2 - pane.y - h / 2, h, pane.h)
        // the box's top-left in flow coordinates stays the same point
        const fx = (b.x - pane.x - v.x) / v.zoom
        const fy = (b.y - pane.y - v.y) / v.zoom
        void setViewport(
          { x: left - fx * z, y: top - fy * z, zoom: z },
          { duration: MOTION_MS.page }
        )
      },
      panBy: (dx, dy) => {
        const v = getViewport()
        void setViewport({ x: v.x - dx, y: v.y - dy, zoom: v.zoom })
      }
    })
    return () => setCanvasNav(null)
  }, [getViewport, setViewport])
  // Frames React Flow's drag-select is touching, while one is under way (null otherwise). Frames
  // aren't selected themselves (see onNodesChange) — at the drag's end each stands for its tiles.
  const marqueeFrames = useRef<Set<string> | null>(null)
  // The same, as state, so the groups being touched light up live during the drag.
  const [touchedFrames, setTouchedFrames] = useState<string[] | null>(null)
  // Canvas frames (Group): each drawn as a node behind its tiles, sized to their box. Derived from
  // the LOCAL tile positions, so a frame follows its tiles live during a drag.
  const storeFrames = useGraph((s) => s.frames)
  // A group being edited (its frame's pencil) is drawn with its marked tiles already added / taken
  // out, so its box shows what ✓ will make of it — unless that would leave it empty (and its ✓ gone).
  const frameEdit = useFrameEdit((s) => s.edit)
  const frames = useMemo(() => {
    if (!frameEdit) return storeFrames
    const next = editMembers(storeFrames, frameEdit.id, frameEdit.add, frameEdit.remove)
    return next.some((f) => f.id === frameEdit.id) ? next : storeFrames
  }, [storeFrames, frameEdit])
  // the groups' stacking: a later group (a duplicate) over an earlier one, frame then tiles
  const layers = useMemo(() => frameLayers(frames), [frames])
  const unframeNodes = useGraph((s) => s.unframeNodes)
  const selectTiles = useGraph((s) => s.selectTiles)
  const frameNodes = useMemo((): Node<FrameData>[] => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const fById = new Map(frames.map((f) => [f.id, f]))
    const { frameZ } = layers
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
          data: {
            label: f.label,
            width,
            height,
            edit: !frameEdit ? 'idle' : frameEdit.id === f.id ? 'editing' : 'other'
          },
          width,
          height,
          // Its size as measured, too: a node rebuilt without `measured` loses its handle bounds
          // until React Flow measures it again — and until then counts as inside every
          // drag-select, so each frame (rebuilt as the selection changes) was "touched" by all.
          measured: { width, height },
          // its group's layer (frameLayers): under its own tiles, a nested frame above its holder
          zIndex: frameZ.get(f.id),
          selected: shownSel.has(f.id),
          deletable: false
        }
      ]
    })
  }, [frames, nodes, touchedFrames, frameEdit, layers])
  // Editing stops when its group goes (undo, another workflow), and on Esc, dropping the marks.
  useEffect(() => {
    if (frameEdit && !storeFrames.some((f) => f.id === frameEdit.id))
      useFrameEdit.getState().cancel()
  }, [frameEdit, storeFrames])
  useEffect(() => {
    if (!frameEdit) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') useFrameEdit.getState().cancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [frameEdit])
  // A grouped tile in its group's layer (the open tile's float stays above everything)
  const shown = useMemo(
    () => [
      ...(frameNodes as unknown as GraphNode[]),
      ...nodes.map((n) => {
        const base = layers.tileZ.get(n.id)
        if (base == null || n.zIndex === SELECTED_Z) return n
        return { ...n, zIndex: base + (n.zIndex ?? 0) }
      })
    ],
    [frameNodes, nodes, layers]
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
  // A link in the layer of the higher of its two tiles: over its group's frame, under its tiles
  const shownEdges = useMemo(() => {
    if (!layers.tileZ.size) return edges
    const z = (id: string): number => layers.tileZ.get(id) ?? 0
    return edges.map((e) => {
      const at = Math.max(z(e.source), z(e.target))
      return at === 0 && e.zIndex == null ? e : { ...e, zIndex: at }
    })
  }, [edges, layers])
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
  const runTargets = useGraph((s) => s.runTargets)
  const stopTargets = useGraph((s) => s.stopTargets)
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
  const selRunning = selStep.some(
    (n) =>
      n.data.status === 'running' ||
      (n.data.kind === 'plotGroup' &&
        (n.data.config as PlotGroupConfig).children.some((c) => c.status === 'running'))
  )
  const canGroup = selStep.length > 0
  const canUngroup = frames.some((f) => f.members.some((m) => selectedIds.includes(m)))
  // Fold / unfold the selected plot groups' plot lists (see GroupBody); each offered when it'd change one.
  const selGroups = selStep.filter((n) => n.data.kind === 'plotGroup')
  const isFolded = (n: StepNode): boolean => !!(n.data.config as PlotGroupConfig).collapsed
  const canCollapse = selGroups.some((n) => !isFolded(n))
  const canExpand = selGroups.some(isFolded)
  const clearSelection = useCallback(() => setSelectedIds([]), [])

  // Copy / paste tiles (⌘C / ⌘V, Edit › Copy / Paste): through the system clipboard as text, so a
  // copy pastes into any workflow, window or project. Left to the page while text is being typed
  // or selected. A paste back into the workflow it came from lands beside the originals, stepping
  // on with each paste of the same copy; elsewhere it lands in the middle of the view.
  const pasteCount = useRef<{ text: string; n: number }>({ text: '', n: 0 })
  // The selection-bar action just done: its button ticks for a moment (⌘C ticks Copy too).
  const [done, setDone] = useState<{ label: string; key: number } | null>(null)
  const tick = useCallback((label: string) => {
    setDone((d) => ({ label, key: (d?.key ?? 0) + 1 }))
  }, [])
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setDone(null), NOTICE_MS.done)
    return () => window.clearTimeout(t)
  }, [done])
  const copySelection = useCallback((): string | null => {
    const clip = useGraph.getState().copyTiles(selectedIds)
    if (!clip) return null
    tick('Copy')
    return JSON.stringify(clip)
  }, [selectedIds, tick])
  const pasteClip = useCallback(
    (text: string, clip: TileClip, point?: { x: number; y: number }) => {
      const g = useGraph.getState()
      let at: { x: number; y: number }
      if (point) at = point
      else if (g.copiedHere(clip)) {
        const k = pasteCount.current.text === text ? pasteCount.current.n + 1 : 1
        pasteCount.current = { text, n: k }
        const c = clipCorner(clip)
        at = { x: c.x + 40 * k, y: c.y + 40 * k }
      } else {
        const box = canvasRef.current?.getBoundingClientRect()
        const mid = box
          ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
          : { x: 0, y: 0 }
        const c = clipCorner(clip)
        const w = Math.max(...clip.nodes.map((n) => n.position.x)) - c.x
        const h = Math.max(...clip.nodes.map((n) => n.position.y)) - c.y
        at = { x: mid.x - w / 2 - 80, y: mid.y - h / 2 - 40 }
      }
      // The pasted tiles show up selected; a Load tile's input that couldn't be copied over
      // shows when it runs (its file not found).
      void g.pasteTiles(clip, at).then(({ errors }) => {
        if (errors.length) console.warn('Pasted Load tile inputs not copied:', errors)
      })
    },
    [screenToFlowPosition]
  )
  // The canvas's right-click menu: Paste (at the pointer), once the clipboard is read — greyed when
  // it holds no copy of tiles.
  const [paneMenu, setPaneMenu] = useState<{
    x: number
    y: number
    at: { x: number; y: number }
    clip?: { text: string; clip: TileClip } | null
  } | null>(null)
  const openPaneMenu = useCallback(
    (e: ReactMouseEvent | MouseEvent) => {
      e.preventDefault()
      const at = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setPaneMenu({ x: e.clientX, y: e.clientY, at })
      const read =
        typeof window.api.readText === 'function'
          ? window.api.readText()
          : navigator.clipboard.readText()
      void read.then(
        (text) => {
          const clip = parseClip(text)
          setPaneMenu((m) => (m ? { ...m, clip: clip ? { text, clip } : null } : m))
        },
        () => setPaneMenu((m) => (m ? { ...m, clip: null } : m))
      )
    },
    [screenToFlowPosition]
  )
  useEffect(() => {
    if (!paneMenu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPaneMenu(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [paneMenu])
  useEffect(() => {
    const typing = (): boolean => {
      const el = document.activeElement as HTMLElement | null
      return (
        !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName ?? ''))
      )
    }
    const onCopy = (e: ClipboardEvent): void => {
      if (typing() || !!window.getSelection()?.toString()) return
      const text = copySelection()
      if (!text || !e.clipboardData) return
      e.clipboardData.setData('text/plain', text)
      e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent): void => {
      if (typing()) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const clip = parseClip(text)
      if (!clip) return
      e.preventDefault()
      pasteClip(text, clip)
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [copySelection, pasteClip])

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
  const onMoveEnd = useCallback((_e: unknown, viewport: Viewport) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShowMini(false), 900)
    lastViewports.set(viewportKey(), viewport)
  }, [])
  // (Not read as the canvas unmounts: React Flow resets its store first, so that read gave the
  // origin at 1×, and every return landed there.)

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
        edges={shownEdges}
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
          // A group being edited: the tiles take their own clicks (marking them), and nothing else
          // selects or opens.
          if (frameEdit) return
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
        onPaneContextMenu={openPaneMenu}
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
          // has no downstream side effects, so setting nodes directly is safe. React Flow's last
          // change (dragging: false) is still queued when this runs, and the store write replaces
          // it — so the flag is cleared here: a tile left `dragging` is taken into every
          // drag-select, wherever it is.
          useGraph.setState({
            nodes: nodesRef.current.map((n) => (n.dragging ? { ...n, dragging: false } : n)),
            dirty: true
          })
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
        // (not while a group is edited: tiles are marked by clicking them)
        selectionOnDrag={!frameEdit}
        selectionMode={SelectionMode.Partial}
        selectionKeyCode={null}
        zoomOnScroll={false}
        zoomOnPinch
        // Room to zoom out over a large workflow (React Flow's default stops at 0.5).
        minZoom={0.1}
        // Back from Results (or to a workflow already seen this session): the view it was left at.
        // Else frame existing nodes when a saved workflow is opened (Canvas mounts per project
        // open), but do NOT auto-fit an empty canvas — the bare `fitView` prop defers and fires on
        // the first dropped tile, recentring it instead of leaving it where it was placed. maxZoom
        // caps a single small node from blowing up to the default 2×.
        onInit={(instance) => {
          const key = viewportKey()
          const last = lastViewports.get(key)
          if (last) void instance.setViewport(last)
          else if (useGraph.getState().nodes.length > 0)
            // the fitted view is the one to come back to until the user moves it
            void instance
              .fitView({ maxZoom: 1, padding: 0.2 })
              .then(() => lastViewports.set(key, instance.getViewport()))
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={DOT_GRID.gap}
          size={DOT_GRID.size}
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
        {!needsFolder && selectedIds.length === 0 && !frameEdit && (
          <NewStep placing={placing} onToggle={togglePlacing} />
        )}
        {frameEdit && (
          <EditGroupBar
            label={storeFrames.find((f) => f.id === frameEdit.id)?.label ?? 'group'}
            adding={frameEdit.add.length}
            removing={frameEdit.remove.length}
          />
        )}
        {selectedIds.length > 0 && !frameEdit && (
          <SelectionActions
            count={selCount}
            canGroup={canGroup}
            canUngroup={canUngroup}
            onGroup={() => {
              frameNodesAction(selectedIds)
              tick('Group')
            }}
            onUngroup={() => {
              unframeNodes(selectedIds)
              tick('Ungroup')
            }}
            onTidy={() => {
              tidyNodes(selectedIds)
              tick('Tidy')
            }}
            onCascade={() => {
              cascadeNodes(selectedIds)
              tick('Cascade')
            }}
            canExpand={canExpand}
            canCollapse={canCollapse}
            onExpand={() => {
              setGroupsCollapsed(selectedIds, false)
              tick('Expand')
            }}
            onCollapse={() => {
              setGroupsCollapsed(selectedIds, true)
              tick('Collapse')
            }}
            // Copies land on top and become the selection (via node.selected), so the
            // action bar follows them — no clearSelection here.
            onDuplicate={() => {
              duplicateNodes(selectedIds)
              tick('Duplicate')
            }}
            onCopy={() => {
              const text = copySelection()
              if (text) void window.api.copyText(text)
            }}
            onDelete={() => {
              // A selected group's tiles go with it (and so the group); Ungroup keeps them.
              selectedIds.forEach((id) => deleteNode(id))
              clearSelection()
            }}
            running={selRunning}
            onRun={() => void runTargets(selectedIds)}
            onStop={() => stopTargets(selectedIds)}
            done={done?.label ?? null}
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
      {paneMenu && (
        <>
          <div
            style={styles.scrim}
            onClick={() => setPaneMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setPaneMenu(null)
            }}
          />
          <div
            role="menu"
            style={{
              ...styles.paneMenu,
              left: Math.min(paneMenu.x, window.innerWidth - 200),
              top: Math.min(paneMenu.y, window.innerHeight - 60)
            }}
          >
            <button
              role="menuitem"
              disabled={!paneMenu.clip}
              title={
                paneMenu.clip === undefined
                  ? 'Reading the clipboard…'
                  : paneMenu.clip
                    ? 'Paste the copied tiles here'
                    : 'Nothing to paste: select tiles and Copy them first'
              }
              style={{
                ...styles.menuAction,
                display: 'flex',
                justifyContent: 'space-between',
                ...(paneMenu.clip ? null : { opacity: 0.45, cursor: 'not-allowed' })
              }}
              onClick={() => {
                const c = paneMenu.clip
                setPaneMenu(null)
                if (c) pasteClip(c.text, c.clip, paneMenu.at)
              }}
            >
              Paste
              <span style={styles.menuKey}>
                {paneMenu.clip
                  ? countText(paneMenu.clip.clip.nodes.length, paneMenu.clip.clip.frames.length)
                  : `${MOD}V`}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
