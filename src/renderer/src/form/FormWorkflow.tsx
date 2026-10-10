/**
 * Form mode's single view: the analysis as a workflow column plus whatever the selected step needs
 * (Settings → Appearance → Layout).
 *
 * There is no Workflow/Results split here. A step and its output are the same thing seen from two
 * sides, and splitting them meant holding the pipeline in your head while looking at a plot. The
 * left column is the workflow — one tile per step, in the user's own order, carrying the step's
 * name, state and Run. The right side is whatever that step is for: its settings, or, for a plot,
 * its siblings and the chart itself.
 *
 * It is a PROJECTION of the same graph, not a second model: tiles read the node list, the settings
 * body is the very `NodeConfigPanel` the canvas shows, plots render through the dashboard's
 * `PanelTile`, and edits go through the same store actions. A tile kind added later appears here
 * with nothing to change.
 *
 * The pipeline is a DAG, not a script, so a step states its inputs explicitly at the top of its
 * settings rather than implying "the one above": a Merge pools several, a Contrast pairs two.
 * Order is the USER's — newest at the bottom, rearranged by dragging a tile — constrained only by
 * the rule that a step never precedes its own input (see graph/sequence).
 */
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import { ReactFlowProvider } from '@xyflow/react'

import {
  ALL_OPS,
  CATEGORIES,
  NODE_SPECS,
  accentOf,
  canConnect,
  categoryOf,
  maxInputsFor,
  plotLabel,
  safeTileName,
  stepTitle
} from '../graph/registry'
import { pendingInputs } from '../graph/runGate'
import { frameTiles, topFullFrames } from '../graph/frames'
import { dropOrder, formTree, type DropSlot, type FormItem } from '../graph/frameOrder'
import { useGraph } from '../graph/store'
import {
  isStep,
  type CanvasFrame,
  type GraphNode,
  type NodeKind,
  type StepNode
} from '../graph/types'
import { DialogDock, hasDetailsWindow } from '../graph/dialogDock'
import { RunControl, StatusDot, useStepStatus } from '../graph/StatusDot'
import { NodeConfigPanel } from '../graph/NodeConfigPanel'
import { TilePicker } from '../graph/TilePicker'
import { Chevron } from '../ui/Chevron'
import { UI } from '../ui/theme'
import { clampWidth, CONFIG_WIDTH, NAV_WIDTH, useAppSettings } from '../ui/useAppSettings'
import { resolveSelection, wiredTo } from './outline'
import { Inputs } from './Inputs'
import { Splitter } from './Splitter'

/** The plot side is loaded on demand. It reaches Plotly, which touches `document` as it loads, so
 *  a static import would drag the chart bundle — and a DOM requirement — into every render of this
 *  view, including the many that never show a plot. */
const PlotPanel = lazy(() => import('./PlotPanel'))

/** The drag payload's MIME type. Checked on every drop target so an unrelated drag (a file, a text
 *  selection) can't be mistaken for a tile being moved. */
const DRAG_TYPE = 'application/x-omicexplorer-step'

export function FormWorkflow(): ReactNode {
  // There is no canvas here, but the config panels are shared with it and their `Select` reads the
  // React Flow transform (to close its overlay on pan/zoom). `useStore` THROWS without a provider,
  // so every panel would crash. The provider is context only — it renders nothing — and away from
  // a canvas the transform simply stays at its identity default.
  return (
    <ReactFlowProvider>
      <FormWorkflowBody />
    </ReactFlowProvider>
  )
}

