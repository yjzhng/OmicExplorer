/** A canvas frame (see CanvasFrame): a shaded rounded rectangle behind a set of tiles, with its
 *  label along the top. Pressing anywhere on it (its blank space included) selects its tiles — the
 *  frame itself is never selected, it shows as selected when all its tiles are — and dragging it
 *  moves them (Canvas turns its moves into theirs); clicking the name renames it, as a tile's. Run
 *  and the pencil sit just after the name, under the pointer; the pencil edits which tiles and
 *  groups it holds (see frameEdit), and turns into a ✓ to finish. While edited it reads as such (an
 *  accent wash, a dashed outline, "editing" by its name); while another group is edited, this one
 *  shows as selected (green, with a tick) when it's in that one, and a click takes it in or out
 *  whole.
 *  Its size is the members' box plus padding — computed by the canvas, passed in as data. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { NodeProps, Node } from '@xyflow/react'

import { IconCheck, IconClose, IconEdit } from '../../ui/controls/icons'
import { UI } from '../../ui/app/theme'
import { runsIn, safeTileName } from '../registry'
import { frameTiles } from './frames'
import { RunControl } from './StatusDot'
import { useGraph } from '../store'
import { isStep, type PlotGroupConfig, type StepStatus } from '../types'
import { useFrameEdit, useFrameEditHolds } from './frameEdit'

export interface FrameData extends Record<string, unknown> {
  label: string
  width: number
  height: number
  /** this frame's tiles being edited, another frame's, or none */
  edit: 'idle' | 'editing' | 'other'
}

/** Space between the frame's edge and the tiles inside, and the label strip above them. */
export const FRAME_PAD = 24
export const FRAME_LABEL_H = 38

export function FrameNode({ id, data, selected }: NodeProps<Node<FrameData>>): ReactNode {
  const renameFrame = useGraph((s) => s.renameFrame)
  const selectTiles = useGraph((s) => s.selectTiles)
  const selectNode = useGraph((s) => s.selectNode)
  const editing = data.edit === 'editing'
  // While another group is edited: whether this one is in it (it shows as selected), a click taking
  // it in or out whole.
  const holds = useFrameEditHolds(id)
  const inEdited = data.edit === 'other' && !!holds
  // The group's run state, from its tiles': running while any runs, failed while any failed, done
  // when all are (each a tile's own, a plot group's from its plots).
  const runState = useGraph((s): StepStatus | null => {
    const tiles = frameTiles(s.frames, id)
    const st = tiles.flatMap((t) => {
      const n = s.nodes.find((x) => x.id === t)
      if (!n || !isStep(n) || !runsIn(s, t)) return []
      if (n.data.kind === 'plotGroup')
        return (n.data.config as PlotGroupConfig).children.map((c) => c.status ?? 'idle')
      return [n.data.status]
    })
    if (!st.length) return null
    if (st.includes('running')) return 'running'
    if (st.includes('error')) return 'error'
    return st.every((x) => x === 'done') ? 'done' : 'idle'
  })
  const runTargets = useGraph((s) => s.runTargets)
  const stopTargets = useGraph((s) => s.stopTargets)
  const [draft, setDraft] = useState<string | null>(null)
  const [nameHovered, setNameHovered] = useState(false)
  // its Run and edit buttons show only under the pointer (and the ✓ while its tiles are edited)
  const [hovered, setHovered] = useState(false)
  const commit = (): void => {
    if (draft != null) renameFrame(id, draft)
    setDraft(null)
  }
  return (
    <div
      // On press, not click: the tiles are selected before a drag starts, so the drag carries them.
      // A group already selected keeps the whole selection, so pressing one of several selected
      // groups drags them all; a click that doesn't drag then narrows it to this group.
      onPointerDown={(e) => {
        if (e.button !== 0 || draft != null || data.edit !== 'idle') return
        const { frames, nodes } = useGraph.getState()
        const tiles = frameTiles(frames, id)
        const on = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
        if (!tiles.every((t) => on.has(t))) selectTiles(tiles, e.metaKey || e.ctrlKey)
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(e) => {
        if (draft != null) return
        if (data.edit === 'idle') {
          // (a drag's release never lands here: the drag swallows its click)
          if (!e.metaKey && !e.ctrlKey) selectTiles(frameTiles(useGraph.getState().frames, id))
          return
        }
        if (data.edit !== 'other') return
        e.stopPropagation()
        useFrameEdit.getState().toggle(id)
      }}
      style={{
        ...frame,
        width: data.width,
        height: data.height,
        // (running keeps its border: the accent border is a selected group's — the run shows as
        // the strip along its top)
        // (in the group being edited: green, with a tick, as a tile in it)
        borderColor: inEdited
          ? UI.ok
          : editing || (data.edit === 'idle' && selected)
            ? UI.accent
            : UI.border,
        borderStyle: editing ? 'dashed' : 'solid',
        ...(inEdited ? { borderWidth: 2 } : null),
        ...(editing
          ? {
              borderWidth: 2,
              background: `color-mix(in srgb, ${UI.accent} 9%, transparent)`
            }
          : null),
        cursor: data.edit === 'other' ? 'pointer' : undefined
      }}
    >
      {inEdited && (
        <span aria-hidden style={inBadge}>
          <IconCheck size={16} />
        </span>
      )}
      {/* running: a segment sweeping along its top edge, as a running tile's strip */}
      {runState === 'running' && (
        <div aria-hidden title="Running…" style={runStrip}>
          <div
            className="oe-strip-sweep"
            style={{ width: '30%', height: '100%', background: UI.accent }}
          />
        </div>
      )}
      {/* The label row: the name, then (under the pointer) Run and the pencil — the ✓ and
          "editing" while it's edited. */}
      <div style={headRow}>
        {draft != null ? (
          <input
            className="nodrag"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(safeTileName(e.target.value))}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') setDraft(null)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            style={labelInput}
          />
        ) : (
          // Click the name to rename, as a tile's: a dashed outline under the pointer says so. (A
          // drag from it still moves the group: a drag swallows its click.) While another group is
          // edited, the click is the frame's — taking this group in or out.
          <span
            title={data.edit === 'other' ? undefined : 'Click to rename'}
            onClick={(e) => {
              if (data.edit === 'other') return
              e.stopPropagation()
              setDraft(data.label)
              // The span unmounts into the input without a mouseleave, so clear it here.
              setNameHovered(false)
            }}
            onMouseEnter={() => setNameHovered(true)}
            onMouseLeave={() => setNameHovered(false)}
            style={{
              ...label,
              cursor: data.edit === 'other' ? 'pointer' : 'text',
              border: `1px dashed ${nameHovered && data.edit !== 'other' ? UI.accent : 'transparent'}`
            }}
          >
            {data.label}
          </span>
        )}
        {editing && <span style={editingTag}>editing</span>}
        {/* Run the group: its tiles as the target (and any step above them they need) */}
        {data.edit === 'idle' && hovered && runState && (
          <span className="nodrag" style={runSlot} onPointerDown={(e) => e.stopPropagation()}>
            <RunControl
              status={runState}
              accent={UI.accent}
              onRun={() => void runTargets(frameTiles(useGraph.getState().frames, id))}
              onStop={() => stopTargets(frameTiles(useGraph.getState().frames, id))}
            />
          </span>
        )}
        {(editing || (data.edit === 'idle' && hovered)) && (
          <button
            className="nodrag"
            title={
              editing
                ? 'Done editing the group'
                : 'Add tiles or groups to the group, or take them out'
            }
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (editing) return useFrameEdit.getState().finish()
              // Clicks now mark tiles and groups, so nothing stays selected or open meanwhile.
              selectTiles([])
              selectNode(null)
              useFrameEdit.getState().start(id)
            }}
            style={{
              ...editBtn,
              color: editing ? UI.accentText : UI.textMuted,
              background: editing ? UI.accent : 'transparent',
              borderColor: editing ? UI.accent : 'transparent'
            }}
          >
            {editing ? <IconCheck size={20} /> : <IconEdit size={20} />}
          </button>
        )}
        {/* beside the ✓: leave the group as it was (as Esc, or the bar's Cancel) */}
        {editing && (
          <button
            className="nodrag"
            title="Cancel: leave the group as it was (Esc)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              useFrameEdit.getState().cancel()
            }}
            style={{
              ...editBtn,
              // a solid chip (the panel's fill, a full outline), so it holds against the edited
              // group's wash beside the ✓
              color: UI.text,
              background: UI.panel,
              borderColor: UI.textMuted
            }}
          >
            <IconClose size={18} />
          </button>
        )}
      </div>
    </div>
  )
}

