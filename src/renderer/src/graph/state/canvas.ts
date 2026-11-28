import {
  reconnectEdge,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge
} from '@xyflow/react'
import { diskWrite } from '../project/diskWrites'
import { dropOrder, groupedOrder } from '../canvas/frameOrder'
import { editMembers, groupInto, ungroupFrom, withoutTiles } from '../canvas/frames'
import { childPanelId } from '../results/groups'
import { isLonePlot, wrapPlot } from '../results/plotGroups'
import { canConnect, categoryOf, maxInputsFor, wiredKindOf } from '../registry'
import { type Getter, type GraphState, type StoreSet } from '../store'
import { tidyLayout } from '../canvas/tidy'
import { copyTiles as clipOf, pasteTiles as pastePlan } from '../canvas/tileClipboard'
import {
  type CanvasFrame,
  type GraphNode,
  isStep,
  type NodeConfig,
  type NodeKind,
  type PanelLayoutItem,
  type PlaceholderNode,
  type PlotChild,
  type PlotGroupConfig,
  plotResultKey,
  type StepNode
} from '../types'
import { type LoadConfig, resolveLoadMode } from '../config/load'
import { makeNode, startingConfig, locationOf, resultHistory } from './shared'

/** Keep the node list consistent with the wiring: a step never sits before one of its inputs — and
 *  each group's steps sit together wherever the wiring allows (see frameOrder.groupedOrder). The
 *  list is the form layout's section order, so it has to agree with the edges and groups no matter
 *  which view changed them — hence this runs on every edge or group change rather than inside the
 *  form. Returns the SAME array when nothing needs moving, so an unaffected edit doesn't churn React
 *  Flow's node identity. */
export function sortStepsByWiring(
  nodes: GraphNode[],
  edges: Edge[],
  frames: CanvasFrame[]
): GraphNode[] {
  const order = nodes.map((n) => n.id)
  const sorted = groupedOrder(order, edges, frames)
  if (sorted.every((id, i) => id === order[i])) return nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return sorted.flatMap((id) => {
    const n = byId.get(id)
    return n ? [n] : []
  })
}
/** Raise the store-selected node's React Flow zIndex so its config-detail float (which floats to
 *  the right of the tile, over neighbours) always paints above sibling tiles — a node's own
 *  zIndex governs the whole `.react-flow__node` stacking context, which the float can't escape. */
export const SELECTED_Z = 1000000
/** Tiles brought to the front (a plot group just expanded / collapsed — it may now overlap its
 *  neighbours), each above the ones lifted before it; below the selected tile's float. */
export const lifted = new Map<string, number>()
export let liftTop = 0
export function lift(ids: Iterable<string>): void {
  for (const id of ids) lifted.set(id, ++liftTop)
}
export function elevate(nodes: GraphNode[], selId: string | null): GraphNode[] {
  return nodes.map((n) => {
    const z = n.id === selId ? SELECTED_Z : lifted.get(n.id)
    return n.zIndex === z ? n : { ...n, zIndex: z }
  })
}
/** Rewrite dashboard-layout panel ids (`PanelLayoutItem.i`) through `idMap`, preserving each
 *  tile's saved position and size. Group/ungroup mint fresh node & subcard ids, so without this
 *  the old layout entries no longer match any panel and reconcileLayout resets them to defaults. */
export function remapLayouts(
  layouts: Record<string, PanelLayoutItem[]>,
  idMap: Map<string, string>
): Record<string, PanelLayoutItem[]> {
  return Object.fromEntries(
    Object.entries(layouts).map(([rid, items]) => [
      rid,
      items.map((it) => (idMap.has(it.i) ? { ...it, i: idMap.get(it.i)! } : it))
    ])
  )
}
/** Mint stable subcard ids from the shared node counter, cloning each config. */
export function toChildren(
  specs: Array<{ kind: NodeKind; config: NodeConfig }>,
  startId: number
): PlotChild[] {
  return specs.map((s, i) => ({
    id: `sub-${startId + i}`,
    kind: s.kind,
    config: structuredClone(s.config)
  }))
}
/** A group tile node holding the given subcards. */
export function makeGroupNode(
  id: string,
  position: { x: number; y: number },
  children: PlotChild[]
): StepNode {
  return {
    id,
    type: 'step',
    position,
    data: { kind: 'plotGroup', config: { children }, status: 'idle' }
  }
}
/** The default name for a new frame: "Group n", the lowest n not already taken. */
export function nextGroupName(frames: CanvasFrame[]): string {
  const taken = new Set(frames.map((f) => f.label))
  let n = 1
  while (taken.has(`Group ${n}`)) n++
  return `Group ${n}`
}
/** A copied group's name: its own with `_copy` — then `_copy2`, `_copy3`, … — the first not taken
 *  (a copy of a copy counts on from its original's name, not `_copy_copy`). */