function FormWorkflowBody(): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const frames = useGraph((s) => s.frames)
  // The user's own order: the node list is creation order, so a new step lands at the bottom, and
  // a drag rewrites it. Groups sit together in it (see frameOrder) and show as blocks.
  const order = useMemo(() => nodes.filter(isStep).map((n) => n.id), [nodes])
  const tree = useMemo(() => formTree(order, frames), [order, frames])
  const byId = useMemo(
    () => new Map(nodes.filter(isStep).map((n) => [n.id, n as StepNode])),
    [nodes]
  )
  const moveItem = useGraph((s) => s.moveItem)
  // Selection drives the column and the right side, and it is the SAME selection the canvas uses,
  // so switching layout keeps you on the step you were working on.
  const selectedId = useGraph((s) => s.selectedId)
  const selectNode = useGraph((s) => s.selectNode)
  const selectTiles = useGraph((s) => s.selectTiles)
  const navWidth = useAppSettings((s) => s.navWidth)
  const updateSettings = useAppSettings((s) => s.update)
  // What's being dragged — a step or a whole group — and the slot it's over.
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<string | null>(null)

  const active = resolveSelection(selectedId, order)
  const activeNode = active ? byId.get(active) : undefined
  // What the active step is wired to, and which way round — chipped on the tiles.
  const related = useMemo(() => wiredTo(active, edges), [active, edges])

  // Several steps can be selected (⌘/Ctrl-click, Shift-click) to group them; a group is selected
  // when all its steps are — the canvas's rule.
  const picked = useMemo(() => order.filter((id) => byId.get(id)?.selected), [order, byId])
  const pickedGroups = topFullFrames(frames, (id) => picked.includes(id))
  const inPickedGroup = new Set(pickedGroups.flatMap((id) => frameTiles(frames, id)))
  const pickCount = pickedGroups.length + picked.filter((id) => !inPickedGroup.has(id)).length
  const anchor = useRef<string | null>(null)
  const onPick = (id: string, e: ReactMouseEvent): void => {
    if (e.shiftKey && anchor.current && order.includes(anchor.current)) {
      const [a, b] = [order.indexOf(anchor.current), order.indexOf(id)].sort((x, y) => x - y)
      selectTiles(order.slice(a, b + 1))
    } else if (e.metaKey || e.ctrlKey) {
      anchor.current = id
      selectTiles(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id])
    } else {
      anchor.current = id
      selectTiles([id])
      selectNode(id)
    }
  }
  const frameNodes = useGraph((s) => s.frameNodes)
  const unframeNodes = useGraph((s) => s.unframeNodes)

  // A drop slot: before a step, at the end of a group, or at the end of the list.
  const slotOf = (key: string): DropSlot =>
    key.startsWith('before:') ? { before: key.slice(7) } : { end: key.slice(4) || null }
  const fits = (key: string): boolean =>
    !!dragging && !!dropOrder(order, edges, frames, dragging, slotOf(key))
  const dragProps = (key: string) => ({
    onDragOver: (ev: DragEvent) => {
      // Only our own drag is a drop candidate; without preventDefault the browser refuses it.
      if (!dragging || !ev.dataTransfer.types.includes(DRAG_TYPE)) return
      ev.preventDefault()
      ev.stopPropagation()
      // Mark only the slots it may take: among its own siblings, and never above its own input.
      setDropAt(fits(key) ? key : null)
    },
    onDrop: (ev: DragEvent) => {
      if (!dragging || !ev.dataTransfer.types.includes(DRAG_TYPE)) return
      ev.preventDefault()
      ev.stopPropagation()
      moveItem(dragging, slotOf(key))
      setDragging(null)
      setDropAt(null)
    }
  })
  const startDrag = (id: string, ev: DragEvent): void => {
    ev.dataTransfer.setData(DRAG_TYPE, id)
    ev.dataTransfer.effectAllowed = 'move'
    setDragging(id)
  }
  const endDrag = (): void => {
    setDragging(null)
    setDropAt(null)
  }
  const isDragged = (id: string): boolean =>
    !!dragging && (dragging === id || frameTiles(frames, dragging).includes(id))

  const render = (items: FormItem[]): ReactNode[] =>
    items.map((it, i) => {
      if (it.kind === 'step') {
        const node = byId.get(it.id)
        if (!node) return null
        const key = `before:${it.id}`
        return (
          <StepTile
            key={it.id}
            node={node}
            selected={active === it.id || (picked.includes(it.id) && !inPickedGroup.has(it.id))}
            relation={related.get(it.id)}
            onSelect={(e) => onPick(it.id, e)}
            // a dragged group dims as a whole (GroupBlock), not step by step
            dragging={dragging === it.id}
            dropTarget={dropAt === key}
            unreachable={!!dragging && !isDragged(it.id) && !fits(key)}
            onDragStart={(ev) => startDrag(it.id, ev)}
            onDragEnd={endDrag}
            drop={dragProps(key)}
          />
        )
      }
      const f = frames.find((x) => x.id === it.frameId)
      if (!f) return null
      return (
        <GroupBlock
          key={`${it.frameId}:${i}`}
          frame={f}
          continued={it.continued}
          count={frameTiles(frames, f.id).length}
          selected={pickedGroups.includes(f.id)}
          dragging={dragging === f.id}
          onSelect={(e) => {
            selectTiles(frameTiles(frames, f.id), e.metaKey || e.ctrlKey)
            anchor.current = null
          }}
          onDragStart={(ev) => startDrag(f.id, ev)}
          onDragEnd={endDrag}
          tail={
            <div
              {...dragProps(`end:${f.id}`)}
              style={{
                ...styles.groupTail,
                borderTopColor: dropAt === `end:${f.id}` ? UI.accent : 'transparent'
              }}
            />
          }
        >
          {render(it.items)}
        </GroupBlock>
      )
    })

  return (
    <div style={styles.root}>
      <div style={{ ...styles.column, width: navWidth }}>
        <div style={styles.heading}>Analysis workflow</div>
        <div className="oe-scroll" style={styles.tiles}>
          {order.length === 0 && <div style={styles.empty}>Nothing here yet — add a step.</div>}
          {render(tree)}
          {/* Dropping below the last tile moves a step to the end — otherwise the bottom slot
              would be the one position a drag can't reach. The add tile IS that target rather than
              a strip above it, which would cost its own height plus a gap either side. */}
          <div
            {...dragProps('end:')}
            style={{
              ...styles.tailDrop,
              opacity: dragging && !fits('end:') ? UNREACHABLE_OPACITY : 1,
              borderTopColor: dropAt === 'end:' ? UI.accent : 'transparent'
            }}
          >
            <AddStepRow />
          </div>
        </div>
        {/* Several steps (or a group) selected: group them, or ungroup — as on the canvas. */}
        {(picked.length > 1 || pickedGroups.length > 0) && (
          <div style={styles.pickBar}>
            <span style={styles.pickCount}>{pickCount} selected</span>
            <button
              style={styles.btn}
              title="Put the selected steps in a group"
              onClick={() => frameNodes(picked)}
            >
              Group
            </button>
            <button
              style={{
                ...styles.btn,
                opacity: frames.some((f) => f.members.some((m) => picked.includes(m))) ? 1 : 0.4
              }}
              disabled={!frames.some((f) => f.members.some((m) => picked.includes(m)))}
              title="Remove the group around the selection (the steps stay)"
              onClick={() => unframeNodes(picked)}
            >
              Ungroup
            </button>
          </div>
        )}
      </div>
      <Splitter
        ariaLabel="Resize the workflow column"
        onDelta={(dx) => updateSettings({ navWidth: clampWidth(navWidth + dx, NAV_WIDTH) })}
      />
      {activeNode ? (
        <StepPanel node={activeNode} />
      ) : (
        <div style={styles.empty}>Select a step.</div>
      )}
    </div>
  )
}

