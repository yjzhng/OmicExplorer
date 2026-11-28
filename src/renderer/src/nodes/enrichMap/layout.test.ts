import { describe, expect, it } from 'vitest'
import {
  buildMap,
  edgeOrder,
  inversions,
  layoutMap,
  moduleNodeId,
  termNodeId,
  type MapTermIn
} from './layout'

const t = (term: string, genes: string, category?: string): MapTermIn => ({
  term,
  genes: genes.split(''),
  pAdjust: 0.01,
  direction: 'up',
  category
})

describe('buildMap', () => {
  it('flows levels → terms → modules, nodes as big as their genes', () => {
    const g = buildMap({
      terms: [t('Glycolysis', 'abcd', 'Metabolism'), t('TCA', 'cdef', 'Metabolism')],
      levels: ['category', 'group'],
      paths: new Map([
        ['Glycolysis', [['Metabolism', 'Carbohydrate']]],
        ['TCA', [['Metabolism', 'Carbohydrate']]]
      ]),
      modules: new Map([
        ['Glycolysis', 'Glycolysis (2)'],
        ['TCA', 'Glycolysis (2)']
      ])
    })
    expect(g.columns).toBe(4)
    const m = g.nodes.get(moduleNodeId('Glycolysis (2)'))!
    expect(m.genes.length).toBe(6)
    expect(m.parents).toEqual([termNodeId('Glycolysis'), termNodeId('TCA')])
    expect(g.nodes.get(termNodeId('TCA'))!.parents).toEqual(['L1:Carbohydrate'])
    expect(g.nodes.get('L0:Metabolism')!.col).toBe(0)
    expect(g.nodes.get(termNodeId('TCA'))!.col).toBe(2)
    expect(m.col).toBe(3)
  })

  it('a term filed under two groups takes a ribbon from each', () => {
    const g = buildMap({
      terms: [t('X', 'abcdefgh')],
      levels: ['category', 'group'],
      paths: new Map([
        [
          'X',
          [
            ['C', 'G1'],
            ['C', 'G2']
          ]
        ]
      ])
    })
    const into = g.links.filter((l) => l.target === termNodeId('X'))
    expect(into.map((l) => l.genes.length)).toEqual([8, 8])
    layoutMap(g, { width: 400, height: 300, nodeW: 10, gap: 6, minSlot: 12 })
    const x = g.nodes.get(termNodeId('X'))!
    // both arrive over the whole node: they overlap, not stack
    for (const l of into) {
      expect(l.tgt).toHaveLength(1)
      expect(l.tgt[0].a).toBeCloseTo(x.y0)
      expect(l.tgt[0].b).toBeCloseTo(x.y1)
    }
  })

  it('a GO term inside an enriched ancestor flows from it, not again from the aspect', () => {
    const g = buildMap({
      terms: [t('metabolic process', 'abcdef', 'BP'), t('glycolytic process', 'abc', 'BP')],
      levels: ['aspect'],
      paths: new Map([
        ['metabolic process', [['BP']]],
        ['glycolytic process', [['BP']]]
      ]),
      ancestors: { 'glycolytic process': ['metabolic process'] }
    })
    const child = g.nodes.get(termNodeId('glycolytic process'))!
    expect(child.parents).toEqual([termNodeId('metabolic process')])
    // the ancestor sits a column before its child, the child at the far right
    expect(g.nodes.get(termNodeId('metabolic process'))!.col).toBe(1)
    expect(child.col).toBe(2)
  })

  it("a child's genes its ancestor lacks still arrive, from the child's own parent", () => {
    const g = buildMap({
      terms: [t('parent', 'ab', 'BP'), t('child', 'abcd', 'BP')],
      levels: ['aspect'],
      paths: new Map([
        ['parent', [['BP']]],
        ['child', [['BP']]]
      ]),
      ancestors: { child: ['parent'] }
    })
    const into = g.links.filter((l) => l.target === termNodeId('child'))
    expect(into.map((l) => [l.source, l.genes.join('')]).sort()).toEqual([
      ['L0:BP', 'cd'],
      [termNodeId('parent'), 'ab']
    ])
  })
})

