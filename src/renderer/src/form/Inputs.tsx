/**
 * A step's input picker for the form workflow — the canvas's edges, as dropdowns. Shared by the
 * settings card (every step that takes an input) and the plot step's tile.
 */
import type { CSSProperties, ReactNode } from 'react'

import { Select } from '../graph/NodeConfigPanel'
import { canConnect, maxInputsFor, plotLabel } from '../graph/registry'
import { eligibleInputs } from '../graph/sequence'
import { useGraph } from '../graph/store'
import { isStep, type StepNode } from '../graph/types'
import { UI } from '../ui/theme'

export /** A step's upstream wiring, stated rather than implied — the reason a form can represent a DAG.
 *  Each slot is a dropdown of the steps that may legally feed this one; the extra empty slot (up to
 *  the kind's input cap) is how a second input gets added without a canvas. */
function Inputs({ node }: { node: StepNode }): ReactNode {
  const id = node.id
  const kind = node.data.kind
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const onConnect = useGraph((s) => s.onConnect)
  const removeEdge = useGraph((s) => s.removeEdge)

  const incoming = edges.filter((e) => e.target === id)
  const cap = maxInputsFor(kind)
  const order = nodes.filter(isStep).map((n) => n.id)
  const byId = new Map(nodes.filter(isStep).map((n) => [n.id, n as StepNode]))
  // Steps ABOVE this one that may legally feed it. The sections are a sequence the user builds
  // downward, so a later step is not offerable — picking one would make the order say the opposite
  // of the wiring.
  const eligible = eligibleInputs(id, order, edges)
    .map((s) => byId.get(s))
    .filter((n): n is StepNode => !!n && canConnect(n.data.kind, kind))

  const slots: (string | null)[] = [...incoming.map((e) => e.source)]
  if (slots.length < cap) slots.push(null) // one empty slot to add the next input

  return (
    <div style={styles.inputs}>
      {slots.map((src, i) => (
        <div key={`${src ?? 'new'}-${i}`} style={styles.slot}>
          <Select
            value={src ?? ''}
            placeholder="— add input —"
            unscaled
            options={[
              // Clearing a slot is a real choice, so it's an option rather than a stray control;
              // an empty slot has nothing to clear, and shows the placeholder instead.
              ...(src ? [{ value: '', label: '— remove —' }] : []),
              ...eligible.map((n) => ({
                value: n.id,
                label: `${plotLabel(n.data.kind, n.data.config)} · ${n.id}`
              }))
            ]}
            onChange={(next) => {
              const existing = incoming.find((x) => x.source === src)
              if (existing) removeEdge(existing.id)
              if (next)
                onConnect({ source: next, target: id, sourceHandle: null, targetHandle: null })
            }}
          />
        </div>
      ))}
      {incoming.length === 0 && <span style={styles.warn}>not connected</span>}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  inputs: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    fontSize: 12,
    color: UI.textMuted
  },
  slot: { flex: '0 1 240px', minWidth: 140, display: 'flex' },
  warn: { color: '#e0a458' }
}