/** A group in the column: a shaded block with a header — fold arrow, name (click to rename), drag
 *  handle — over its steps. Clicking the header selects the group. A piece of a group the wiring
 *  splits (see frameOrder) is marked "continued". */
function GroupBlock({
  frame,
  continued,
  count,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  tail,
  children
}: {
  frame: CanvasFrame
  continued: boolean
  count: number
  selected: boolean
  dragging: boolean
  onSelect: (e: ReactMouseEvent) => void
  onDragStart: (ev: DragEvent) => void
  onDragEnd: () => void
  /** the drop slot at the end of the group */
  tail: ReactNode
  children: ReactNode
}): ReactNode {
  const renameFrame = useGraph((s) => s.renameFrame)
  const setFrameFolded = useGraph((s) => s.setFrameFolded)
  const [draft, setDraft] = useState<string | null>(null)
  const [nameHovered, setNameHovered] = useState(false)
  const commit = (): void => {
    if (draft != null) renameFrame(frame.id, draft)
    setDraft(null)
  }
  const folded = !!frame.folded
  return (
    <div
      style={{
        ...styles.group,
        border: `1px solid ${selected ? UI.accent : 'transparent'}`,
        opacity: dragging ? 0.45 : 1
      }}
    >
      <div style={styles.groupHead} onClick={onSelect}>
        <button
          aria-label={folded ? 'Show the steps' : 'Fold the steps away'}
          title={folded ? 'Show the steps' : 'Fold the steps away'}
          onClick={(e) => {
            e.stopPropagation()
            setFrameFolded(frame.id, !folded)
          }}
          style={styles.fold}
        >
          <Chevron deg={folded ? 0 : 90} />
        </button>
        {draft != null ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(safeTileName(e.target.value))}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') setDraft(null)
            }}
            style={styles.nameInput}
            aria-label="Group name"
          />
        ) : (
          <span
            title="Click to rename"
            // Outlined under the pointer, like a step's name, so it reads as editable. The whole
            // shorthand, not a borderColor longhand over it, which React can leave stuck.
            style={{
              ...styles.groupName,
              border: `1px solid ${nameHovered ? UI.border : 'transparent'}`
            }}
            onMouseEnter={() => setNameHovered(true)}
            onMouseLeave={() => setNameHovered(false)}
            onClick={(e) => {
              e.stopPropagation()
              setDraft(frame.label)
              // The span unmounts into the input without a mouseleave, so clear it here.
              setNameHovered(false)
            }}
          >
            {frame.label}
          </span>
        )}
        {continued && <span style={styles.groupNote}>(continued)</span>}
        {folded && <span style={styles.groupNote}>{count} steps</span>}
        <span style={{ flex: 1 }} />
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={(e) => e.stopPropagation()}
          title="Drag to move the group"
          aria-label="Drag to move the group"
          className="oe-grip"
          style={styles.handle}
        >
          <GripIcon />
        </span>
      </div>
      {!folded && children}
      {!folded && tail}
    </div>
  )
}