describe('buildMap columns', () => {
  it('the modules sit right of every term, an ancestor in a term column before its child', () => {
    const g = buildMap({
      terms: [
        t('cytosol', 'abcdefgh', 'CC'),
        t('cytoplasm', 'abxy', 'CC'),
        t('pore', 'pq', 'CC'),
        t('channel', 'pqr', 'CC')
      ],
      levels: ['aspect'],
      paths: new Map(['cytosol', 'cytoplasm', 'pore', 'channel'].map((n) => [n, [['CC']]])),
      modules: new Map([
        ['pore', 'pore (2)'],
        ['channel', 'pore (2)']
      ]),
      ancestors: { cytosol: ['cytoplasm'] }
    })
    // aspect | cytoplasm | cytosol, pore, channel | the module
    expect(g.nodes.get(termNodeId('cytoplasm'))!.col).toBe(1)
    expect(g.nodes.get(termNodeId('cytosol'))!.col).toBe(2)
    expect(g.nodes.get(termNodeId('pore'))!.col).toBe(2)
    expect(g.nodes.get(moduleNodeId('pore (2)'))!.col).toBe(3)
    expect(g.columns).toBe(4)
  })

  it('an ancestor sits just before its nearest child, with nothing between them', () => {
    const g = buildMap({
      terms: [t('a', 'abcd', 'BP'), t('b', 'abc', 'BP'), t('c', 'ab', 'BP'), t('d', 'ax', 'BP')],
      levels: ['aspect'],
      paths: new Map(['a', 'b', 'c', 'd'].map((n) => [n, [['BP']]])),
      // a ⊃ b ⊃ c, and a ⊃ d directly
      ancestors: { b: ['a'], c: ['a', 'b'], d: ['a'] }
    })
    const col = (n: string): number => g.nodes.get(termNodeId(n))!.col
    expect([col('a'), col('b'), col('c'), col('d')]).toEqual([1, 2, 3, 3])
  })
  it("an enriched ancestor sharing none of its child's genes is not nested: no stranded column", () => {
    const g = buildMap({
      // annotation lists name the specific term: membrane's hits aren't its child's
      terms: [t('membrane', 'abc', 'CC'), t('transporter complex', 'xy', 'CC')],
      levels: ['aspect'],
      paths: new Map(['membrane', 'transporter complex'].map((n) => [n, [['CC']]])),
      ancestors: { 'transporter complex': ['membrane'] }
    })
    expect(g.nodes.get(termNodeId('transporter complex'))!.parents).toEqual(['L0:CC'])
    expect(g.nodes.get(termNodeId('membrane'))!.col).toBe(1)
    expect(g.columns).toBe(2)
  })
})

