/**
 * A project can hold a tile this build doesn't know: one saved by a build that had a plot since
 * removed, or by a newer build. Nothing in the app can draw or run it (every lookup by kind would
 * fail), so it's left out when the project is opened — the step itself, its wiring and layout, a
 * plot of that kind inside a plot group (an emptied group with it). Saving writes the project
 * without them.
 *
 * Not one of the versioned upgrades (upgrades.ts): it depends on the build reading the file, not
 * on the release that wrote it.
 */
import type { RawProject } from './upgrades'
import type { PanelLayoutItem } from './types'

interface RawNode {
  id: string
  data?: { kind?: string; config?: { children?: Array<{ id: string; kind?: string }> } }
}

/** Drop every step and grouped plot whose kind isn't in `known`, in place; returns the kinds
 *  dropped (for the log). */
export function dropUnknownKinds(raw: RawProject, known: ReadonlySet<string>): string[] {
  const dropped = new Set<string>()
  for (const f of raw.folders ?? [])
    for (const w of f.workflows ?? []) {
      const doc = w.doc
      if (!doc?.nodes) continue
      const gone = new Set<string>()
      const layouts = doc.groupLayouts as Record<string, PanelLayoutItem[]> | undefined
      const nodes = (doc.nodes as unknown as RawNode[]).filter((n) => {
        const kind = n?.data?.kind
        // a node without a kind is passed through as it is (see upgradeWorkflowDoc)
        if (!kind) return true
        if (!known.has(kind)) {
          dropped.add(kind)
          gone.add(n.id)
          return false
        }
        const children = n.data?.config?.children
        if (kind !== 'plotGroup' || !Array.isArray(children)) return true
        const keep = children.filter((c) => {
          if (!c?.kind || known.has(c.kind)) return true
          dropped.add(c.kind)
          return false
        })
        if (keep.length === children.length) return true
        if (keep.length === 0) {
          gone.add(n.id)
          return false
        }
        n.data!.config!.children = keep
        const ids = new Set(keep.map((c) => c.id))
        if (layouts?.[n.id]) layouts[n.id] = layouts[n.id].filter((it) => ids.has(it.i))
        return true
      })
      if (gone.size === 0 && nodes.length === doc.nodes.length) continue
      doc.nodes = nodes as unknown as typeof doc.nodes
      doc.edges = (doc.edges ?? []).filter((e) => !gone.has(e.source) && !gone.has(e.target))
      for (const id of gone) {
        if (layouts) delete layouts[id]
        if (doc.groupMeta) delete doc.groupMeta[id]
      }
    }
  return [...dropped]
}