/** One step in the workflow column: its category accent, name, state and Run. Everything the old
 *  section header carried, minus the body — settings live on the right now. */
function StepTile({
  node,
  selected,
  relation,
  onSelect,
  dragging,
  dropTarget,
  unreachable,
  onDragStart,
  onDragEnd,
  drop
}: {
  node: StepNode
  selected: boolean
  relation?: 'input' | 'output'
  onSelect: (e: ReactMouseEvent) => void
  dragging: boolean
  dropTarget: boolean
  /** A drag is on, and this step's slot is one it can't take. */
  unreachable: boolean
  onDragStart: (ev: DragEvent) => void
  onDragEnd: () => void
  /** the drop handlers for the slot just above this step */
  drop: { onDragOver: (ev: DragEvent) => void; onDrop: (ev: DragEvent) => void }
}): ReactNode {
  const id = node.id
  const kind = node.data.kind
  const status = node.data.status
  const runNode = useGraph((s) => s.runNode)
  const cancelNode = useGraph((s) => s.cancelNode)
  const renameNode = useGraph((s) => s.renameNode)
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const accent = accentOf(categoryOf(kind))
  const pending = useMemo(() => pendingInputs(id, nodes, edges), [id, nodes, edges])
  const blocked = pending.length > 0

  const [hovered, setHovered] = useState(false)
  const [nameHovered, setNameHovered] = useState(false)
  // Inline rename, same contract as the canvas tile: click the name to edit, Enter or blur
  // commits, Escape cancels, and the field filters to file-name-safe characters as you type.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const commit = (): void => {
    renameNode(id, safeTileName(draft))
    setEditing(false)
  }

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...drop}
      style={{
        ...styles.tile,
        borderLeft: `3px solid ${accent}`,
        opacity: dragging ? 0.45 : unreachable ? UNREACHABLE_OPACITY : 1,
        // The drop indicator is a bar in the gap above, now that the top edge is the outline.
        boxShadow: dropTarget ? `0 -3px 0 0 ${UI.accent}` : 'none',
        // Resting, under the pointer, then the one the right side is showing — hover stays below
        // selected so the pointer never looks like it has chosen. Resting is the page colour, not
        // see-through, so a step in a group isn't greyed by the group's shade behind it.
        background: selected ? UI.panelAlt : hovered ? UI.panel : UI.bg
      }}
    >
      {/* Only the handle is draggable, so selecting the name doesn't start a drag. Its own column,
          centred on the whole tile. */}
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="oe-grip"
        style={styles.handle}
      >
        <GripIcon />
      </span>
      <div style={styles.tileBody}>
        <span style={styles.tileKind}>{CATEGORIES[categoryOf(kind)].label}</span>
        <div style={styles.tileTop}>
          {editing ? (
            <input
              autoFocus
              value={draft}
              placeholder={plotLabel(kind, node.data.config)}
              onChange={(e) => setDraft(safeTileName(e.target.value))}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                else if (e.key === 'Escape') setEditing(false)
              }}
              style={styles.nameInput}
              aria-label="Step name"
            />
          ) : (
            <span
              // Outlined under the pointer, so the name reads as editable before it's clicked.
              // The whole shorthand, not a borderColor longhand over it, which React can leave stuck.
              style={{
                ...styles.tileName,
                border: `1px solid ${nameHovered ? UI.border : 'transparent'}`
              }}
              onMouseEnter={() => setNameHovered(true)}
              onMouseLeave={() => setNameHovered(false)}
              title="Click to rename"
              onClick={(e) => {
                e.stopPropagation()
                setDraft(node.data.name ?? '')
                setEditing(true)
                // The span unmounts into the input without a mouseleave, so clear it here.
                setNameHovered(false)
              }}
            >
              {stepTitle(node)}
            </span>
          )}
          {relation && !selected && <span style={styles.chip}>{relation}</span>}
        </div>
        {node.data.error && <div style={styles.error}>{node.data.error}</div>}
        {!node.data.error && node.data.note && <div style={styles.note}>{node.data.note}</div>}
      </div>
      {/* Run pill and status on the right, centred like the grip. The canvas tile's run pill,
          shown the same way: on hover, or while selected. Blocked with the reason until the inputs
          it reads have results — pressing it early only reproduces the error it was always going
          to give. */}
      <div style={styles.tileSide}>
        {NODE_SPECS[kind].hasRun && (hovered || selected) && (
          <RunControl
            status={status}
            accent={accent}
            onRun={() => void runNode(id)}
            onStop={() => cancelNode(id)}
            gate={blocked ? `Run ${pending.map((p) => stepTitle(p)).join(' and ')} first` : null}
          />
        )}
        <StepStatusDot node={node} />
      </div>
    </div>
  )
}

