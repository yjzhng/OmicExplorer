import {
  Handle,
  Position,
  useReactFlow,
  useStore,
  useStoreApi,
  type Node,
  type NodeProps
} from '@xyflow/react'
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { PANEL_WIDTH } from '../nodes/kit/settings/layout'
import { rowView } from '../engine'
import { muted } from '../nodes/kit/tile'
import { TILES } from '../nodes/tiles'
import { Chevron } from '../ui/Chevron'
import { IconJump } from '../ui/icons'
import { StatusNote } from '../ui/StatusNote'
import { UI } from '../ui/theme'
import { useAppView } from '../ui/useAppView'
import { useFrameEdit, useFrameEditMark } from './frameEdit'
import { FrameNode } from './FrameNode'
import { inFullFrame } from './frames'
import { deriveTabs } from './groups'
import { AddPlotMenu, NodeConfigPanel, TILE_STRIP } from './NodeConfigPanel'
import {
  accentOf,
  CATEGORIES,
  categoryOf,
  hasSourceHandle,
  loadAbove,
  NODE_SPECS,
  nothingToRerun,
  plotComputes,
  plotLabel,
  runsIn,
  safeTileName
} from './registry'
import { unmetRequirement } from './requirements'
import {
  LoadRunControl,
  plotStatusInfo,
  RunControl,
  StatusDot,
  usePlotGate,
  useStepStatus,
  useUpstreamRunning
} from './StatusDot'
import { useGraph } from './store'
import { nameChip, nameInput, tileNameText } from './tileNameStyles'
import { TilePicker } from './TilePicker'
import type {
  CompareConfig,
  LoadConfig,
  NodeData,
  NodeKind,
  PlaceholderData,
  PlotGroupConfig
} from './types'
import { isCompareConfigured, isStep, resolveLoadMode } from './types'
import { usePlotGroupTitle } from './usePlotGroupTitle'
import { useUpstreamFacts } from './useUpstreamFacts'

/** Tile names may only hold letters, digits, space, `.`, `_` and `-`: they lead the file name of
 *  every plot/table downloaded from the tile, so anything else is dropped as it's typed. */

/** A group tile's body: a stack of subcards, one per child plot. Clicking a subcard
 *  opens that child's config (via `selectChildCard`) and highlights it. */
