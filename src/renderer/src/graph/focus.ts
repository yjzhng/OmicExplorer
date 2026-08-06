/** Resolve a plot node's effective focus genes from its FocusConfig, following
 *  `inherit` up to the nearest Standardize ancestor. All ids are uniqIDs. */
import type { Edge } from '@xyflow/react'

import type { FocusConfig, PlotChild, StandardizeConfig, StepNode } from './types'

export const DEFAULT_FOCUS: FocusConfig = { mode: 'inherit', goi: [], panel: [] }

/** Effective focus gene sets for a plot (already resolved through inheritance). */
export interface FocusSet {
  goi: string[]
  panel: string[]
}
export const EMPTY_FOCUS: FocusSet = { goi: [], panel: [] }

/** goi ∪ panel, de-duplicated and order-stable (goi first) — the set most plots act on. */
export function focusIds(f: FocusSet): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...f.goi, ...f.panel]) {
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** Resolve a FocusConfig against the graph: `none` → empty, `custom` → its own sets,
 *  `inherit` → the nearest Standardize ancestor's sets, walking target→source from
 *  `startId`. Shared by plain plot nodes and group subcards (which walk from the group). */
function resolveConfig(
  focus: FocusConfig,
  startId: string,
  byId: Map<string, StepNode>,
  edges: Edge[]
): FocusSet {
  if (focus.mode === 'none') return EMPTY_FOCUS
  if (focus.mode === 'custom') return { goi: focus.goi ?? [], panel: focus.panel ?? [] }
  let cur: string | undefined = startId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const n = byId.get(cur)
    if (n?.data.kind === 'standardize') {
      const c = n.data.config as StandardizeConfig
      return { goi: c.goi ?? [], panel: c.panel ?? [] }
    }
    cur = edges.find((e) => e.target === cur)?.source
  }
  return EMPTY_FOCUS
}

/** The focus sets a plot node applies (its own FocusConfig, inheritance resolved). */
export function resolveFocus(nodeId: string, nodes: StepNode[], edges: Edge[]): FocusSet {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const node = byId.get(nodeId)
  if (!node) return EMPTY_FOCUS
  const focus = (node.data.config as { focus?: FocusConfig }).focus ?? DEFAULT_FOCUS
  return resolveConfig(focus, nodeId, byId, edges)
}

/** The focus sets a group subcard applies. `inherit` follows the GROUP's edge (the child
 *  has no edge of its own), so it lands on the same Standardize ancestor a standalone plot
 *  on that upstream would. */
export function resolveChildFocus(
  child: PlotChild,
  groupId: string,
  nodes: StepNode[],
  edges: Edge[]
): FocusSet {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const focus = (child.config as { focus?: FocusConfig }).focus ?? DEFAULT_FOCUS
  return resolveConfig(focus, groupId, byId, edges)
}