/** The right side. A plot is its output, so it shows the analysis's plots and the chart; anything
 *  else is its settings, with the wiring as the first thing in the card's body. */
function StepPanel({ node }: { node: StepNode }): ReactNode {
  if (categoryOf(node.data.kind) === 'plotting')
    return (
      <Suspense fallback={<div style={styles.empty}>Loading plot…</div>}>
        <PlotPanel node={node} />
      </Suspense>
    )
  // Keyed by step: the docked window reads its config at mount, so moving to another step of the
  // same kind must remount it rather than carry the last one's unapplied state across.
  if (hasDetailsWindow(node)) return <SettingsWithDetails key={node.id} node={node} />
  return (
    <div className="oe-scroll" style={styles.settings}>
      <NodeConfigPanel id={node.id} embedded inputs={inputsSection(node)} />
    </div>
  )
}

/** What the details column says while its window is closed: where to open it. */
const DETAILS_EMPTY: Partial<Record<NodeKind, string>> = {
  load: 'Configure samples… opens the interactive import here.',
  compare: 'Configure… opens the comparison here.',
  contrast: 'Configure… opens the contrast here.'
}

/** A step with a configuration window (interactive import, Compare, Contrast): its settings in the
 *  middle and a third column on the right, where Configure… opens the window — the modal the canvas
 *  shows, laid out beside the settings instead of over them. */