describe('gene order', () => {
  it("a node's genes that also go to a lower node sit at its bottom, so that ribbon leaves from there", () => {
    const g = buildMap({
      // ligase's genes are in cytosol too, and in a term ranked above both
      terms: [
        t('aminoacylation', 'ab', 'BP'),
        t('cytosol', 'abcdefgh', 'CC'),
        t('ligase', 'ab', 'CC')
      ],
      levels: ['aspect'],
      paths: new Map([
        ['aminoacylation', [['BP']]],
        ['cytosol', [['CC']]],
        ['ligase', [['CC']]]
      ])
    })
    layoutMap(g, { width: 400, height: 300, nodeW: 10, gap: 6, minSlot: 12 })
    const cc = g.nodes.get('L0:CC')!
    const cytosol = g.nodes.get(termNodeId('cytosol'))!
    const ligase = g.nodes.get(termNodeId('ligase'))!
    expect(cytosol.y0).toBeLessThan(ligase.y0)
    const toLigase = g.links.find((l) => l.source === 'L0:CC' && l.target === termNodeId('ligase'))!
    // it leaves from the bottom of the category, not the top
    expect(toLigase.src[toLigase.src.length - 1].b).toBeCloseTo(cc.y1)
  })
  it("a ribbon isn't split just to move its middle toward where it goes", () => {
    // membrane shares a, b with periplasm (above) and has c of its own; its node sits below the big
    // cytosol, which would rather c went to the bottom — a fork right across the edge
    const cytosol = Array.from({ length: 40 }, (_, i) => `k${i}`)
    const order = edgeOrder(
      ['a', 'b', 'c', ...cytosol],
      [
        { genes: new Set(['a', 'b']), at: 0 },
        { genes: new Set(cytosol), at: 50 },
        { genes: new Set(['a', 'b', 'c']), at: 100 }
      ],
      true
    )
    const at = ['a', 'b', 'c'].map((x) => order.indexOf(x)).sort((x, y) => x - y)
    expect(at[2] - at[0]).toBe(2)
  })
})

describe('overlap that no order untangles', () => {
  // three terms, each sharing a gene with the other two: no order of the category's genes keeps
  // every ribbon in one piece
  const cyclic = () =>
    buildMap({
      terms: [t('x', 'ac', 'P'), t('y', 'ab', 'P'), t('z', 'bc', 'P')],
      levels: ['category'],
      paths: new Map(['x', 'y', 'z'].map((n) => [n, [['P']]]))
    })
  const fromP = (g: ReturnType<typeof buildMap>) => g.links.filter((l) => l.source === 'L0:P')

  it('split: one ribbon leaves in strands, one off each of its genes, and every gene is covered', () => {
    const g = cyclic()
    layoutMap(g, { width: 400, height: 300, nodeW: 10, gap: 6, minSlot: 12, fallback: 'split' })
    expect(fromP(g).filter((l) => l.src.length > 1)).toHaveLength(1)
    const p = g.nodes.get('L0:P')!
    const per = (p.y1 - p.y0) / p.genes.length
    for (let i = 0; i < p.genes.length; i++) {
      const mid = p.y0 + (i + 0.5) * per
      // each gene is in two of the three terms: two ribbons leave its place
      const off = fromP(g).filter((l) => l.src.some((st) => st.a <= mid && mid <= st.b))
      expect(off).toHaveLength(2)
    }
  })

  it("stack: that edge's ribbons are stacked in one piece each, filling the bar exactly", () => {
    const g = cyclic()
    layoutMap(g, { width: 400, height: 300, nodeW: 10, gap: 6, minSlot: 12, fallback: 'stack' })
    const p = g.nodes.get('L0:P')!
    const ls = fromP(g).sort((a, b) => a.src[0].a - b.src[0].a)
    for (const l of ls) expect(l.src).toHaveLength(1)
    expect(ls[0].src[0].a).toBeCloseTo(p.y0)
    expect(ls[ls.length - 1].src[0].b).toBeCloseTo(p.y1)
    for (let i = 1; i < ls.length; i++) expect(ls[i].src[0].a).toBeCloseTo(ls[i - 1].src[0].b)
  })

  it('split: the pieces gather at one end of the bar, a big ribbon giving way for a small one', () => {
    // A and B overlap; C takes a gene of each (one only A's, one only B's) and two of its own — C
    // can't sit whole beside both, so one ribbon must split
    const a = 'abcdefghijklmnopqrst'
    const b = 'pqrstuvwxyzABCDEFGHI'
    const g = buildMap({
      terms: [t('A', a, 'P'), t('B', b, 'P'), t('C', 'aIJK', 'P')],
      levels: ['category'],
      paths: new Map(['A', 'B', 'C'].map((n) => [n, [['P']]]))
    })
    layoutMap(g, { width: 400, height: 300, nodeW: 10, gap: 6, minSlot: 12, fallback: 'split' })
    const p = g.nodes.get('L0:P')!
    const c = fromP(g).find((l) => l.target === termNodeId('C'))!
    expect(c.src).toHaveLength(1)
    // whichever ribbon gave way, its smaller piece is at the top or bottom of the bar
    const split = fromP(g).filter((l) => l.src.length > 1)
    expect(split.length).toBeGreaterThan(0)
    for (const l of split) {
      const small = [...l.src].sort((x, y) => x.b - x.a - (y.b - y.a))[0]
      expect(Math.min(Math.abs(small.a - p.y0), Math.abs(small.b - p.y1))).toBeLessThan(
        (c.src[0].b - c.src[0].a) * 2
      )
    }
  })

  it('an edge that can be untangled is, whichever the fallback', () => {
    const g = buildMap({
      terms: [t('a', 'abcd', 'P'), t('b', 'cdef', 'P'), t('c', 'efgh', 'P')],
      levels: ['category'],
      paths: new Map(['a', 'b', 'c'].map((n) => [n, [['P']]]))
    })
    layoutMap(g, { width: 400, height: 300, nodeW: 10, gap: 6, minSlot: 12, fallback: 'split' })
    for (const l of fromP(g)) expect(l.src).toHaveLength(1)
  })
})