export function copyGroupName(label: string, taken: Iterable<string>): string {
  const names = new Set(taken)
  const base = label.replace(/_copy\d*$/, '')
  let name = `${base}_copy`
  for (let n = 2; names.has(name); n++) name = `${base}_copy${n}`
  return name
}
/** The open workflow as a copy's origin: the project file (or this window's unsaved session) and
 *  the workflow in it. */
export const SESSION = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`
export function clipOrigin(s: GraphState): string {
  return `${s.projectPath ?? SESSION}|${s.activeFolderId}|${s.activeWorkflowId}`
}
/** Canvas editing: wiring, adding / removing / copying tiles, placeholders, selection, plot groups, frames, tidy. */
export function canvasSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'frameNodes'
  | 'unframeNodes'
  | 'editFrame'
  | 'selectTiles'
  | 'setFrameFolded'
  | 'renameFrame'
  | 'onNodesChange'
  | 'onEdgesChange'
  | 'onConnect'
  | 'onReconnect'
  | 'onEdgesDelete'
  | 'removeEdge'
  | 'isValidConnection'
  | 'addNode'
  | 'addPlaceholder'
  | 'resolvePlaceholder'
  | 'cancelPlaceholder'
  | 'deleteNode'
  | 'duplicateNode'
  | 'duplicateNodes'
  | 'copyTiles'
  | 'copiedHere'
  | 'pasteTiles'
  | 'selectNode'
  | 'selectChildCard'
  | 'setCanvasSelection'
  | 'moveStep'
  | 'moveItem'
  | 'renameNode'
  | 'groupNodes'
  | 'ungroupNodes'
  | 'addGroupChild'
  | 'addGroupChildren'
  | 'removeGroupChildren'
  | 'removeGroupChild'
  | 'moveGroupChild'
  | 'setGroupsCollapsed'
  | 'tidyNodes'
  | 'cascadeNodes'
  | 'changeOp'
> {
  return {
    frameNodes: (ids) => {
      const { nodes, frames, nextId } = get()
      const steps = new Set(nodes.filter(isStep).map((n) => n.id))
      const frameIds = new Set(frames.map((f) => f.id))
      const next = groupInto(frames, ids, (id) => steps.has(id) || frameIds.has(id), {
        id: `frame-${nextId}`,
        // Named Group 1, Group 2, …: the first number no frame in this workflow is using.
        label: nextGroupName(frames)
      })
      if (next === frames) return
      get().commit()
      set({
        frames: next,
        nextId: nextId + 1,
        nodes: sortStepsByWiring(nodes, get().edges, next)
      })
    },
    unframeNodes: (ids) => {
      const next = ungroupFrom(get().frames, ids)
      if (next === get().frames) return
      get().commit()
      set({ frames: next, nodes: sortStepsByWiring(get().nodes, get().edges, next) })
    },
    editFrame: (id, add, remove) => {
      const next = editMembers(get().frames, id, add, remove)
      if (next === get().frames) return
      get().commit()
      set({ frames: next, nodes: sortStepsByWiring(get().nodes, get().edges, next) })
    },
    selectTiles: (ids, additive = false) => {
      const pick = new Set(ids)
      set((s) => {
        const nodes = s.nodes.map((n) => {
          const on = pick.has(n.id) || (additive && !!n.selected)
          return !!n.selected === on ? n : { ...n, selected: on }
        })
        const sel = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
        const edges = s.edges.map((e) => {
          const on = sel.has(e.source) && sel.has(e.target)
          return !!e.selected === on ? e : { ...e, selected: on }
        })
        // Mirrors React Flow's onSelectionChange, which doesn't run while the canvas isn't shown.
        const canvasSelection = nodes.filter((n) => isStep(n) && n.selected).map((n) => n.id)
        return { nodes, edges, canvasSelection }
      })
    },
    setFrameFolded: (id, folded) =>
      set((s) => ({
        frames: s.frames.map((f) => (f.id === id ? { ...f, folded } : f)),
        dirty: true
      })),
    renameFrame: (id, label) => {
      const f = get().frames.find((x) => x.id === id)
      // An emptied name keeps the frame's current one.
      const name = label.trim() || f?.label || ''
      if (!f || f.label === name) return
      get().commit()
      set((s) => ({ frames: s.frames.map((x) => (x.id === id ? { ...x, label: name } : x)) }))
    },

    onNodesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) get().commit()
      set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }))
    },
    onEdgesChange: (changes) => {
      if (changes.some((c) => c.type === 'remove')) get().commit()
      set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }))
    },

    onConnect: (conn) => {
      const { nodes, edges } = get()
      const src = nodes.find((n) => n.id === conn.source)
      const tgt = nodes.find((n) => n.id === conn.target)
      if (!src || !tgt || !conn.source || !conn.target) return
      if (!isStep(src) || !isStep(tgt) || !canConnect(wiredKindOf(get(), src.id)!, tgt.data.kind))
        return
      // contrast and compare take two inputs; every other node takes one.
      const maxInputs = maxInputsFor(tgt.data.kind)
      const existing = edges.filter((e) => e.target === conn.target)
      if (existing.some((e) => e.source === conn.source)) return // no duplicate input
      get().commit()
      // keep the most recent (maxInputs-1) inputs; drop older ones so we stay at capacity
      const keep = maxInputs > 1 ? existing.slice(existing.length - (maxInputs - 1)) : []
      const pruned = edges.filter((e) => e.target !== conn.target || keep.includes(e))
      const next = addEdge({ ...conn, id: `e-${conn.source}-${conn.target}` }, pruned)
      set({ edges: next, nodes: sortStepsByWiring(get().nodes, next, get().frames) })
      // Only the tile that gained an input (and what it feeds) is out of date. Staling everything
      // downstream of the SOURCE also cleared its other branches — wiring a second Compare from
      // Clean data emptied the first Compare and its plots.
      get().markStale(conn.target)
    },

    onReconnect: (oldEdge, conn) => {
      const { nodes, edges } = get()
      const src = nodes.find((n) => n.id === conn.source)
      const tgt = nodes.find((n) => n.id === conn.target)
      if (!src || !tgt || !conn.source || !conn.target) return
      if (!isStep(src) || !isStep(tgt) || !canConnect(wiredKindOf(get(), src.id)!, tgt.data.kind))
        return
      const maxInputs = maxInputsFor(tgt.data.kind)
      const others = edges.filter((e) => e.id !== oldEdge.id && e.target === conn.target)
      if (others.some((e) => e.source === conn.source)) return // no duplicate input
      get().commit()
      // keep the moved edge + the most recent (maxInputs-1) other inputs to the new target
      const keep = maxInputs > 1 ? others.slice(others.length - (maxInputs - 1)) : []
      const pruned = edges.filter(
        (e) => e.id === oldEdge.id || e.target !== conn.target || keep.includes(e)
      )
      const moved = reconnectEdge(oldEdge, conn, pruned)
      set({ edges: moved, nodes: sortStepsByWiring(get().nodes, moved, get().frames) })
      // both the previous and new target lost/changed their input
      for (const t of new Set([oldEdge.target, conn.target])) get().markStale(t)
    },

    onEdgesDelete: (deleted) => {
      for (const e of deleted) get().markStale(e.target)
    },

    removeEdge: (id) => {
      const edge = get().edges.find((e) => e.id === id)
      if (!edge) return
      get().commit()
      set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }))
      get().markStale(edge.target)
    },

    isValidConnection: (conn) => {
      const { nodes } = get()
      const src = nodes.find((n) => n.id === conn.source)
      const tgt = nodes.find((n) => n.id === conn.target)
      return (
        !!src &&
        !!tgt &&
        isStep(src) &&
        isStep(tgt) &&
        canConnect(wiredKindOf(get(), src.id)!, tgt.data.kind)
      )
    },

    addNode: (op, opts) => {
      get().commit()
      const id = `${op}-${get().nextId}`
      const pos = opts?.position ?? { x: 120 + Math.min(get().nodes.length, 8) * 24, y: 340 }
      // A visualisation comes as a plot group of one (its subcard takes the next id).
      const plain = makeNode(id, op, pos)
      const lone = isLonePlot(plain)
      const node = lone ? wrapPlot(plain, `sub-${get().nextId + 1}`) : plain
      set((s) => ({
        nodes: [...s.nodes, node],
        nextId: s.nextId + (lone ? 2 : 1),
        // A new tile isn't opened: its settings window would cover the canvas just as it's placed.
        selectedId: null,
        selectedSub: null
      }))
      // optional: wire an edge from an upstream node (used by the node "+" affordance)
      const from = opts?.connectFrom
      if (from) {
        const src = get().nodes.find((n) => n.id === from)
        if (src && isStep(src) && canConnect(wiredKindOf(get(), src.id)!, op)) {
          set((s) => ({
            edges: [
              ...s.edges.filter((e) => e.target !== id),
              { id: `e-${from}-${id}`, source: from, target: id }
            ]
          }))
        }
      }
      return id
    },

    addPlaceholder: (source, ops, position) => {
      // No commit: a placeholder is UI-only until resolved, so it stays out of history.
      const id = `step-${get().nextId}`
      const ph: PlaceholderNode = {
        id,
        type: 'placeholder',
        position,
        data: { ops, source: source ?? undefined }
      }
      set((s) => ({
        nodes: [...s.nodes, ph],
        edges: source
          ? [
              ...s.edges.filter((e) => e.target !== id),
              { id: `e-${source}-${id}`, source, target: id }
            ]
          : s.edges,
        nextId: s.nextId + 1,
        selectedId: null
      }))
      return id
    },

    resolvePlaceholder: (id, picks) => {
      const { nodes, edges, nextId, past } = get()
      const ph = nodes.find((n) => n.id === id)
      if (!ph || ph.type !== 'placeholder' || picks.length === 0) return
      // Snapshot the graph as if the placeholder never existed → one clean undo step
      // that removes the finished step and its edge together.
      const baseNodes = nodes.filter((n) => n.id !== id)
      const baseEdges = edges.filter((e) => e.target !== id)
      set({
        past: [
          ...past,
          {
            nodes: structuredClone(baseNodes),
            edges: structuredClone(baseEdges),
            nextId,
            versions: resultHistory.ref(get().results)
          }
        ].slice(-50),
        future: [],
        dirty: true
      })
      // One pick → a plain node. Multiple (all plotting) → a group tile with a subcard per pick.
      // Either way keep the placeholder's id, position, and incoming edge. A pick's `override` seeds
      // its config (e.g. a dr pick's axis = dose/time), on top of the kind's defaults.
      const configFor = (pick: {
        kind: NodeKind
        override?: Record<string, unknown>
      }): NodeConfig => startingConfig(pick.kind, pick.override)
      // A single plot is a group of one, the same as several (handled below) — every visualisation
      // tile is a plot group.
      if (picks.length === 1 && categoryOf(picks[0].kind) !== 'plotting') {
        const pick = picks[0]
        set((s) => ({
          nodes: s.nodes.map((n) => {
            if (n.id !== id) return n
            const node = makeNode(id, pick.kind, n.position)
            return { ...node, data: { ...node.data, config: configFor(pick) } }
          }),
          // Not opened on creation (see addNode); the form selects it itself.
          selectedId: null,
          selectedSub: null
        }))
        return
      }
      const children = toChildren(
        picks.map((pick) => ({ kind: pick.kind, config: configFor(pick) })),
        nextId
      )
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? makeGroupNode(id, n.position, children) : n)),
        nextId: s.nextId + picks.length,
        selectedId: null,
        selectedSub: null
      }))
      // Dragged out of a step that's already done: its data is there, so the plots run straight away.
      const source = edges.find((e) => e.target === id)?.source
      const up = source ? nodes.find((n) => n.id === source) : undefined
      if (up && isStep(up) && up.data.status === 'done') void get().runNode(id)
    },

    cancelPlaceholder: (id) => {
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.target !== id),
        selectedId: s.selectedId === id ? null : s.selectedId
      }))
    },

    deleteNode: (id) => {
      get().commit()
      set((s) => {
        const results = { ...s.results }
        delete results[id]
        return {
          nodes: s.nodes.filter((n) => n.id !== id),
          edges: s.edges.filter((e) => e.source !== id && e.target !== id),
          results,
          selectedId: s.selectedId === id ? null : s.selectedId,
          // out of its frame too; a frame left empty goes (and a parent it empties)
          frames: withoutTiles(s.frames, new Set([id]))
        }
      })
    },

    duplicateNode: (id) => get().duplicateNodes([id]),

    duplicateNodes: (ids) => {
      // A copy pasted beside the originals: the tiles, the links between them and the groups whose
      // every tile is copied (each with its nested groups), renamed _copy, _copy2, …
      const s = get()
      const clip = clipOf(s, ids, null, null)
      if (!clip) return
      get().commit()
      const taken = new Set([...s.nodes.map((n) => n.id), ...s.frames.map((f) => f.id)])
      for (const n of s.nodes)
        if (isStep(n) && n.data.kind === 'plotGroup')
          for (const c of (n.data.config as PlotGroupConfig).children) taken.add(c.id)
      const corner = {
        x: Math.min(...clip.nodes.map((n) => n.position.x)) + 40,
        y: Math.min(...clip.nodes.map((n) => n.position.y)) + 40
      }
      const p = pastePlan(clip, { taken, nextId: s.nextId }, corner)
      const frames = [...s.frames]
      for (const f of p.frames)
        frames.push({
          ...f,
          label: copyGroupName(
            f.label,
            frames.map((g) => g.label)
          )
        })
      set((st) => {
        const edges = [...st.edges, ...p.edges]
        // Copies appended last → drawn on top; originals get deselected so only the fresh tiles
        // read as selected.
        const nodes = elevate(
          [...st.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...p.nodes],
          p.nodes.length === 1 ? p.nodes[0].id : null
        )
        return {
          nodes: sortStepsByWiring(nodes, edges, frames),
          edges,
          frames,
          nextId: p.nextId,
          ...(Object.keys(p.layouts).length
            ? { groupLayouts: { ...st.groupLayouts, ...p.layouts } }
            : null),
          // Copies stay selected on the canvas but aren't opened (see addNode).
          selectedId: null,
          selectedSub: null
        }
      })
    },

    copyTiles: (ids) => {
      const s = get()
      return clipOf(s, ids, locationOf(s), clipOrigin(s))
    },
    copiedHere: (clip) => clip.origin === clipOrigin(get()),

    pasteTiles: async (clip, at) => {
      // A Load tile's converted inputs live in the workflow it was copied from: copied here first
      // (renamed where this workflow reads another file by the name), so it reads them here too.
      const here = locationOf(get())
      const from = clip.from
      let src = clip
      const errors: string[] = []
      if (
        from &&
        here &&
        (from.dir !== here.dir || from.scope.base !== here.scope.base) &&
        typeof window.api.copyWorkflowInputs === 'function'
      ) {
        const fields = ['data', 'samplesheet', 'db'] as const
        const nodes = await Promise.all(
          clip.nodes.map(async (n) => {
            const cfg = n.config as LoadConfig
            if (n.kind !== 'load' || resolveLoadMode(cfg) !== 'interactive') return n
            const names = fields.flatMap((f) => (cfg[f] ? [cfg[f]] : []))
            if (!names.length) return n
            const got = await diskWrite(() => window.api.copyWorkflowInputs(from, here, names))
            errors.push(...got.errors)
            const patch = Object.fromEntries(
              fields.flatMap((f) => (cfg[f] && got.names[cfg[f]] ? [[f, got.names[cfg[f]]]] : []))
            )
            return { ...n, config: { ...cfg, ...patch } as NodeConfig }
          })
        )
        src = { ...clip, nodes }
      }
      const s = get()
      const taken = new Set([...s.nodes.map((n) => n.id), ...s.frames.map((f) => f.id)])
      for (const n of s.nodes)
        if (isStep(n) && n.data.kind === 'plotGroup')
          for (const c of (n.data.config as PlotGroupConfig).children) taken.add(c.id)
      const p = pastePlan(src, { taken, nextId: s.nextId }, at)
      // A pasted group keeps its name unless this workflow has one by it (then its _copy name).
      const frames = [...s.frames]
      for (const f of p.frames)
        frames.push(
          frames.some((g) => g.label === f.label)
            ? {
                ...f,
                label: copyGroupName(
                  f.label,
                  frames.map((g) => g.label)
                )
              }
            : f
        )
      get().commit()
      set((st) => {
        const edges = [...st.edges, ...p.edges]
        const nodes = [
          ...st.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          ...p.nodes
        ]
        return {
          nodes: sortStepsByWiring(elevate(nodes, null), edges, frames),
          edges,
          frames,
          nextId: p.nextId,
          ...(Object.keys(p.layouts).length
            ? { groupLayouts: { ...st.groupLayouts, ...p.layouts } }
            : null),
          selectedId: null,
          selectedSub: null
        }
      })
      if (src !== clip) await get().refreshDataFiles()
      return { tiles: p.nodes.length, groups: p.frames.length, errors }
    },

    // A group tile always has a plot selected: its details panel shows one plot's settings, so the
    // tile highlights that plot — the one already selected in it, else its first.
    selectNode: (id) =>
      set((s) => {
        const node = id ? s.nodes.find((n) => n.id === id) : undefined
        const kids =
          node && isStep(node) && node.data.kind === 'plotGroup'
            ? (node.data.config as PlotGroupConfig).children
            : []
        const selectedSub = kids.some((c) => c.id === s.selectedSub)
          ? s.selectedSub
          : (kids[0]?.id ?? null)
        return { selectedId: id, selectedSub, nodes: elevate(s.nodes, id) }
      }),
    selectChildCard: (groupId, childId) =>
      set((s) => ({ selectedId: groupId, selectedSub: childId, nodes: elevate(s.nodes, groupId) })),
    setCanvasSelection: (ids) => set({ canvasSelection: ids }),

    moveStep: (id, beforeId) => {
      if (id === beforeId) return
      const nodes = get().nodes
      const moved = nodes.find((n) => n.id === id)
      if (!moved) return
      const rest = nodes.filter((n) => n.id !== id)
      const at = beforeId === null ? rest.length : rest.findIndex((n) => n.id === beforeId)
      if (at === -1) return
      // Normalised, not just inserted: the rule that a step never precedes its input holds for every
      // caller, so a move that would break it is corrected rather than trusted. The form's drag
      // already refuses such a drop (see canMoveBefore); this is what makes it true regardless.
      const next = sortStepsByWiring(
        [...rest.slice(0, at), moved, ...rest.slice(at)],
        get().edges,
        get().frames
      )
      // A move that lands where it started changes nothing, and must not take an undo step with it.
      if (next.every((n, i) => n.id === nodes[i].id)) return
      get().commit()
      set(() => ({ nodes: next }))
    },

    moveItem: (item, slot) => {
      const { nodes, edges, frames } = get()
      const next = dropOrder(
        nodes.map((n) => n.id),
        edges,
        frames,
        item,
        slot
      )
      if (!next) return
      get().commit()
      const byId = new Map(nodes.map((n) => [n.id, n]))
      set({ nodes: next.map((id) => byId.get(id)!) })
    },

    renameNode: (id, name) => {
      get().commit()
      // File-name-safe (the name leads downloaded files); the tile's input filters as you type, this
      // is the backstop for any other caller.
      const trimmed = name.replace(/[^A-Za-z0-9 ._-]+/g, '').trim()
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n) ? { ...n, data: { ...n.data, name: trimmed || undefined } } : n
        )
      }))
    },

    groupNodes: (ids) => {
      const { nodes, edges } = get()
      const sel = ids
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is StepNode => !!n && isStep(n))
      // Need ≥2 plotting tiles that all share exactly one upstream (see plan: same-upstream only).
      if (sel.length < 2 || !sel.every((n) => categoryOf(n.data.kind) === 'plotting')) return
      const ups = new Set<string>()
      for (const n of sel) {
        const u = edges.filter((e) => e.target === n.id).map((e) => e.source)
        if (u.length !== 1) return
        ups.add(u[0])
      }
      if (ups.size !== 1) return
      const upstream = [...ups][0]
      get().commit()
      // Flatten: a selected group contributes its subcards; a plain plot contributes itself.
      const specs = sel.flatMap((n) =>
        n.data.kind === 'plotGroup'
          ? (n.data.config as PlotGroupConfig).children.map((c) => ({
              kind: c.kind,
              config: c.config
            }))
          : [{ kind: n.data.kind, config: n.data.config }]
      )
      // Each spec's CURRENT dashboard panel id, parallel to `specs`: a group subcard is
      // `${groupId}::${childId}`; a plain plot is its own node id. Remapped onto the new subcard
      // ids below so the tiles keep their saved grid position/size across the regroup.
      const oldPanelIds = sel.flatMap((n) =>
        n.data.kind === 'plotGroup'
          ? (n.data.config as PlotGroupConfig).children.map((c) => childPanelId(n.id, c.id))
          : [n.id]
      )
      // …and where each one's run result is held, so a plot that has run stays run in its new group.
      const oldResultKeys = sel.flatMap((n) =>
        n.data.kind === 'plotGroup'
          ? (n.data.config as PlotGroupConfig).children.map((c) => plotResultKey(n.id, c.id))
          : [n.id]
      )
      const startId = get().nextId
      const children = toChildren(specs, startId)
      const groupId = `plotGroup-${startId + specs.length}`
      const layoutRemap = new Map<string, string>()
      children.forEach((c, i) => layoutRemap.set(oldPanelIds[i], childPanelId(groupId, c.id)))
      // Anchor the group at the top-left-most selected tile.
      const pos = sel.reduce(
        (best, n) =>
          n.position.y < best.y || (n.position.y === best.y && n.position.x < best.x)
            ? n.position
            : best,
        sel[0].position
      )
      const selIds = new Set(sel.map((n) => n.id))
      set((s) => {
        const results = { ...s.results }
        children.forEach((c, i) => {
          const r = s.results[oldResultKeys[i]]
          if (r) results[plotResultKey(groupId, c.id)] = r
          delete results[oldResultKeys[i]]
        })
        for (const nid of selIds) delete results[nid]
        return {
          nodes: elevate(
            [...s.nodes.filter((n) => !selIds.has(n.id)), makeGroupNode(groupId, pos, children)],
            null
          ),
          edges: [
            ...s.edges.filter((e) => !selIds.has(e.target) && !selIds.has(e.source)),
            { id: `e-${upstream}-${groupId}`, source: upstream, target: groupId }
          ],
          results,
          groupLayouts: remapLayouts(s.groupLayouts, layoutRemap),
          nextId: startId + specs.length + 1,
          // Not opened on creation (see addNode).
          selectedId: null,
          selectedSub: null
        }
      })
    },

    ungroupNodes: (ids) => {
      const { nodes, edges } = get()
      const groups = ids
        .map((id) => nodes.find((n) => n.id === id))
        .filter((n): n is StepNode => !!n && isStep(n) && n.data.kind === 'plotGroup')
        // A group of one has nothing to split.
        .filter((n) => (n.data.config as PlotGroupConfig).children.length > 1)
      if (groups.length === 0) return
      get().commit()
      let nextId = get().nextId
      const addNodes: StepNode[] = []
      const addEdges: Edge[] = []
      const removeIds = new Set<string>()
      // Each subcard becomes its own plot group of one (every visualisation tile is a group); carry
      // its saved grid slot over by remapping its `${groupId}::${childId}` panel id to the new tile's.
      const layoutRemap = new Map<string, string>()
      // Each plot's run result follows it to its new tile.
      const resultRemap = new Map<string, string>()
      for (const g of groups) {
        const upstream = edges.find((e) => e.target === g.id)?.source
        const kids = (g.data.config as PlotGroupConfig).children
        kids.forEach((c, i) => {
          const nid = `plotGroup-${nextId++}`
          addNodes.push(
            makeGroupNode(nid, { x: g.position.x + i * 28, y: g.position.y + i * 46 }, [
              { ...c, config: structuredClone(c.config) }
            ])
          )
          layoutRemap.set(childPanelId(g.id, c.id), childPanelId(nid, c.id))
          resultRemap.set(plotResultKey(g.id, c.id), plotResultKey(nid, c.id))
          if (upstream) addEdges.push({ id: `e-${upstream}-${nid}`, source: upstream, target: nid })
        })
        removeIds.add(g.id)
      }
      set((s) => ({
        nodes: elevate([...s.nodes.filter((n) => !removeIds.has(n.id)), ...addNodes], null),
        edges: [
          ...s.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
          ...addEdges
        ],
        results: (() => {
          const r = { ...s.results }
          for (const [from, to] of resultRemap) {
            if (r[from]) r[to] = r[from]
            delete r[from]
          }
          return r
        })(),
        groupLayouts: remapLayouts(s.groupLayouts, layoutRemap),
        nextId,
        selectedId: null,
        selectedSub: null
      }))
    },

    addGroupChild: (groupId, kind, override) => {
      const group = get().nodes.find((n) => n.id === groupId)
      if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
      get().commit()
      const config = startingConfig(kind, override)
      const [child] = toChildren([{ kind, config }], get().nextId)
      set((s) => ({
        nextId: s.nextId + 1,
        selectedSub: child.id,
        nodes: s.nodes.map((n) => {
          if (n.id !== groupId || !isStep(n)) return n
          const cfg = n.data.config as PlotGroupConfig
          return {
            ...n,
            data: { ...n.data, config: { ...cfg, children: [...cfg.children, child] } }
          }
        })
      }))
    },

    addGroupChildren: (groupId, specs) => {
      const group = get().nodes.find((n) => n.id === groupId)
      if (!group || !isStep(group) || group.data.kind !== 'plotGroup' || specs.length === 0) return
      get().commit()
      const startId = get().nextId
      const added = toChildren(
        specs.map((s) => ({
          kind: s.kind,
          config: startingConfig(s.kind, s.override)
        })),
        startId
      )
      set((s) => ({
        nextId: startId + added.length,
        selectedSub: added[added.length - 1].id,
        nodes: s.nodes.map((n) => {
          if (n.id !== groupId || !isStep(n)) return n
          const cfg = n.data.config as PlotGroupConfig
          return {
            ...n,
            data: { ...n.data, config: { ...cfg, children: [...cfg.children, ...added] } }
          }
        })
      }))
    },

    removeGroupChildren: (groupId, childIds) => {
      const group = get().nodes.find((n) => n.id === groupId)
      if (!group || !isStep(group) || group.data.kind !== 'plotGroup' || childIds.length === 0)
        return
      const drop = new Set(childIds)
      const remaining = (group.data.config as PlotGroupConfig).children.filter(
        (c) => !drop.has(c.id)
      )
      get().commit()
      if (remaining.length === 0) {
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== groupId),
          edges: s.edges.filter((e) => e.source !== groupId && e.target !== groupId),
          selectedId: s.selectedId === groupId ? null : s.selectedId,
          selectedSub: null
        }))
        return
      }
      set((s) => ({
        selectedSub: remaining[0].id,
        nodes: s.nodes.map((n) =>
          n.id === groupId && isStep(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: { ...(n.data.config as PlotGroupConfig), children: remaining }
                }
              }
            : n
        )
      }))
    },

    removeGroupChild: (groupId, childId) => {
      const group = get().nodes.find((n) => n.id === groupId)
      if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
      const remaining = (group.data.config as PlotGroupConfig).children.filter(
        (c) => c.id !== childId
      )
      get().commit()
      // Last subcard gone → the group has nothing to show; remove the tile entirely.
      if (remaining.length === 0) {
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== groupId),
          edges: s.edges.filter((e) => e.source !== groupId && e.target !== groupId),
          selectedId: s.selectedId === groupId ? null : s.selectedId,
          selectedSub: null
        }))
        return
      }
      set((s) => ({
        selectedSub: remaining[0].id,
        nodes: s.nodes.map((n) =>
          n.id === groupId && isStep(n)
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: { ...(n.data.config as PlotGroupConfig), children: remaining }
                }
              }
            : n
        )
      }))
    },

    moveGroupChild: (groupId, fromId, targetId, place) => {
      if (fromId === targetId) return
      const group = get().nodes.find((n) => n.id === groupId)
      if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
      get().commit()
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (n.id !== groupId || !isStep(n)) return n
          const kids = [...(n.data.config as PlotGroupConfig).children]
          const from = kids.findIndex((c) => c.id === fromId)
          if (from < 0) return n
          const [moved] = kids.splice(from, 1)
          // Target index is computed AFTER removal, so `before`/`after` land in the gap.
          let to = kids.findIndex((c) => c.id === targetId)
          if (to < 0) return n
          if (place === 'after') to += 1
          kids.splice(to, 0, moved)
          return {
            ...n,
            data: { ...n.data, config: { ...(n.data.config as PlotGroupConfig), children: kids } }
          }
        })
      }))
    },

    setGroupsCollapsed: (ids, collapsed) => {
      const want = new Set(ids)
      const hits = get().nodes.filter(
        (n) =>
          want.has(n.id) &&
          isStep(n) &&
          n.data.kind === 'plotGroup' &&
          !!(n.data.config as PlotGroupConfig).collapsed !== collapsed
      )
      if (!hits.length) return
      get().commit()
      const ok = new Set(hits.map((n) => n.id))
      // Folding or unfolding changes the tile's height, so bring it to the front of its neighbours.
      lift(ok)
      set((s) => ({
        nodes: elevate(
          s.nodes.map((n) =>
            ok.has(n.id) && isStep(n)
              ? { ...n, data: { ...n.data, config: { ...n.data.config, collapsed } as NodeConfig } }
              : n
          ),
          s.selectedId
        )
      }))
    },

    tidyNodes: (ids) => {
      const sel = ids
        .map((id) => get().nodes.find((n) => n.id === id))
        .filter((n): n is StepNode => !!n && isStep(n))
      if (sel.length < 2) return
      get().commit()
      // Height as last drawn; one never drawn on the canvas (made in the form) is estimated — a
      // plot group grows a row per plot.
      const height = (n: StepNode): number =>
        n.measured?.height ??
        120 +
          (n.data.kind === 'plotGroup'
            ? ((n.data.config as PlotGroupConfig).children?.length ?? 0) * 30
            : 0)
      const pos = tidyLayout(
        sel.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, h: height(n) })),
        get().edges
      )
      set((s) => ({
        nodes: s.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n))
      }))
    },

    cascadeNodes: (ids) => {
      const sel = ids
        .map((id) => get().nodes.find((n) => n.id === id))
        .filter((n): n is StepNode => !!n && isStep(n))
      if (sel.length < 2) return
      get().commit()
      const x0 = Math.min(...sel.map((n) => n.position.x))
      const y0 = Math.min(...sel.map((n) => n.position.y))
      // Keep current visual order (top→bottom, then left→right) so the cascade feels stable.
      const ordered = [...sel].sort(
        (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
      )
      // Same tight cascade the ungroup spread uses (see ungroupNodes: i*28 / i*46).
      const pos = new Map(ordered.map((n, i) => [n.id, { x: x0 + i * 28, y: y0 + i * 46 }]))
      set((s) => ({
        nodes: s.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n))
      }))
    },

    changeOp: (id, op) => {
      const node = get().nodes.find((n) => n.id === id)
      if (!node || !isStep(node) || node.data.kind === op) return
      get().commit()
      // reset the node to the new op with its default config (category is derived from op)
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? {
                ...n,
                data: { kind: op, config: startingConfig(op), status: 'idle', error: undefined }
              }
            : n
        )
      }))
      const results = { ...get().results }
      delete results[id]
      set({ results })
      // prune edges no longer type-valid for the new op (either direction)
      // (as wired: a Subset's output depends on what feeds it — wiredKindOf)
      const opOf = (nid: string): NodeKind | undefined => wiredKindOf(get(), nid)
      set((s) => ({
        edges: s.edges.filter((e) => {
          if (e.target === id) {
            const so = opOf(e.source)
            return !!so && canConnect(so, op)
          }
          if (e.source === id) {
            const n = get().nodes.find((x) => x.id === e.target)
            const self = wiredKindOf(get(), id)
            return !!n && isStep(n) && !!self && canConnect(self, n.data.kind)
          }
          return true
        })
      }))
      get().invalidateDownstream(id)
    }
  }
}