function SettingsWithDetails({ node }: { node: StepNode }): ReactNode {
  const configWidth = useAppSettings((s) => s.configWidth)
  const updateSettings = useAppSettings((s) => s.update)
  // State, not a ref: the settings column has to re-render once the pane exists for its window to
  // portal into.
  const [dock, setDock] = useState<HTMLElement | null>(null)
  return (
    <DialogDock.Provider value={dock}>
      <div
        className="oe-scroll"
        style={{ ...styles.settings, ...styles.settingsBeside, width: configWidth }}
      >
        <NodeConfigPanel id={node.id} embedded inputs={inputsSection(node)} />
      </div>
      <Splitter
        ariaLabel="Resize the settings column"
        onDelta={(dx) =>
          updateSettings({ configWidth: clampWidth(configWidth + dx, CONFIG_WIDTH) })
        }
      />
      {/* Empty until the window portals in; `.oe-dock:empty` shows data-empty meanwhile. */}
      <div
        ref={setDock}
        className="oe-dock"
        data-empty={DETAILS_EMPTY[node.data.kind] ?? ''}
        style={styles.details}
      />
    </DialogDock.Provider>
  )
}

/** The canvas tile's status dot, so a step reads the same in both layouts. */
function StepStatusDot({ node }: { node: StepNode }): ReactNode {
  return <StatusDot {...useStepStatus(node.id, node.data)} />
}

/** The Inputs row as the settings card's first section, headed like the card's other sections.
 *  None for a source step (a Load): it takes no input, so there is nothing to wire. */
function inputsSection(node: StepNode): { title: string; body: ReactNode } | undefined {
  if (NODE_SPECS[node.data.kind].acceptsFrom.length === 0) return undefined
  return {
    title: maxInputsFor(node.data.kind) > 1 ? 'Inputs' : 'Input',
    body: <Inputs node={node} />
  }
}

/** Add a step: pick what to add, and (for anything but a source) what feeds it. */
function AddStepRow(): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const addPlaceholder = useGraph((s) => s.addPlaceholder)
  const resolvePlaceholder = useGraph((s) => s.resolvePlaceholder)
  const cancelPlaceholder = useGraph((s) => s.cancelPlaceholder)
  const onConnect = useGraph((s) => s.onConnect)
  const onNodesChange = useGraph((s) => s.onNodesChange)
  const steps = nodes.filter(isStep).map((n) => n as StepNode)
  const [hovered, setHovered] = useState(false)
  // The pending placeholder's id while the picker is open; null when it's closed.
  const pending = useRef<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // A placeholder is UI-only until resolved, but it does live in the graph — so if this view goes
  // away mid-pick (switching to Results, or to the canvas), it has to be cleaned up or it lingers
  // as a stray pending tile.
  useEffect(
    () => () => {
      if (pending.current) cancelPlaceholder(pending.current)
    },
    [cancelPlaceholder]
  )

  // Offer a kind when something already present could feed it, or when it needs no input at all.
  const offer = ALL_OPS.filter((k) => k !== 'plotGroup').filter(
    (k) => NODE_SPECS[k].acceptsFrom.length === 0 || steps.some((n) => canConnect(n.data.kind, k))
  )

  const open = (): void => {
    // Sit the new tile below the lowest one, so the canvas layout stays readable too.
    const y = nodes.reduce((m, n) => Math.max(m, n.position.y), 0) + 140
    const id = addPlaceholder(null, offer, { x: 120, y })
    pending.current = id
    setPicking(id)
    requestAnimationFrame(() =>
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    )
  }

  const close = (): void => {
    if (pending.current) cancelPlaceholder(pending.current)
    pending.current = null
    setPicking(null)
  }

  if (!picking)
    return (
      <button
        onClick={open}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ ...styles.addTile, background: hovered ? UI.panelAlt : UI.panelRaised }}
      >
        + Add step
      </button>
    )

  return (
    // The very picker the canvas uses: category first, then the step — and, in the plotting
    // category, several plots at once to form a group. Reused rather than rebuilt, so the two
    // layouts can't drift on what's offered or how it's grouped.
    //
    // It expands INSIDE the tile rather than in a floating menu: anchored to a trigger at the
    // bottom of a scrolling column, a dropdown renders past the fold and scrolling to reach it
    // dismisses it. Inline, the document simply grows.
    <div
      ref={ref}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') close()
      }}
    >
      <TilePicker
        ops={offer}
        header="New step"
        style={styles.picker}
        onCancel={close}
        onPick={(picks) => {
          const id = pending.current
          pending.current = null
          setPicking(null)
          if (!id) return
          // The resolved step keeps the placeholder's id, so it can be wired straight afterwards.
          resolvePlaceholder(id, picks)
          // The form shows the step it just added (the canvas leaves a new tile closed).
          useGraph.getState().selectNode(id)
          const kind = useGraph.getState().nodes.find((n) => n.id === id)?.data.kind
          if (!kind) return
          // Wire it to the last step that can feed it, so the common linear case needs no second
          // choice; anything else is re-pointed in the new section's own Inputs row.
          const from = [...steps].reverse().find((n) => canConnect(n.data.kind, kind as NodeKind))
          if (from)
            onConnect({ source: from.id, target: id, sourceHandle: null, targetHandle: null })
          // Lay it out for the canvas too: one column right of the step feeding it (or the first
          // column for a step with no input), at the first free spot from that step's height down.
          // Stacking every step in one column zig-zagged the canvas's left-to-right edges.
          const all = useGraph.getState().nodes
          const position = flowSpot(all, id, from?.position)
          onNodesChange([{ type: 'position', id, position }])
        }}
      />
    </div>
  )
}

