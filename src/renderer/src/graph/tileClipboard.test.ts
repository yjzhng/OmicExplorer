import { describe, expect, it } from 'vitest'

import { copyTiles, parseClip, pasteTiles } from './tileClipboard'
import type { CanvasFrame, GraphNode, NodeKind, PanelLayoutItem } from './types'

const step = (id: string, kind: NodeKind, x: number, y: number, config = {}): GraphNode => ({
  id,
  type: 'step',
  position: { x, y },
  data: { kind, config, status: 'done' }
})

const nodes: GraphNode[] = [
  step('load-1', 'load', 0, 0),
  step('std-2', 'standardize', 300, 0),
  step('compare-3', 'compare', 600, 0),
  step('contrast-4', 'contrast', 900, 0, { pairA: 'compare-3', pairB: 'compare-9' }),
  step('plotGroup-5', 'plotGroup', 1200, 100, {
    children: [{ id: 'sub-6', kind: 'volcano', config: { top: 5 } }]
  })
]
const edges = [
  { id: 'e-load-1-std-2', source: 'load-1', target: 'std-2' },
  { id: 'e-std-2-compare-3', source: 'std-2', target: 'compare-3' },
  { id: 'e-compare-3-contrast-4', source: 'compare-3', target: 'contrast-4' },
  { id: 'e-compare-3-plotGroup-5', source: 'compare-3', target: 'plotGroup-5' }
]
const frames: CanvasFrame[] = [
  { id: 'frame-7', label: 'Stats', members: ['compare-3', 'contrast-4'] },
  { id: 'frame-8', label: 'Input', members: ['load-1', 'std-2'] }
]
const groupLayouts: Record<string, PanelLayoutItem[]> = {
  'plotGroup-5': [{ i: 'plotGroup-5::sub-6', x: 0, y: 0, w: 6, h: 4 }]
}
const g = { nodes, edges, frames, groupLayouts }

describe('tile clipboard', () => {
  it('copies the links among the tiles and only whole groups', () => {
    const clip = copyTiles(g, ['std-2', 'compare-3', 'contrast-4'], null, 'here')!
    expect(clip.nodes.map((n) => n.id)).toEqual(['std-2', 'compare-3', 'contrast-4'])
    // load-1 → std-2 and compare-3 → plotGroup-5 reach tiles left out
    expect(clip.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      'std-2>compare-3',
      'compare-3>contrast-4'
    ])
    // Input holds load-1, not copied
    expect(clip.frames.map((f) => f.id)).toEqual(['frame-7'])
  })

  it('pastes under fresh ids, not run, at the given corner', () => {
    const clip = parseClip(
      JSON.stringify(copyTiles(g, ['compare-3', 'contrast-4', 'plotGroup-5'], null, 'here'))
    )!
    const taken = new Set([...nodes.map((n) => n.id), 'sub-6', 'frame-7', 'frame-8'])
    const p = pasteTiles(clip, { taken, nextId: 9 }, { x: 10, y: 20 })
    const ids = p.nodes.map((n) => n.id)
    expect(ids.every((id) => !nodes.some((n) => n.id === id))).toBe(true)
    expect(new Set(ids).size).toBe(3)
    expect(p.nodes.every((n) => n.data.status === 'idle' && n.selected)).toBe(true)
    // the corner (600, 0) moves to (10, 20); the rest keep their places relative to it
    expect(p.nodes.map((n) => n.position)).toEqual([
      { x: 10, y: 20 },
      { x: 310, y: 20 },
      { x: 610, y: 120 }
    ])
    const [cmp, ctr, grp] = ids
    expect(p.edges.map((e) => `${e.source}>${e.target}`)).toEqual([
      `${cmp}>${ctr}`,
      `${cmp}>${grp}`
    ])
    // the copied input is remapped; one not copied is dropped (falls back to the wiring)
    const cfg = p.nodes[1].data.config as Record<string, unknown>
    expect(cfg.pairA).toBe(cmp)
    expect('pairB' in cfg).toBe(false)
    // the group's plot gets a fresh id and its layout follows
    const child = (p.nodes[2].data.config as { children: { id: string }[] }).children[0].id
    expect(child).not.toBe('sub-6')
    expect(p.layouts[grp]).toEqual([{ i: `${grp}::${child}`, x: 0, y: 0, w: 6, h: 4 }])
    expect(p.frames).toEqual([
      { id: expect.stringMatching(/^frame-/), label: 'Stats', members: [cmp, ctr] }
    ])
    expect(taken.has(p.frames[0].id)).toBe(true)
    // the copy is untouched (pasting it twice gives two independent sets)
    expect(clip.nodes[1].config).toEqual({ pairA: 'compare-3', pairB: 'compare-9' })
  })

  it('reads back only a copy of ours', () => {
    expect(parseClip('hello')).toBeNull()
    expect(parseClip('{"format":"omicexplorer/tiles","v":2,"nodes":[{}]}')).toBeNull()
    expect(parseClip('{"format":"omicexplorer/tiles"')).toBeNull()
    expect(copyTiles(g, ['frame-7'], null, null)).toBeNull()
  })
})
