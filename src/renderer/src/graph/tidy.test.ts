/** Tidy: a left-to-right layered layout of a canvas selection. */
import { describe, expect, it } from 'vitest'

import { TIDY_COL, TIDY_GAP, tidyLayout, type TidyNode } from './tidy'

const node = (id: string, x = 0, y = 0, h = 100): TidyNode => ({ id, x, y, h })

describe('tidyLayout', () => {
  it('puts a chain on one row, one column per step, from the selection’s top-left', () => {
    // stacked vertically, as the form used to place them
    const nodes = [node('load', 120, 0), node('clean', 120, 140), node('cmp', 120, 280)]
    // (a chain: each level centred on its single daughter of the same height = one row)
    const pos = tidyLayout(nodes, [
      { source: 'load', target: 'clean' },
      { source: 'clean', target: 'cmp' }
    ])
    expect(pos.get('load')).toEqual({ x: 120, y: 0 })
    expect(pos.get('clean')).toEqual({ x: 120 + TIDY_COL, y: 0 })
    expect(pos.get('cmp')).toEqual({ x: 120 + 2 * TIDY_COL, y: 0 })
  })

  it('stacks a fan-out in the next column without overlap', () => {
    const nodes = [node('cmp'), node('a', 0, 10, 80), node('b', 0, 20, 120), node('c', 0, 30)]
    const pos = tidyLayout(
      nodes,
      ['a', 'b', 'c'].map((t) => ({ source: 'cmp', target: t }))
    )
    const col = ['a', 'b', 'c'].map((id) => pos.get(id)!)
    expect(new Set(col.map((p) => p.x))).toEqual(new Set([TIDY_COL]))
    // in their previous order, each below the one before by its height + the gap
    expect(col[1].y).toBe(col[0].y + 80 + TIDY_GAP)
    expect(col[2].y).toBe(col[1].y + 120 + TIDY_GAP)
    // the source is centred vertically on its daughters
    const top = col[0].y
    const bottom = col[2].y + 100
    expect(pos.get('cmp')!.y + 50).toBe((top + bottom) / 2)
  })

  it('centres each level on its daughters, worked up from the leaves', () => {
    // load → clean → {cmpA → {p1, p2}, cmpB → p3}
    const nodes = ['load', 'clean', 'cmpA', 'cmpB', 'p1', 'p2', 'p3'].map((id, i) =>
      node(id, 0, i * 10)
    )
    const pos = tidyLayout(nodes, [
      { source: 'load', target: 'clean' },
      { source: 'clean', target: 'cmpA' },
      { source: 'clean', target: 'cmpB' },
      { source: 'cmpA', target: 'p1' },
      { source: 'cmpA', target: 'p2' },
      { source: 'cmpB', target: 'p3' }
    ])
    const y = (id: string): number => pos.get(id)!.y
    const mid = (a: string, b: string): number => (y(a) + y(b)) / 2
    expect(y('cmpA')).toBe(mid('p1', 'p2'))
    expect(y('cmpB')).toBe(y('p3'))
    expect(y('clean')).toBe(mid('cmpA', 'cmpB'))
    expect(y('load')).toBe(y('clean'))
    // subtrees don't overlap
    expect(y('p3')).toBeGreaterThanOrEqual(y('p2') + 100 + TIDY_GAP)
  })

  it('places a tile by its deepest input, so every edge runs left to right', () => {
    const nodes = [node('s'), node('m'), node('t')]
    const pos = tidyLayout(nodes, [
      { source: 's', target: 'm' },
      { source: 'm', target: 't' },
      { source: 's', target: 't' }
    ])
    expect(pos.get('t')!.x).toBe(2 * TIDY_COL)
  })

  it('orders a column to follow its inputs (fewer crossings)', () => {
    // two chains whose second steps start in the crossed order
    const nodes = [node('a1', 0, 0), node('b1', 0, 200), node('b2', 0, 50), node('a2', 0, 300)]
    const pos = tidyLayout(nodes, [
      { source: 'a1', target: 'a2' },
      { source: 'b1', target: 'b2' }
    ])
    expect(pos.get('a2')!.y).toBeLessThan(pos.get('b2')!.y)
  })

  it('tucks a short branch up beside a neighbour whose leaves sit further right', () => {
    // P → X → x1..x4 (a fan one column further), and P → Y (a leaf in X's column)
    const nodes = ['P', 'X', 'Y', 'x1', 'x2', 'x3', 'x4'].map((id, i) => node(id, 0, i))
    const pos = tidyLayout(nodes, [
      { source: 'P', target: 'X' },
      { source: 'P', target: 'Y' },
      ...['x1', 'x2', 'x3', 'x4'].map((t) => ({ source: 'X', target: t }))
    ])
    const y = (id: string): number => pos.get(id)!.y
    // Y only has to clear X (its own column), not X's four leaves: the two sit one gap apart,
    // with Y level with part of X's fan rather than past its end
    expect(Math.abs(y('Y') - y('X'))).toBe(100 + TIDY_GAP)
    expect(y('Y')).toBeGreaterThan(y('x1'))
    expect(y('Y')).toBeLessThan(y('x4'))
    // X is still centred on its leaves, and P on its immediate daughters X and Y
    expect(y('X')).toBe((y('x1') + y('x4')) / 2)
    expect(y('P')).toBe((y('X') + y('Y')) / 2)
  })

  it('stacks loose tiles in the first column, right under its lowest tile', () => {
    // a source fanning out to three tall plots, plus two unconnected tiles placed first
    const nodes = [
      node('loose1', 0, -100),
      node('src', 0, 0),
      node('p1', 0, 10, 200),
      node('p2', 0, 20, 200),
      node('p3', 0, 30, 200),
      node('loose2', 0, 500)
    ]
    const pos = tidyLayout(
      nodes,
      ['p1', 'p2', 'p3'].map((t) => ({ source: 'src', target: t }))
    )
    const src = pos.get('src')!
    expect(pos.get('loose1')).toEqual({ x: src.x, y: src.y + 100 + TIDY_GAP })
    expect(pos.get('loose2')).toEqual({ x: src.x, y: src.y + 2 * (100 + TIDY_GAP) })
    // the connected tree still starts at the top
    expect(pos.get('p1')!.y).toBe(-100)
  })

  it('ignores edges to tiles outside the selection', () => {
    const pos = tidyLayout([node('x', 50, 60)], [{ source: 'outside', target: 'x' }])
    expect(pos.get('x')).toEqual({ x: 50, y: 60 })
  })
})
