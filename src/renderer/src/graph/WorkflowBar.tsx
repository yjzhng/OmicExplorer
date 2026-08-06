import { type CSSProperties } from 'react'

import { UI } from '../ui/theme'
import { useGraph } from './store'

/** Canvas undo/redo. Workflow switching, add/rename/delete and Run live in the top
 *  nav (workflow chip + Run button). */
export function WorkflowBar() {
  const canUndo = useGraph((s) => s.past.length > 0)
  const canRedo = useGraph((s) => s.future.length > 0)
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)

  const items = [
    { k: 'undo', label: '↺', onClick: undo, disabled: !canUndo, title: 'Undo' },
    { k: 'redo', label: '↻', onClick: redo, disabled: !canRedo, title: 'Redo' }
  ]

  return (
    <div className="nodrag" style={group}>
      {items.map((it, i) => (
        <button
          key={it.k}
          title={it.title}
          disabled={it.disabled}
          onClick={it.onClick}
          style={{
            ...gBtn,
            borderLeft: i === 0 ? 'none' : `1px solid ${UI.border}`,
            opacity: it.disabled ? 0.4 : 1
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

const group: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'stretch',
  border: `1px solid ${UI.border}`,
  borderRadius: 6,
  overflow: 'hidden',
  background: UI.panel
}
const gBtn: CSSProperties = {
  background: 'transparent',
  color: UI.text,
  border: 'none',
  padding: '4px 10px',
  fontSize: 13,
  cursor: 'pointer',
  lineHeight: 1.4
}