function GroupBody({
  id,
  config,
  accent,
  activeChild,
  foldable
}: {
  id: string
  config: PlotGroupConfig
  accent: string
  /** on the canvas: a toggle folds the subcard stack away (config.collapsed), leaving the tile's
   *  header and a plot count — a big group takes less room. The form always shows the stack. */
  foldable?: boolean
  /** the highlighted subcard; defaults to the store's `selectedSub` (the form view passes the one
   *  it resolved, which falls back to the first plot when nothing is picked yet) */
  activeChild?: string
}) {
  const storeSub = useGraph((s) => s.selectedSub)
  const selectedSub = activeChild ?? storeSub
  const selectChildCard = useGraph((s) => s.selectChildCard)
  const moveGroupChild = useGraph((s) => s.moveGroupChild)
  const addGroupChildren = useGraph((s) => s.addGroupChildren)
  const removeGroupChildren = useGraph((s) => s.removeGroupChildren)
  const setGroupsCollapsed = useGraph((s) => s.setGroupsCollapsed)
  // The group's upstream: gates which plots the add-plot menu offers (kind + response axes).
  const upstreamKind = useGraph((s) => {
    const upId = s.edges.find((e) => e.target === id)?.source
    const up = upId ? s.nodes.find((n) => n.id === upId) : undefined
    return up && isStep(up) ? up.data.kind : undefined
  })
  // What the upstream data carries (stale-aware): gates the menu and flags unsupported subcards.
  const upId = useGraph((s) => s.edges.find((e) => e.target === id)?.source)
  const facts = useUpstreamFacts(upId)
  const upRunning = useUpstreamRunning(upId)
  // id of the subcard being dragged, and the gap it's over (target card + which side).
  const [dragId, setDragId] = useState<string | null>(null)
  // The plot card under the pointer — its own Run chip shows on hover (and while selected / running).
  const [hoverChild, setHoverChild] = useState<string | null>(null)
  const runPlotChild = useGraph((s) => s.runPlotChild)
  const cancelNode = useGraph((s) => s.cancelNode)
  const [gap, setGap] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const reset = (): void => {
    setDragId(null)
    setGap(null)
  }
  const folded = !!foldable && !!config.collapsed
  return (
    <div style={subList}>
      {/* Add / remove plots right on the tile, above the subcard stack. nodrag/nowheel so the
          menu's interactions never move the node or zoom the canvas. */}
      <div
        className="nodrag nowheel"
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex' }}
      >
        <AddPlotMenu
          children={config.children}
          upstreamKind={upstreamKind}
          upstream={facts}
          onAdd={(specs) => addGroupChildren(id, specs)}
          onRemove={(ids) => removeGroupChildren(id, ids)}
        />
      </div>
      {/* Canvas: the fold toggle and the plot count, on a line under the menu. */}
      {foldable && config.children.length > 0 && (
        <div
          className="nodrag"
          onClick={(e) => e.stopPropagation()}
          style={{ ...muted, display: 'flex', alignItems: 'center', gap: 2 }}
        >
          <button
            onClick={() => setGroupsCollapsed([id], !config.collapsed)}
            title={config.collapsed ? 'Show the plots' : 'Fold the plots away'}
            aria-label={config.collapsed ? 'Show the plots' : 'Fold the plots away'}
            aria-expanded={!config.collapsed}
            style={foldBtn}
          >
            <Chevron color="currentColor" size={10} deg={config.collapsed ? 0 : 90} />
          </button>
          {config.children.length} plot{config.children.length === 1 ? '' : 's'}
        </div>
      )}
      {!folded && (
        <>
          {config.children.length === 0 && <div style={muted}>Empty group.</div>}
          {config.children.map((c) => {
            const active = selectedSub === c.id
            const unmet = unmetRequirement(c.kind, c.config, facts)
            // The insertion line renders in the gap above/below the target card so it
            // clearly sits *between* two subcards, marking exactly where the drop lands.
            const lineBefore = gap?.id === c.id && gap.place === 'before'
            const lineAfter = gap?.id === c.id && gap.place === 'after'
            // Why this plot can't run yet (its requirement, or the step it reads hasn't run).
            // (A step still running doesn't block: the plot's run waits for it.)
            const runGate =
              unmet ?? (facts.result || upRunning ? null : 'Run the step it reads from first')
            // A done plot that computes nothing of its own has nothing to re-run (plotComputes).
            const showRun =
              (hoverChild === c.id || active || c.status === 'running' || c.status === 'error') &&
              !(c.status === 'done' && !plotComputes(c.kind))
            return (
              <Fragment key={c.id}>
                {lineBefore && <div style={dropLine} />}
                {/* The card is itself a button, so its Run chip sits over its right end beside it,
                    not inside it. */}
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setHoverChild(c.id)}
                  onMouseLeave={() => setHoverChild((h) => (h === c.id ? null : h))}
                >
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
                    {/* Each plot's own run state (the group's dot rolls these up). */}
                    <StatusDot
                      {...plotStatusInfo(
                        c.status ?? 'idle',
                        c.error,
                        unmet ?? (facts.result ? null : 'Run the step it reads from first')
                      )}
                    />
                    <span style={subLabel}>{plotLabel(c.kind, c.config)}</span>
                  </button>
                  {showRun && (
                    <span style={subRun}>
                      <RunControl
                        status={c.status ?? 'idle'}
                        accent={accent}
                        onRun={() => void runPlotChild(id, c.id)}
                        onStop={() => cancelNode(id)}
                        gate={runGate}
                        gateLabel="Not ready"
                      />
                    </span>
                  )}
                </div>
                {lineAfter && <div style={dropLine} />}
              </Fragment>
            )
          })}
        </>
      )}
    </div>
  )
}

