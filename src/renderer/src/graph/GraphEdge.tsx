import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { type CSSProperties } from 'react'

import { UI } from '../ui/theme'
import { usedInputs } from './contrastPair'
import { useGraph } from './store'
import { useStepStatus } from './StatusDot'
import { isStep, type ContrastConfig, type NodeData } from './types'

const DONE_EDGE = '#3fae5a'
const ERROR_EDGE = '#e5484d'
/** An edge end's status: complete (the step's status dot is green) and errored. */
const FALLBACK: NodeData = { kind: 'load', config: {} as NodeData['config'], status: 'idle' }
function useEndStatus(id: string): { ok: boolean; error: boolean } {
  const node = useGraph((s) => s.nodes.find((n) => n.id === id))
  const data = node && isStep(node) ? node.data : FALLBACK
  const info = useStepStatus(id, data)
  return {
    ok: !!(node && isStep(node) && info.ok),
    error: data !== FALLBACK && data.status === 'error'
  }
}

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
  // Status colour: green when both ends are complete (the data has flowed through), red when the
  // step it feeds errored; otherwise the plain grey.
  const up = useEndStatus(source)
  const down = useEndStatus(target)
  // Selecting a connection keeps its status colour — it reads as selected by its width and
  // full opacity (and its delete button).
  const stroke = down.error ? ERROR_EDGE : up.ok && down.ok ? DONE_EDGE : '#7c7c8c'
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
          stroke,
          strokeWidth: selected ? 3 : 2,
          // Set in both states (a dropped longhand wouldn't fall back to the other value).
          opacity: selected ? 1 : idle ? 0.45 : 0.85,
          ...(idle ? { strokeDasharray: '6 4' } : null)
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
            {/* Drawn, not typed: a text "×" sits on the font's baseline, off the circle's centre. */}
            <svg width={8} height={8} viewBox="0 0 8 8" style={{ display: 'block' }}>
              <path
                d="M1 1l6 6M7 1 1 7"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            </svg>
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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  borderRadius: '50%',
  background: UI.panel,
  color: '#f2b8b9',
  border: `1px solid ${UI.accent}`,
  cursor: 'pointer',
  padding: 0
}
