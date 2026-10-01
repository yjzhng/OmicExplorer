/** Page derivation for the paged results view: which panels become pages, in what order. */
import { describe, expect, it } from 'vitest'

import { derivePages } from './pages'
import type { GraphNode, NodeKind, PlotChild } from '../graph/types'

const node = (id: string, kind: NodeKind, config: Record<string, unknown> = {}): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, category: 'plotting', status: 'done', config }
  }) as unknown as GraphNode
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

describe('derivePages', () => {
  it('turns each plot into a page and leaves processing steps out', () => {
    const nodes = [
      node('s1', 'standardize'),
      node('c1', 'compare'),
      node('v1', 'volcano'),
      node('h1', 'heatmap')
    ]
    const edges = [edge('s1', 'c1'), edge('c1', 'v1'), edge('c1', 'h1')]
    const pages = derivePages(nodes, edges as never)
    // Clean data and Compare root analyses; they are not plots, so they get no page of their own.
    expect(pages.map((p) => p.panelId)).toEqual(['v1', 'h1'])
    expect(pages.map((p) => p.title)).toEqual(['Volcano', 'Heatmap'])
    // Every page names the analysis it belongs to, which is what the kicker and jump list show.
    expect(new Set(pages.map((p) => p.groupId))).toEqual(new Set(['c1']))
    // Matches the dashboard's tab label exactly — the same analysis reads the same in both layouts.
    expect(pages[0].groupLabel).toBe('Compare')
  })

  it('expands a plot group into one page per child', () => {
    const children: PlotChild[] = [
      { id: 'a', kind: 'volcano', config: {} },
      { id: 'b', kind: 'ma', config: {} }
    ] as PlotChild[]
    const nodes = [node('c1', 'compare'), node('g1', 'plotGroup', { children })]
    const pages = derivePages(nodes, [edge('c1', 'g1')] as never)
    expect(pages).toHaveLength(2)
    expect(pages.map((p) => p.title)).toEqual(['Volcano', 'MA'])
    // The group tile itself is never a page — only its children are.
    expect(pages.map((p) => p.panelId)).not.toContain('g1')
  })

  it('titles a dose/time-response page by its axis, as the tile does', () => {
    const nodes = [node('c1', 'compare'), node('d1', 'dr', { axis: 'time' })]
    expect(derivePages(nodes, [edge('c1', 'd1')] as never)[0].title).toBe('Time-response')
  })

  it('keeps each analysis contiguous, so the nav heads it once', () => {
    // The left nav starts a new heading whenever the group id changes from the previous page, so
    // interleaved groups would print the same heading several times.
    const nodes = [
      node('s1', 'standardize'),
      node('c1', 'compare'),
      node('v1', 'volcano'),
      node('c2', 'compare'),
      node('v2', 'volcano'),
      node('h1', 'heatmap'),
      node('h2', 'heatmap')
    ]
    const edges = [
      edge('s1', 'c1'),
      edge('s1', 'c2'),
      edge('c1', 'v1'),
      edge('c2', 'v2'),
      edge('c1', 'h1'),
      edge('c2', 'h2')
    ]
    const groups = derivePages(nodes, edges as never).map((p) => p.groupId)
    const firstSeen = groups.filter((g, i) => groups.indexOf(g) === i)
    // Every group appears as one unbroken run.
    expect(groups.join(',')).toBe(
      firstSeen.map((g) => groups.filter((x) => x === g).join(',')).join(',')
    )
    expect(firstSeen).toHaveLength(2)
  })

  it('shows a renamed step by its name, in both the page and its nav heading', () => {
    const nodes = [
      {
        ...node('c1', 'compare'),
        data: { ...node('c1', 'compare').data, name: 'Drug vs vehicle' }
      },
      { ...node('v1', 'volcano'), data: { ...node('v1', 'volcano').data, name: 'Key hits' } }
    ] as GraphNode[]
    const pages = derivePages(nodes, [edge('c1', 'v1')] as never)
    expect(pages[0].title).toBe('Key hits')
    expect(pages[0].groupLabel).toBe('Drug vs vehicle')
  })

  it('falls back to the type label when a name is blank or absent', () => {
    const blank = [
      { ...node('c1', 'compare'), data: { ...node('c1', 'compare').data, name: '   ' } },
      node('v1', 'volcano')
    ] as GraphNode[]
    const pages = derivePages(blank, [edge('c1', 'v1')] as never)
    expect(pages[0].title).toBe('Volcano')
    expect(pages[0].groupLabel).toBe('Compare')
  })

  it('has no pages for a pipeline that is all processing', () => {
    const nodes = [node('l1', 'load'), node('s1', 'standardize')]
    expect(derivePages(nodes, [edge('l1', 's1')] as never)).toEqual([])
    expect(derivePages([], [])).toEqual([])
  })
})