describe('layoutMap', () => {
  it('fits the columns to the height, at least a label line each', () => {
    const g = buildMap({
      terms: [t('A', 'abcdefghij', 'P'), t('B', 'k', 'Q')],
      levels: ['category'],
      paths: new Map([
        ['A', [['P']]],
        ['B', [['Q']]]
      ])
    })
    const geo = layoutMap(g, { width: 300, height: 200, nodeW: 10, gap: 6, minSlot: 12 })
    expect(geo.height).toBe(200)
    const a = g.nodes.get(termNodeId('A'))!
    const b = g.nodes.get(termNodeId('B'))!
    expect(a.y1 - a.y0).toBeCloseTo(10 * geo.scale)
    // B's one gene is drawn small but holds a label's line
    expect(Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)).toBeGreaterThanOrEqual(12)
  })
  it("where the labels can't fit, the bars keep a scale and the map grows instead", () => {
    // forty one-gene terms and one big one: their label lines alone overflow 200px
    const names = Array.from({ length: 40 }, (_, i) => `s${i}`)
    const g = buildMap({
      terms: [
        t('big', 'ABCDEFGHIJKLMNOPQRST', 'P'),
        ...names.map((n, i) => t(n, String.fromCharCode(0x100 + i), 'P'))
      ],
      levels: ['category'],
      paths: new Map(['big', ...names].map((n) => [n, [['P']]]))
    })
    const geo = layoutMap(g, { width: 300, height: 200, nodeW: 10, gap: 6, minSlot: 12 })
    const big = g.nodes.get(termNodeId('big'))!
    // the column's genes get half the visible height between them, at least
    expect(geo.scale * (20 + 40)).toBeGreaterThanOrEqual(100 - 1e-6)
    expect(big.y1 - big.y0).toBeCloseTo(20 * geo.scale)
    expect(geo.height).toBeGreaterThan(200)
  })
})

describe('inversions', () => {
  it('matches counting every pair', () => {
    let seed = 7
    const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let trial = 0; trial < 20; trial++) {
      const n = 2 + Math.floor(rnd() * 30)
      const p = Array.from({ length: n }, () => Math.floor(rnd() * 10))
      const q = Array.from({ length: n }, () => Math.floor(rnd() * 10))
      const a = Array.from({ length: n }, () => rnd())
      let fast = 0
      inversions(p, q, a, (j, sum) => (fast += sum * a[j]))
      let slow = 0
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) if (p[i] < p[j] && q[i] > q[j]) slow += a[i] * a[j]
      expect(fast).toBeCloseTo(slow)
    }
  })
})
