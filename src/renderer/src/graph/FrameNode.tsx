/** A canvas frame (see CanvasFrame): a shaded rounded rectangle behind a set of tiles, with its
 *  label along the top. Pressing anywhere on it (its blank space included) selects its tiles — the
 *  frame itself is never selected, it shows as selected when all its tiles are — and dragging it
 *  moves them (Canvas turns its moves into theirs); double-clicking the label renames it. Its size
 *  is the members' box plus padding — computed by the canvas, passed in as data. */
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { NodeProps, Node } from '@xyflow/react'

import { UI } from '../ui/theme'
import { safeTileName } from './registry'
import { frameTiles } from './frames'
import { useGraph } from './store'

export interface FrameData extends Record<string, unknown> {
  label: string
  width: number
  height: number
}

/** Space between the frame's edge and the tiles inside, and the label strip above them. */
export const FRAME_PAD = 24
export const FRAME_LABEL_H = 38

export function FrameNode({ id, data, selected }: NodeProps<Node<FrameData>>): ReactNode {
  const renameFrame = useGraph((s) => s.renameFrame)
  const selectTiles = useGraph((s) => s.selectTiles)
  const [draft, setDraft] = useState<string | null>(null)
  const [nameHovered, setNameHovered] = useState(false)
  const commit = (): void => {
    if (draft != null) renameFrame(id, draft)
    setDraft(null)
  }
  return (
    <div
      // On press, not click: the tiles are selected before a drag starts, so the drag carries them.
      onPointerDown={(e) => {
        if (e.button === 0 && draft == null)
          selectTiles(frameTiles(useGraph.getState().frames, id), e.metaKey || e.ctrlKey)
      }}
      style={{
        ...frame,
        width: data.width,
        height: data.height,
        borderColor: selected ? UI.accent : UI.border
      }}
    >
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
  boxSizing: 'border-box',
  borderRadius: 14,
  border: `1.5px solid ${UI.border}`,
  background: `color-mix(in srgb, ${UI.text} 5%, transparent)`,
  padding: '6px 12px'
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