/** A tile or group in the group being edited: a green tick at its top right (its outline green). */
const inBadge: CSSProperties = {
  position: 'absolute',
  top: -12,
  right: -12,
  width: 24,
  height: 24,
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  background: UI.ok,
  pointerEvents: 'none',
  zIndex: 3
}
const frame: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  borderRadius: 14,
  border: `1.5px solid ${UI.border}`,
  background: `color-mix(in srgb, ${UI.text} 5%, transparent)`,
  padding: '6px 12px'
}
/** "editing", after the name of the group being edited. */
const editingTag: CSSProperties = {
  flex: 'none',
  marginLeft: 4,
  padding: '2px 8px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  color: UI.accentText,
  background: UI.accent
}
/** A running group's strip: over its top border, inside the rounded corners. */
const runStrip: CSSProperties = {
  position: 'absolute',
  top: -2,
  left: 14,
  right: 14,
  height: 3,
  borderRadius: 2,
  overflow: 'hidden',
  pointerEvents: 'none'
}
/** The label row: the name (cut short with an ellipsis when the group is narrow), then the
 *  "editing" tag, Run and the pencil / ✓ just after it. */
const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  height: 30
}
/** The group's Run chip, after its name. */
const runSlot: CSSProperties = {
  flex: 'none',
  height: 30,
  display: 'flex',
  alignItems: 'center'
}
/** The pencil / ✓ (and the ✕ beside it while edited), after Run. */
const editBtn: CSSProperties = {
  flex: 'none',
  width: 30,
  height: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: '1px solid',
  borderRadius: 6,
  cursor: 'pointer'
}
const label: CSSProperties = {
  display: 'inline-block',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: 0.3,
  color: UI.textMuted,
  cursor: 'text',
  padding: '1px 4px',
  // pulled left only, so the text lines up with the frame's edge; the right keeps the row's gaps
  // even (the outline's padding matching the pencil's inset)
  margin: '0 0 0 -5px',
  borderRadius: 4
}
const labelInput: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: 0.3,
  color: UI.text,
  background: UI.panel,
  border: `1px solid ${UI.accent}`,
  borderRadius: 4,
  padding: '1px 4px',
  margin: '0 0 0 -5px',
  outline: 'none',
  width: 180,
  flex: 'none'
}
