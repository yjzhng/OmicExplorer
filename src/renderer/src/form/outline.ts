/**
 * Pure helpers behind the form workflow's nav: which steps a selection touches, and which step the
 * nav and the details column are showing.
 */
import type { Edge } from '@xyflow/react'

/** Which way each directly-wired step sits relative to `id`: an `input` feeds it, an `output` is fed
 *  by it. The nav chips these when `id` is selected. Both directions matter equally — a source step
 *  has only outputs and a terminal plot only inputs, so a one-directional version looks correct at
 *  the ends of a pipeline and quietly drops half the neighbourhood in the middle. */
export type Wiring = 'input' | 'output'
export function wiredTo(id: string | null, edges: Edge[]): Map<string, Wiring> {
  const near = new Map<string, Wiring>()
  if (!id) return near
  for (const e of edges) if (e.source === id) near.set(e.target, 'output')
  // Inputs last, so a step that is somehow both reads as the input — what it contributes to this
  // step matters more than what it takes back.
  for (const e of edges) if (e.target === id) near.set(e.source, 'input')
  near.delete(id) // a self-edge would otherwise chip the selection itself
  return near
}

/** Which step the nav highlights and the details column shows. The stored selection is shared with
 *  the canvas, so it can name a step this workflow no longer has (deleted, or another workflow's).
 *  Falling back to the first keeps the details column populated instead of blanking. */
export function resolveSelection(selectedId: string | null, order: string[]): string | null {
  if (selectedId && order.includes(selectedId)) return selectedId
  return order[0] ?? null
}