/** Canvas geometry for steps added from the form: a tile's width plus the gap to the next column,
 *  a tile's assumed height before it's measured, and the gap kept between stacked tiles. */
const COL_STEP = 270
const FIRST_COL_X = 120
const TILE_H = 120
const ROW_GAP = 30
const GROUP_ROW_H = 30

/** Where a step added in the form sits on the canvas: the column right of its input's (`from`), or
 *  the first column, at `from`'s height — or lower, below whatever already occupies that column. */
function flowSpot(
  nodes: GraphNode[],
  id: string,
  from: { x: number; y: number } | undefined
): { x: number; y: number } {
  const x = from ? from.x + COL_STEP : FIRST_COL_X
  let y = from?.y ?? 0
  const inColumn = nodes.filter((n) => n.id !== id && Math.abs(n.position.x - x) < COL_STEP - 20)
  // A tile's height as last drawn on the canvas; one never drawn there (made in the form) is
  // estimated — a plot group grows a row per plot.
  const height = (n: GraphNode): number => {
    if (n.measured?.height) return n.measured.height
    const kids =
      isStep(n) && n.data.kind === 'plotGroup'
        ? ((n.data.config as { children?: unknown[] }).children?.length ?? 0)
        : 0
    return TILE_H + kids * GROUP_ROW_H
  }
  const bottom = (n: GraphNode): number => n.position.y + height(n)
  // Step down past any tile the new one would overlap, until it fits.
  for (let moved = true; moved;) {
    moved = false
    for (const n of inColumn)
      if (y < bottom(n) + ROW_GAP && y + TILE_H + ROW_GAP > n.position.y) {
        y = bottom(n) + ROW_GAP
        moved = true
      }
  }
  return { x, y }
}

/** How far a slot a drag can't reach is faded — well below the dragged tile's own 0.45, so the
 *  two never read as the same state. */
/** The drag grip: two columns of three dots — the usual "drag me" mark. */
function GripIcon(): ReactNode {
  return (
    <svg width="7" height="11" viewBox="0 0 7 11" aria-hidden>
      {[1.5, 5.5, 9.5].flatMap((y) =>
        [1.5, 5.5].map((x) => (
          <circle key={`${x},${y}`} cx={x} cy={y} r="1.1" fill="currentColor" />
        ))
      )}
    </svg>
  )
}

const UNREACHABLE_OPACITY = 0.3

