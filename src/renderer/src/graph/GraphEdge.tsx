import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { type CSSProperties } from 'react'

import { UI } from '../ui/theme'
import { usedInputs } from './contrastPair'
import { useGraph } from './store'
import { isStep, type ContrastConfig } from './types'

/** Editable edge: selectable, with a delete button shown when selected. */
export function GraphEdge({
  id,
  source,
  target,
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
  // A Contrast can have more inputs wired than it consumes (it picks one dataset, or a pair);
  // an input it isn't using is drawn dashed so the wiring reads as "connected but idle".
  const idle = useGraph((s) => {
    const tgt = s.nodes.find((n) => n.id === target)
    if (!tgt || !isStep(tgt) || tgt.data.kind !== 'contrast') return false
    const ups = s.edges.filter((e) => e.target === target).map((e) => e.source)
    return !usedInputs(tgt.data.config as ContrastConfig, ups).has(source)
  })
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
          strokeWidth: selected ? 2 : 1.5,
          ...(idle ? { strokeDasharray: '6 4', opacity: 0.6 } : null)
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