/** One component renders every category; the body varies by the node's operation. */
export function GraphNode({ id, data, selected: rfSelected }: NodeProps<Node<NodeData>>) {
  const spec = NODE_SPECS[data.kind]
  const category = categoryOf(data.kind)
  const accent = accentOf(category)
  const selectedId = useGraph((s) => s.selectedId)
  const runNode = useGraph((s) => s.runNode)
  const cancelNode = useGraph((s) => s.cancelNode)
  // Gate: a Standardize whose upstream is an Interactive Load that hasn't been converted yet is
  // blocked until the user completes the sample setup (which materializes the input files) — as
  // is a Subset filtering that import before Clean data.
  const stdGate = useGraph((s) => {
    if (data.kind !== 'standardize' && data.kind !== 'subset') return null
    const up = loadAbove(s, id)?.load
    if (up) {
      const c = up.data.config as LoadConfig
      if (resolveLoadMode(c) === 'interactive' && !c.data) return 'Configure samples first'
    }
    return null
  })
  const plotGate = usePlotGate(id, data)
  const gate =
    stdGate ??
    plotGate ??
    (data.kind === 'compare' && !isCompareConfigured(data.config as CompareConfig)
      ? 'Configure comparison first'
      : data.kind === 'curveFit' && !isCompareConfigured(data.config as CompareConfig)
        ? 'Configure curve fit first'
        : null)
  // Config float opens for the single store selection; the accent border also lights up
  // for React Flow's own selection so every marquee-selected tile reads as selected — except a
  // tile in a wholly selected group, which reads as part of that group (the frame lights up).
  // During a drag-select any tile in a group does: the drag selects the group, not the tile.
  const configOpen = selectedId === id
  // The config float stays mounted a moment after the tile is deselected, so it can animate out
  // (see .oe-config-in / -out); `leaving` is that moment, ended by its animation.
  const [configMounted, setConfigMounted] = useState(configOpen)
  if (configOpen && !configMounted) setConfigMounted(true)
  const configLeaving = configMounted && !configOpen
  const dragSelecting = useStore((s) => s.userSelectionActive)
  const inSelectedGroup = useGraph(
    (s) =>
      !!rfSelected &&
      (dragSelecting
        ? s.frames.some((f) => f.members.includes(id))
        : inFullFrame(s.frames, id, (t) => !!s.nodes.find((n) => n.id === t)?.selected))
  )
  const selected = configOpen || (!!rfSelected && !inSelectedGroup)
  const [hovered, setHovered] = useState(false)
  const sideColor = selected ? accent : UI.border
  // A plot tile is a Results tab of its own: offered, under the pointer or selected, as a jump
  // straight to that tab (only looked up then, so idle tiles don't derive the tabs).
  const isTab = useGraph(
    (s) =>
      (hovered || selected) &&
      category === 'plotting' &&
      deriveTabs(s.nodes, s.edges).some((t) => t.id === id)
  )

  const statusInfo = useStepStatus(id, data)
  // A done plot tile whose plots compute nothing offers no Re-run (registry.nothingToRerun).
  const noRerun = nothingToRerun(data)
  // its own Run (a Subset off Load data has none — runsIn)
  const runs = useGraph((s) => runsIn(s, id))
  const incomplete = !statusInfo.ok
  // The "+" (and its drag arrow) only while hovering a tile that isn't open — an open tile's
  // settings are showing, and the prompt would compete with them.
  // …and only after the pointer has rested on the tile for a moment, so passing over tiles doesn't
  // flash them.
  const [lingered, setLingered] = useState(false)
  useEffect(() => {
    if (!hovered) return
    const t = setTimeout(() => setLingered(true), PLUS_DELAY_MS)
    return () => {
      clearTimeout(t)
      setLingered(false)
    }
  }, [hovered])
  const showPlus = hovered && lingered && !configOpen
  // Which way the tile's existing outgoing connections run, for the drag hint's curve.
  const outBend = useGraph((s): Bend => {
    const me = s.nodes.find((n) => n.id === id)
    if (!me) return 'none'
    const sx = me.position.x + (me.measured?.width ?? 230)
    const sy = me.position.y + (me.measured?.height ?? 120) / 2
    let flatOrUp = false
    let down = false
    for (const e of s.edges) {
      if (e.source !== id) continue
      const t = s.nodes.find((n) => n.id === e.target)
      if (!t) continue
      const ty = t.position.y + (t.measured?.height ?? 120) / 2
      // Angle above horizontal (screen y runs down), whichever side the target sits on.
      const deg = (Math.atan2(sy - ty, Math.abs(t.position.x - sx) || 1) * 180) / Math.PI
      if (deg >= -FLAT_DEG) flatOrUp = true
      else down = true
    }
    return flatOrUp ? 'down' : down ? 'up' : 'none'
  })

  // Inline rename: double-click the title to edit; Enter/blur commits, Escape cancels.
  const renameNode = useGraph((s) => s.renameNode)
  const [editing, setEditing] = useState(false)
  const [nameHover, setNameHover] = useState(false)
  const [draft, setDraft] = useState('')
  const typeText =
    data.kind === 'plotGroup'
      ? `${spec.label} · ${(data.config as PlotGroupConfig).children.length}`
      : plotLabel(data.kind, data.config) // a Response plot → its condition(s) (Dose response, Dose & Time response)
  // A plot group unnamed: named as its results tab is — after the step it reads from.
  const groupTitle = usePlotGroupTitle(id, data.kind === 'plotGroup')
  const shownName = data.name ?? groupTitle
  const startRename = (): void => {
    setDraft(data.name ?? '')
    setEditing(true)
  }
  const commitRename = (): void => {
    renameNode(id, safeTileName(draft))
    setEditing(false)
  }

  // While a group is edited, a click on the tile marks it to add to / take out of the group (see
  // frameEdit) instead of selecting it or opening its panel.
  const editingGroup = useFrameEdit((s) => !!s.edit)
  const groupMark = useFrameEditMark(id)
  const rf = useReactFlow()
  const flowStore = useStoreApi()
  const cardRef = useRef<HTMLDivElement>(null)
  // Which side the detail panel opens on. Default right of the tile; flip to the left when the
  // panel would run past the canvas's right edge and there's room on the left. Decided ONCE when
  // the panel opens — it stays put while the user pans/zooms, so it never jumps mid-edit.
  const [panelSide, setPanelSide] = useState<'right' | 'left'>('right')
  // The canvas zoom, which places the panel beside the tile (the panel itself is never zoomed). Read
  // only while it's shown, so zooming doesn't re-render every tile.
  const zoom = useStore((s) => (configMounted ? s.transform[2] : 1))
  // Where the panel's middle sits, from the tile's outer top edge in flow units: the canvas's
  // vertical middle at the moment it opens. Fixed from then on, so the panel pans with the canvas
  // like the tile does.
  const [panelMid, setPanelMid] = useState(0)
  useLayoutEffect(() => {
    if (!configOpen) return
    const el = cardRef.current
    if (!el) return
    const card = el.getBoundingClientRect()
    const canvas = el.closest('.react-flow')?.getBoundingClientRect()
    const right = canvas?.right ?? window.innerWidth
    const left = canvas?.left ?? 0
    // The panel is drawn at full size whatever the zoom (see the float below), so its screen width
    // is fixed.
    const need = PANEL_WIDTH + PANEL_GAP
    const fitsRight = card.right + need <= right
    const fitsLeft = card.left - need >= left
    setPanelSide(!fitsRight && fitsLeft ? 'left' : 'right')
    // Centred on the view as it opens (lifted a little, PANEL_LIFT): the canvas's middle, measured from the tile's outer top edge
    // (the card's own top — its strip is its top border) and turned into flow units.
    const z = rf.getViewport().zoom
    const midY = (canvas ? (canvas.top + canvas.bottom) / 2 : window.innerHeight / 2) - PANEL_LIFT
    setPanelMid((midY - card.top) / z)
  }, [configOpen, rf])
  // The panel's height (screen px — it isn't zoomed) and the tile's (flow units), kept current as
  // either changes (a setting that adds a section, a tile that grows), for clamping its place.
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelH, setPanelH] = useState(0)
  const [tileH, setTileH] = useState(0)
  useLayoutEffect(() => {
    if (!configMounted) return
    const panel = panelRef.current
    const el = cardRef.current
    if (!panel || !el) return
    const measure = (): void => {
      setPanelH(panel.offsetHeight)
      setTileH(el.offsetHeight)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(panel)
    ro.observe(el)
    return () => ro.disconnect()
  }, [configMounted])
  // The panel's middle, kept so it spans the tile's whole height: its top never below the tile's
  // top, its bottom never above the tile's bottom. A panel shorter than the tile can't do both, so
  // it top-aligns. In flow units from the tile's outer top edge.
  const half = panelH / 2 / zoom
  const mid = panelH ? Math.min(half, Math.max(Math.min(half, tileH - half), panelMid)) : panelMid
  // The panel sits ABOVE the canvas, not in it: drawn into the React Flow container (outside its
  // zoomed viewport), so no zoom ever scales its text — text through a scale and its undo landed
  // off the pixel grid, and blurred, whenever the canvas was zoomed out. Placed in screen px beside
  // the tile, on whole device pixels, and placed again as the view pans / zooms or the tile moves.
  const container = useStore((s) => (configMounted ? s.domNode : null))
  const viewport = useStore((s) => (configMounted ? s.transform.join(',') : ''))
  const tileAt = useStore((s) => {
    if (!configMounted) return ''
    const p = s.nodeLookup.get(id)?.internals.positionAbsolute
    return p ? `${p.x},${p.y}` : ''
  })
  const [panelAt, setPanelAt] = useState<{ top: number; left?: number; right?: number } | null>(
    null
  )
  useLayoutEffect(() => {
    const el = cardRef.current
    if (!configMounted || !el || !container) return
    const card = el.getBoundingClientRect()
    const box = container.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const px = (v: number): number => Math.round(v * dpr) / dpr
    // centred on `mid` (flow units from the tile's outer top), its height from layout — not its own
    // box, which the open animation moves and scales
    const top = px(card.top + mid * zoom - (panelRef.current?.offsetHeight ?? 0) / 2 - box.top)
    setPanelAt(
      panelSide === 'left'
        ? { top, right: px(box.right - card.left + PANEL_GAP) }
        : { top, left: px(card.right - box.left + PANEL_GAP) }
    )
  }, [configMounted, container, viewport, tileAt, mid, zoom, panelH, tileH, panelSide])
  // Scrolling over a tile pans (React Flow's pan-on-scroll, same as empty canvas) and zoom is
  // pinch / ctrl+scroll — except inside the detail window (`.nowheel`), which React Flow ignores
  // entirely so its content can scroll natively. A pinch there (a trackpad pinch arrives as a
  // wheel event with ctrlKey) would otherwise be lost, so it's handled here and drives the
  // viewport directly.
  useEffect(() => {
    // the card, and the panel (drawn outside it, above the canvas) while it's shown
    const els = [cardRef.current, configMounted ? panelRef.current : null].filter(
      (x): x is HTMLDivElement => !!x
    )
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey || !(e.target as HTMLElement).closest?.('.nowheel')) return
      e.preventDefault()
      e.stopPropagation()
      const { x, y, zoom } = rf.getViewport()
      // Pinch deltas are small, so (like d3-zoom) they get a 10× rate. Held to the canvas's own
      // zoom range.
      const { minZoom, maxZoom } = flowStore.getState()
      const nextZoom = Math.min(maxZoom, Math.max(minZoom, zoom * Math.pow(1.0015, -e.deltaY * 10)))
      if (nextZoom === zoom) return
      // Keep the flow point under the cursor fixed: new translate = old + p·(zoom − nextZoom).
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      rf.setViewport({
        x: x + p.x * (zoom - nextZoom),
        y: y + p.y * (zoom - nextZoom),
        zoom: nextZoom
      })
    }
    for (const el of els) el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      for (const el of els) el.removeEventListener('wheel', onWheel)
    }
  }, [rf, flowStore, configMounted])

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Capture: ahead of the tile's own controls (its name, a group's subcards), and of the
      // canvas's click, which never sees it.
      onClickCapture={
        editingGroup
          ? (e) => {
              // (not a click in the detail panel, a React child drawn outside the card)
              if (!e.currentTarget.contains(e.target as HTMLElement)) return
              e.stopPropagation()
              e.preventDefault()
              useFrameEdit.getState().toggle(id)
            }
          : undefined
      }
      style={{
        ...card,
        position: 'relative',
        cursor: editingGroup ? 'pointer' : undefined,
        // Set each side explicitly (never the `borderColor` shorthand): React's style
        // diffing writes the shorthand into the DOM and clobbers borderTopColor without
        // rewriting it, which made the accent top strip vanish on deselect.
        borderTopColor: incomplete ? `${accent}4d` : accent,
        borderRightColor: sideColor,
        borderBottomColor: sideColor,
        borderLeftColor: sideColor,
        // Incomplete (not run, out of date, waiting on its input, errored): a dashed outline and a
        // faded accent strip — the body keeps its normal fill — so it reads apart from a finished
        // tile at a glance rather than only by its status dot. Each side's style is its own
        // longhand, set in BOTH states: dropping it on completion would leave no border at all.
        borderRightStyle: incomplete ? 'dashed' : 'solid',
        borderBottomStyle: incomplete ? 'dashed' : 'solid',
        borderLeftStyle: incomplete ? 'dashed' : 'solid',
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 3px 14px rgba(0,0,0,0.4)` : card.boxShadow
      }}
    >
      {groupMark && (
        <div style={{ ...markRing, borderColor: groupMark === 'add' ? UI.ok : UI.err }}>
          <span style={{ ...markBadge, background: groupMark === 'add' ? UI.ok : UI.err }}>
            {groupMark === 'add' ? '+' : '−'}
          </span>
        </div>
      )}
      {/* the accent strip fills with the run as it goes (faded before, full colour when done) */}
      <ProgressStrip
        id={id}
        accent={accent}
        running={data.status === 'running'}
        complete={!incomplete}
      />
      {spec.input.accepts.length > 0 && (
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
              placeholder={groupTitle ?? typeText}
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
              // The whole border shorthand, not a borderColor longhand over nameChip's, which React
              // can leave stuck.
              style={{
                ...tileNameText,
                ...nameChip,
                border: `1px dashed ${nameHover ? accent : 'transparent'}`
              }}
              onMouseEnter={() => setNameHover(true)}
              onMouseLeave={() => setNameHover(false)}
              onClick={(e) => {
                e.stopPropagation()
                startRename()
              }}
              title="Click to rename"
            >
              {shownName ?? typeText}
            </span>
          )}
          {/* Type label as a subtitle whenever there's a name. Not added while naming an unnamed
              tile: the field's placeholder already shows the type. */}
          {shownName && !editing && (
            <span style={typeSub}>
              {data.kind === 'plotGroup' ? typeText : plotLabel(data.kind, data.config)}
            </span>
          )}
        </span>
        <div style={headerRight}>
          {isTab && (
            <button
              className="nodrag"
              title="Open this plot's tab in Results"
              aria-label="Open in Results"
              onClick={(e) => {
                e.stopPropagation()
                const view = useAppView.getState()
                view.setResultsTab(id)
                view.setView('results')
              }}
              style={{ ...resultsJump, color: accent, borderColor: accent }}
            >
              <IconJump size={11} />
            </button>
          )}
          {data.kind === 'load' && (hovered || selected) && (
            <LoadRunControl id={id} config={data.config as LoadConfig} accent={accent} />
          )}
          {runs && (hovered || selected) && !noRerun && (
            <RunControl
              status={data.status}
              accent={accent}
              onRun={() => void runNode(id)}
              onStop={() => cancelNode(id)}
              gate={gate}
              gateLabel={plotGate && gate === plotGate ? 'Not ready' : undefined}
            />
          )}
          <StatusDot {...statusInfo} />
        </div>
      </div>
      <TileBody
        id={id}
        data={data}
        accent={accent}
        foldable
        hint={hovered && !configOpen ? 'Click to configure' : undefined}
      />
      {hasSourceHandle(data.kind) && (
        // Hovering the tile turns its output handle into a "+": drag from it onto the canvas to add
        // the next step (see App's onConnectEnd).
        <Handle
          type="source"
          position={Position.Right}
          title={showPlus ? 'Drag to add the next step' : undefined}
          style={
            showPlus
              ? { ...handleStyle, ...handlePlus, border: `2px solid ${accent}`, background: accent }
              : handleStyle
          }
        >
          {showPlus && (
            // Drawn, not typed: a text "+" sits on the font's baseline, off the circle's centre.
            <svg width={10} height={10} viewBox="0 0 10 10" style={plusGlyph}>
              <path d="M5 1v8M1 5h8" stroke="#fff" strokeWidth={2} strokeLinecap="round" />
            </svg>
          )}
        </Handle>
      )}
      {hasSourceHandle(data.kind) && showPlus && (
        // A small arrow travelling out from the "+" along a path, on a loop: drag this way to add a
        // step. The path steers clear of the tile's existing outputs — an S bending down when one
        // already runs flat or up, up when they all run down (see outBend), straight when none.
        <svg
          width={HINT_W}
          height={HINT_H}
          viewBox={`0 0 ${HINT_W} ${HINT_H}`}
          // the colour of a not-yet-complete connection (GraphEdge), as this one would be
          style={{ ...dragHint, marginTop: -HINT_PATHS[outBend].y0, color: '#7c7c8c' }}
          aria-hidden
        >
          {REDUCED_MOTION ? (
            // No motion: the arrow simply rests at the end of its path.
            <>
              <path d={HINT_PATHS[outBend].line} {...hintStroke} />
              <g transform={`translate(${HINT_PATHS[outBend].end})`}>
                <path d={HINT_HEAD} {...hintStroke} />
              </g>
            </>
          ) : (
            <g opacity={0}>
              {/* The tail: a stretch of the path itself running behind the head (a dash moving
                  along it), so it bends with the curve rather than trailing straight. */}
              <path
                d={HINT_PATHS[outBend].line}
                pathLength={1}
                strokeDasharray={`${HINT_TAIL} 2`}
                {...hintStroke}
              >
                <animate
                  attributeName="stroke-dashoffset"
                  from={HINT_TAIL}
                  to={HINT_TAIL - 1}
                  {...hintTiming}
                />
              </path>
              <path d={HINT_HEAD} {...hintStroke}>
                {/* Turned with the curve: the head points along the path wherever it is. */}
                <animateMotion path={HINT_PATHS[outBend].line} rotate="auto" {...hintTiming} />
              </path>
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.15;0.75;1"
                dur={HINT_DUR}
                repeatCount="indefinite"
              />
            </g>
          )}
        </svg>
      )}
      {configMounted &&
        container &&
        createPortal(
          // Above the canvas (see panelAt), hidden until first placed. Two layers: the outer one is
          // placed; the inner one slides in from (and out toward) the tile's side, fading — its own
          // transform, so the two don't fight.
          // Clicks inside stop here: React bubbles them through the portal to the node's
          // onNodeClick, which calls selectNode → clears selectedSub — that reset the active
          // subcard to the first on every interaction with a group's config.
          <div
            style={{
              ...configFloat,
              ...(panelAt ?? { top: 0, left: 0, visibility: 'hidden' })
            }}
          >
            <div
              ref={panelRef}
              className={`nodrag nowheel ${configLeaving ? 'oe-config-out' : 'oe-config-in'}`}
              style={{
                ['--oe-config-from' as string]: panelSide === 'left' ? '10px' : '-10px',
                // Scaled about its middle on the tile's side, so it stays centred throughout.
                transformOrigin: panelSide === 'left' ? 'center right' : 'center left',
                ...(configLeaving ? { pointerEvents: 'none' } : null)
              }}
              onClick={(e) => e.stopPropagation()}
              onAnimationEnd={(e) => {
                if (e.target === e.currentTarget && configLeaving) setConfigMounted(false)
              }}
            >
              <NodeConfigPanel id={id} />
            </div>
          </div>,
          container
        )}
    </div>
  )
}

/** A tile's body: a group's add-plots menu and subcard stack, or any other step's summary, plus
 *  its error. Exported for the form workflow, whose plot step shows this same tile body. */
export function TileBody({
  id,
  data,
  accent,
  activeChild,
  foldable,
  hint
}: {
  id: string
  data: NodeData
  accent: string
  /** see GroupBody */
  activeChild?: string
  /** see GroupBody */
  foldable?: boolean
  /** shown in place of the step's description (the canvas's hover prompt); a group keeps its
   *  plot list */
  hint?: string
}) {
  const result = useGraph((s) => s.results[id])
  return (
    <div style={body}>
      {data.kind === 'plotGroup' ? (
        <GroupBody
          id={id}
          config={data.config as PlotGroupConfig}
          accent={accent}
          activeChild={activeChild}
          foldable={foldable}
        />
      ) : (
        // The hint overlays the description rather than replacing it, so the tile keeps its
        // height and nothing around it shifts on hover.
        <div style={{ position: 'relative' }}>
          <div style={hint ? { visibility: 'hidden' } : undefined}>
            <NodeSummary kind={data.kind} id={id} result={result} config={data.config} />
          </div>
          {hint && (
            // Over the hidden description (left-aligned, vertically centred), in the blue tip style.
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start'
              }}
            >
              <StatusNote kind="info" inline>
                {hint}
              </StatusNote>
            </div>
          )}
        </div>
      )}
      {data.error && (
        <StatusNote kind="error" style={{ fontSize: 10, marginTop: 4 }}>
          {data.error}
        </StatusNote>
      )}
      {!data.error && data.note && (
        <StatusNote kind="warn" style={{ fontSize: 10, marginTop: 4 }}>
          {data.note}
        </StatusNote>
      )}
    </div>
  )
}

/** A Compare's / Contrast's significant-row count and a Contrast's value-row count, counted once per
 *  result (they're O(rows)) — remembered across the tile's mounts too: returning to the canvas
 *  would otherwise rebuild every large table (engine/lazyRows.ts) just to count it again. */
const countsByResult = new WeakMap<object, { signfCount: number; valueRows: number }>()
function summaryCounts(
  result: ReturnType<typeof useGraph.getState>['results'][string] | undefined
): { signfCount: number; valueRows: number } {
  if (result?.kind !== 'compare' && result?.kind !== 'contrast')
    return { signfCount: 0, valueRows: 0 }
  const hit = countsByResult.get(result)
  if (hit) return hit
  let out: { signfCount: number; valueRows: number }
  // (read off the columns: no row built)
  if (result.kind === 'compare') {
    // (the 2×2s' calls — a two-way ANOVA's term rows would count each gene again per term)
    const v = rowView(result.cmp)
    const term = v.col('term')
    const sig = v.col('signf')
    let signf = 0
    for (let i = 0; i < v.n; i++) if (term(i) == null && sig(i)) signf++
    out = { signfCount: signf, valueRows: 0 }
  } else {
    // the sides' own value only — the other features are further views of the same genes
    const v = rowView(result.ctr)
    const feature = v.col('featureId')
    const sig = v.col('signf')
    let signf = 0
    let value = 0
    for (let i = 0; i < v.n; i++)
      if ((feature(i) ?? 'value') === 'value') {
        value++
        if (sig(i)) signf++
      }
    out = { signfCount: signf, valueRows: value }
  }
  countsByResult.set(result, out)
  return out
}

function NodeSummary({
  kind,
  id,
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
  // (A Contrast's row count likewise: its value rows, counted once.)
  const { signfCount, valueRows } = useMemo(() => summaryCounts(result), [result])
  // a Load tile's files against what was converted / read (the store's checkLoad)
  const check = useGraph((s) => (kind === 'load' ? s.loadChecks[id] : undefined))
  // The kind's own summary (nodes/<kind>/Tile.tsx), else its spec's one-line hint.
  const tile = TILES[kind]
  if (tile) return tile({ kind, id, result, config, check, signfCount, valueRows })
  const hint = NODE_SPECS[kind].plot?.tileHint
  const text = typeof hint === 'function' ? hint(config) : hint
  return <div style={muted}>{text ?? 'Genes × samples. Select to view.'}</div>
}

/** A step tile's face as the canvas draws it — category, name, a finished status and a line of
 *  description — without the canvas around it (no handles, run control or live state). The User
 *  guide draws workflow steps with it. */
export function TileFace({ kind, text }: { kind: NodeKind; text?: string }): ReactNode {
  const category = categoryOf(kind)
  const accent = accentOf(category)
  return (
    <div style={{ ...card, borderTopColor: accent }}>
      <div style={header}>
        <span style={titleWrap}>
          <span style={{ ...catTag, color: accent }}>{CATEGORIES[category].label}</span>
          <span style={{ ...tileNameText, ...nameChip }}>{NODE_SPECS[kind].label}</span>
        </span>
        <div style={headerRight}>
          <StatusDot {...plotStatusInfo('done', undefined, null)} />
        </div>
      </div>
      {text && (
        <div style={body}>
          <div style={muted}>{text}</div>
        </div>
      )}
    </div>
  )
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
  placeholder: PlaceholderNode,
  frame: FrameNode
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
// The drag hint beside the hovered tile's "+": just past the handle, its path starting level with
// it (see HINT_PATHS).
const dragHint: CSSProperties = {
  position: 'absolute',
  left: '100%',
  top: '50%',
  marginLeft: 14,
  overflow: 'visible',
  pointerEvents: 'none'
}
/** How long the pointer rests on a tile before its "+" and drag hint appear. */
const PLUS_DELAY_MS = 1500
/** An existing connection within ±this many degrees of horizontal counts as flat. */
const FLAT_DEG = 10
/** The drag hint's shape: straight, or a sigmoid bending down / up. */
type Bend = 'none' | 'down' | 'up'
const HINT_W = 40
const HINT_H = 30
// Each path starts level with the handle (y0, which the svg is offset by) and leaves and arrives
// horizontally, so a curve is a smooth S; `end` is its last point (for the reduced-motion arrow).
const HINT_PATHS: Record<Bend, { y0: number; line: string; end: string }> = {
  none: { y0: 15, line: 'M2 15H36', end: '36 15' },
  down: { y0: 2, line: 'M2 2C20 2 18 28 36 28', end: '36 28' },
  up: { y0: 28, line: 'M2 28C20 28 18 2 36 2', end: '36 2' }
}
/** The travelling arrowhead, its tip at the origin pointing along +x (animateMotion turns it to
 *  follow the path). */
const HINT_HEAD = 'M-4.5 -4 0 0 -4.5 4'
/** The tail's length, as a share of the path. */
const HINT_TAIL = 0.45
const HINT_DUR = '1.3s'
/** Head and tail move on the same clock and easing, so the tail stays attached to the head. */
const hintTiming = {
  dur: HINT_DUR,
  repeatCount: 'indefinite',
  calcMode: 'spline',
  keyTimes: '0;1',
  keySplines: '0.4 0 0.2 1'
} as const
const REDUCED_MOTION =
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const hintStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}
// The output handle while its tile is hovered: larger, filled, carrying a "+".
const handlePlus: CSSProperties = {
  width: 18,
  height: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
}
const plusGlyph: CSSProperties = { display: 'block', pointerEvents: 'none' }
/**
 * A tile's accent strip as its run's progress. Before a run (or out of date) the strip is faded —
 * the tile's own top border; while it runs a full-colour fill grows across it — the engine's
 * fraction where the run reports one (curve fits), else a segment sweeping along it; done, the
 * border itself is full colour, so nothing is drawn.
 */
function ProgressStrip({
  id,
  accent,
  running,
  complete
}: {
  id: string
  accent: string
  running: boolean
  complete: boolean
}): ReactNode {
  const p = useGraph((s) => (running ? s.progress[id] : undefined))
  if (!running || complete) return null
  const frac = p && p.total > 0 ? Math.min(1, p.done / p.total) : null
  return (
    <div
      aria-hidden
      title={p ? `${p.stage}${frac != null ? ` · ${Math.round(frac * 100)}%` : ''}` : 'Running…'}
      style={{
        position: 'absolute',
        // over the top border (outside the padding box the card positions from)
        top: -TILE_STRIP,
        left: -1,
        right: -1,
        height: TILE_STRIP,
        overflow: 'hidden',
        borderTopLeftRadius: 8,
        borderTopRightRadius: 8,
        pointerEvents: 'none'
      }}
    >
      {frac != null ? (
        <div
          className="oe-strip-fill"
          style={{ width: `${frac * 100}%`, height: '100%', background: accent }}
        />
      ) : (
        <div
          className="oe-strip-sweep"
          style={{ width: '30%', height: '100%', background: accent }}
        />
      )}
    </div>
  )
}

/** A tile marked to add to (green) or take out of (red) the group being edited. */
const markRing: CSSProperties = {
  position: 'absolute',
  inset: -7,
  border: '2px dashed',
  borderRadius: 12,
  pointerEvents: 'none',
  zIndex: 2
}
const markBadge: CSSProperties = {
  position: 'absolute',
  top: -11,
  right: -11,
  width: 20,
  height: 20,
  borderRadius: 10,
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  lineHeight: '20px',
  textAlign: 'center'
}
const card: CSSProperties = {
  width: 230,
  background: UI.panel,
  border: `1px solid ${UI.border}`,
  // The category strip: only its width here. Its colour is set per tile (borderTopColor, inline) —
  // a `borderTop` shorthand would carry a colour of its own, and any update to it reset the strip
  // to that colour without the tile's being reapplied.
  borderTopWidth: TILE_STRIP,
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
/** The jump to a plot tile's Results tab: an icon chip, the run chip's shape. */
const resultsJump: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid',
  background: 'transparent',
  borderRadius: 10,
  padding: '3px 7px',
  cursor: 'pointer'
}
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
// Type subtitle, shown under a user-given name (the intrinsic kind label, e.g. "Compare").
const typeSub: CSSProperties = { fontSize: 10, color: UI.textMuted, fontWeight: 500 }
const body: CSSProperties = { padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }
// The plot group's fold toggle, beside its add-plots menu on the canvas.
const foldBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  width: 20,
  height: 20,
  padding: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: UI.textMuted,
  cursor: 'pointer'
}
const subList: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 5 }
// A plot card's own Run chip, over the card's right end (vertically centred).
const subRun: CSSProperties = {
  position: 'absolute',
  right: 6,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex'
}
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
/** How far above the canvas's middle the detail panel centres as it opens (screen px): a touch
 *  high reads as centred, the eye's middle sitting above the geometric one. */
const PANEL_LIFT = 40
/** Gap between a tile and its detail panel (screen px — the panel isn't zoomed). */
const PANEL_GAP = 14
/** Detail panel float: in the React Flow container, above the canvas — over the tiles (the
 *  renderer's z 4, drawn after it), under React Flow's own panels (z 5). Placed in screen px beside
 *  its tile (see panelAt). */
const configFloat: CSSProperties = {
  position: 'absolute',
  zIndex: 4,
  cursor: 'default'
}
