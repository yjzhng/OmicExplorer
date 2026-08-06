import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { type CSSProperties } from 'react'

import { UI } from '../ui/theme'
import { useGraph } from './store'

/** Editable edge: selectable, with a delete button shown when selected. */
export function GraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd
}: EdgeProps) {
  const removeEdge = useGraph((s) => s.removeEdge)
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? UI.accent : '#5a5a6a',
          strokeWidth: selected ? 2 : 1.5
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="nodrag nopan"
            title="Delete connection"
            onClick={(e) => {
              e.stopPropagation()
              removeEdge(id)
            }}
            style={{
              ...deleteBtn,
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const edgeTypes = { default: GraphEdge }

const deleteBtn: CSSProperties = {
  position: 'absolute',
  pointerEvents: 'all',
  width: 18,
  height: 18,
  lineHeight: '15px',
  borderRadius: '50%',
  background: UI.panel,
  color: '#f2b8b9',
  border: `1px solid ${UI.accent}`,
  fontSize: 13,
  cursor: 'pointer',
  padding: 0
}
