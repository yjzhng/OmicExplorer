/** A canvas frame (see CanvasFrame): a shaded rounded rectangle behind a set of tiles, with its
 *  label along the top. Pressing anywhere on it (its blank space included) selects its tiles — the
 *  frame itself is never selected, it shows as selected when all its tiles are — and dragging it
 *  moves them (Canvas turns its moves into theirs); double-clicking the label renames it. The pencil
 *  at its top right edits which tiles and groups it holds (see frameEdit), and turns into a ✓ to
 *  finish; while another group is edited, a click on this one marks it to join or leave that one.
 *  Its size is the members' box plus padding — computed by the canvas, passed in as data. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { NodeProps, Node } from '@xyflow/react'

import { IconCheck, IconEdit } from '../ui/icons'
import { UI } from '../ui/theme'
import { safeTileName } from './registry'
import { frameTiles } from './frames'
import { useGraph } from './store'
import { useFrameEdit, useFrameEditMark } from './frameEdit'

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
  // While another group is edited, this one is marked by a click to join it whole (or, inside it,
  // to leave it).
  const mark = useFrameEditMark(id)
  const markColor = mark === 'add' ? UI.ok : UI.err
  const [draft, setDraft] = useState<string | null>(null)
  const [nameHovered, setNameHovered] = useState(false)
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
        borderColor: mark ? markColor : selected || editing ? UI.accent : UI.border,
        borderStyle: editing || mark ? 'dashed' : 'solid',
        ...(mark ? { borderWidth: 2.5 } : null),
        cursor: data.edit === 'other' ? 'pointer' : undefined
      }}
    >
      {mark && (
        <span style={{ ...markBadge, background: markColor }}>{mark === 'add' ? '+' : '−'}</span>
      )}
      {data.edit !== 'other' && (
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
        // Double-click the name to rename. (Anywhere on the frame — name or blank space — a click
        // selects it and a drag moves it with everything inside.)
        <span
          title="Double-click to rename"
          onDoubleClick={(e) => {
            e.stopPropagation()
            setDraft(data.label)
            // The span unmounts into the input without a mouseleave, so clear it here.
            setNameHovered(false)
          }}
          onMouseEnter={() => setNameHovered(true)}
          onMouseLeave={() => setNameHovered(false)}
          // Outlined under the pointer, as the rename box's outline, so it reads as editable.
          style={{ ...label, border: `1px solid ${nameHovered ? UI.border : 'transparent'}` }}
        >
          {data.label}
        </span>
      )}
    </div>
  )
}

const frame: CSSProperties = {
  position: 'relative',
  boxSizing: 'border-box',
  borderRadius: 14,
  border: `1.5px solid ${UI.border}`,
  background: `color-mix(in srgb, ${UI.text} 5%, transparent)`,
  padding: '6px 12px'
}
/** A group marked to join (green) or leave (red) the group being edited, at its top right. */
const markBadge: CSSProperties = {
  position: 'absolute',
  top: -12,
  right: -12,
  width: 24,
  height: 24,
  borderRadius: 12,
  color: '#fff',
  fontSize: 18,
  fontWeight: 700,
  lineHeight: '24px',
  textAlign: 'center'
}
/** The pencil / ✓, at the top right of the label strip. */
const editBtn: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 8,
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
  fontSize: 20,
  fontWeight: 700,
  letterSpacing: 0.3,
  color: UI.textMuted,
  cursor: 'text',
  padding: '1px 4px',
  margin: '0 -5px',
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
  margin: '0 -5px',
  outline: 'none',
  width: 180
}