const styles: Record<string, CSSProperties> = {
  // Its host (App's canvasArea) is a flex row, so fill it by flex rather than by block width —
  // without `flex: 1` the view shrinks to its content and the plot never gets the spare width.
  root: { display: 'flex', flex: 1, minWidth: 0, height: '100%', minHeight: 0 },
  column: {
    flex: '0 0 auto',
    // See SideNav: the set width has to include the padding, or the splitter drifts from it.
    boxSizing: 'border-box',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '10px 8px'
  },
  heading: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: UI.textMuted,
    padding: '2px 8px 8px'
  },
  tiles: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  // The grip on the left (centred top to bottom), the step's rows beside it.
  tile: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    // A faint outline on three sides; the left is the category accent, set inline. Each side is its
    // own shorthand: an all-round `border` holding var() leaves its longhands pending substitution,
    // and an accent layered over that doesn't take. The padding is the old box less the outline, so
    // the content sits where it did.
    borderTop: `1px solid ${UI.border}`,
    borderRight: `1px solid ${UI.border}`,
    borderBottom: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '6px 7px 6px 4px',
    cursor: 'pointer'
  },
  tileBody: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  tileTop: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  // Sized to its text (shrinking to ellipsis), so the input/output chip sits right after it.
  tileName: {
    flex: '0 1 auto',
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    color: UI.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'text',
    // The rename input's box (a 1px border, set inline, + this padding), so the text doesn't move
    // when the outline shows or when it turns into the input.
    borderRadius: 4,
    padding: '1px 5px'
  },
  // Run pill + status dot, right of the category and name. The min height is the pill's, so the
  // tile doesn't grow when hover brings it in.
  tileSide: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 21, flex: '0 0 auto' },
  // Indented past the drag handle (its width + the row gap) and the name's border + padding, so it
  // lines up with the name's text.
  tileKind: { fontSize: 10, color: UI.textMuted, paddingLeft: 6 },
  // The grip icon in a small box, tinted on hover (app.css).
  handle: {
    width: 12,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    cursor: 'grab',
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  nameInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: 600,
    color: UI.text,
    background: UI.panel,
    border: `1px solid ${UI.accent}`,
    borderRadius: 4,
    padding: '1px 5px'
  },
  chip: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 8,
    border: `1px solid ${UI.border}`,
    color: UI.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    flex: '0 0 auto'
  },
  btn: {
    padding: '3px 9px',
    borderRadius: 5,
    border: `1px solid ${UI.border}`,
    background: UI.panel,
    color: UI.text,
    fontSize: 11,
    cursor: 'pointer',
    flex: '0 0 auto'
  },
  error: { fontSize: 11, color: '#e15759' },
  note: { fontSize: 11, color: UI.warn },
  // A group: a shaded block holding its steps (and groups) under a header; nesting indents.
  group: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '4px 6px 2px 8px',
    borderRadius: 6,
    background: `color-mix(in srgb, ${UI.text} 5%, transparent)`
  },
  groupHead: { display: 'flex', alignItems: 'center', gap: 4, minHeight: 22, cursor: 'pointer' },
  fold: {
    width: 18,
    height: 18,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    flex: '0 0 auto'
  },
  groupName: {
    flex: '0 1 auto',
    minWidth: 0,
    fontSize: 12,
    fontWeight: 700,
    color: UI.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    cursor: 'text',
    padding: '1px 5px',
    borderRadius: 4
  },
  groupNote: { fontSize: 11, color: UI.textMuted, whiteSpace: 'nowrap', flex: '0 0 auto' },
  // The drop slot at a group's end: thin, its top border the drop indicator.
  groupTail: { height: 4, borderTop: '2px solid transparent', marginTop: -6 },
  pickBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 4px 0',
    borderTop: `1px solid ${UI.border}`,
    marginTop: 6
  },
  pickCount: { flex: 1, fontSize: 11, fontWeight: 700, color: UI.textMuted, whiteSpace: 'nowrap' },
  // Border only — no height of its own, so the add tile keeps the same gap as the tiles above.
  tailDrop: { borderTop: '2px solid transparent', paddingTop: 2 },
  addTile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '12px 10px',
    border: `1px dashed ${UI.border}`,
    borderRadius: 6,
    color: UI.textMuted,
    fontSize: 12,
    cursor: 'pointer'
  },
  picker: { width: '100%', maxWidth: 'none' },
  settings: { flex: 1, minWidth: 0, overflow: 'auto', padding: 12 },
  // Beside a details column: a set width instead of the spare space, which goes to the window.
  // border-box so the width includes the padding, as the splitter assumes.
  settingsBeside: { flex: '0 0 auto', boxSizing: 'border-box' },
  // Padded like the settings column, so the docked window sits in it as the same kind of card.
  details: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
    padding: 12
  },
  plot: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 12
  },
  facets: { display: 'flex' },
  plotBody: { flex: 1, minHeight: 0 },
  empty: { padding: 24, color: UI.textMuted, fontSize: 13 }
}
