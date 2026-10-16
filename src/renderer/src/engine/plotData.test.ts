/**
 * Sanity checks for the plot-data builders. PCA exercises the Jacobi eigensolver:
 * two clearly separated sample groups must split along PC1.
 */
import { describe, expect, it } from 'vitest'

import { jacobiEigenSymmetric } from './stats'
import {
  buildCluster,
  buildResponseCluster,
  buildMA,
  buildDumbbell,
  thinPoints,
  buildBubble,
  buildTdr,
  buildGeneBar,
  buildDR,
  buildHeatmap,
  buildQc,
  pickBalanced,
  sortSamples,
  type SampleMeta
} from './plotData'
import type {
  CompareResultRow,
  ContrastResultRow,
  SampleConds,
  StandardizeResult,
  StandardRow
} from './types'

const cmp = (over: Partial<CompareResultRow>): CompareResultRow => ({
  uniqID: 'g1',
  cmpd: 'A',
  dose: null,
  time: null,
  cmp_cond: 'cmpd',
  comparison: 'A | DMSO',
  mean1: null,
  mean2: null,
  sd1: null,
  sd2: null,
  log2FC: 0,
  pP: null,
  pQ: null,
  thrsh: '',
  signf: false,
  effect: 'none',
  ...over
})

describe('jacobiEigenSymmetric', () => {
  it('diagonalizes a symmetric matrix', () => {
    const { values } = jacobiEigenSymmetric([
      [2, 1],
      [1, 2]
    ])
    // eigenvalues of [[2,1],[1,2]] are 3 and 1
    expect(values.map((v) => Math.round(v * 1e6) / 1e6).sort((a, b) => a - b)).toEqual([1, 3])
  })
})

describe('buildCluster (PCA)', () => {
  const S = (cmpd: string, rep: number, g1: number, g2: number): StandardRow[] => [
    { uniqID: 'g1', cell: '', cmpd, dose: null, time: null, rep, value: g1 },
    { uniqID: 'g2', cell: '', cmpd, dose: null, time: null, rep, value: g2 }
  ]
  const rows: StandardRow[] = [
    ...S('A', 1, 16, 4),
    ...S('A', 2, 18, 4),
    ...S('A', 3, 15, 5),
    ...S('B', 1, 4, 16),
    ...S('B', 2, 5, 18),
    ...S('B', 3, 4, 15)
  ]

  it('separates the two compound groups along PC1', () => {
    const pca = buildCluster(rows, { method: 'pca', colorBy: 'cmpd' })
    expect(pca.points).toHaveLength(6)
    const a = pca.points.filter((p) => p.group === 'A')
    const b = pca.points.filter((p) => p.group === 'B')
    expect(a).toHaveLength(3)
    expect(b).toHaveLength(3)
    // the two groups sit on opposite sides of PC1
    const meanAx = a.reduce((s, p) => s + p.x, 0) / a.length
    const meanBx = b.reduce((s, p) => s + p.x, 0) / b.length
    expect(Math.sign(meanAx)).toBe(-Math.sign(meanBx))
    // PC1 is the leading component (per-gene z-scoring redistributes variance, so it no
    // longer swamps the total the way the un-scaled embedding did).
    expect(pca.varExplained[0]).toBeGreaterThan(0)
    expect(pca.varExplained[0]).toBeGreaterThanOrEqual(pca.varExplained[1])
  })

  it('produces finite 2-D coords for umap and tsne', () => {
    for (const method of ['umap', 'tsne'] as const) {
      const c = buildCluster(rows, { method, colorBy: 'cmpd' })
      expect(c.method).toBe(method)
      expect(c.points).toHaveLength(6)
      expect(c.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
      expect(c.varExplained).toEqual([0, 0]) // variance explained is PCA-only
    }
  })
})

describe('buildResponseCluster (responsome PCA)', () => {
  // A cell comparison (clpP | WT) — cell is the compared dim, so cmpd/dose are
  // context. Two compounds with opposite log2FC signatures → one point per condition,
  // colored by the context cmpd, separating along PC1. Mirrors omicViz's pca_response.
  const C = (cmpd: string, dose: number, fc1: number, fc2: number): CompareResultRow[] =>
    (['g1', 'g2'] as const).map((uniqID, i) => ({
      uniqID,
      cmpd,
      dose,
      time: null,
      cmp_cond: 'cell',
      comparison: 'clpP | WT',
      mean1: null,
      mean2: null,
      sd1: null,
      sd2: null,
      log2FC: i === 0 ? fc1 : fc2,
      pP: null,
      pQ: null,
      thrsh: '',
      signf: false,
      effect: 'none' as const
    }))
  const rows: CompareResultRow[] = [
    ...C('A', 1, 3, -3),
    ...C('A', 2, 2.5, -2.5),
    ...C('B', 1, -3, 3),
    ...C('B', 2, -2.5, 2.5)
  ]

  it('embeds one point per condition, colored by a context condition', () => {
    const c = buildResponseCluster(rows, { method: 'pca', colorBy: 'cmpd' })
    expect(c.points).toHaveLength(4) // 2 cmpd × 2 dose
    expect(c.colorBy).toBe('cmpd') // cmpd is context here, so it's kept
    expect(new Set(c.points.map((p) => p.group))).toEqual(new Set(['A', 'B']))
    const a = c.points.filter((p) => p.group === 'A')
    const b = c.points.filter((p) => p.group === 'B')
    const meanAx = a.reduce((s, p) => s + p.x, 0) / a.length
    const meanBx = b.reduce((s, p) => s + p.x, 0) / b.length
    expect(Math.sign(meanAx)).toBe(-Math.sign(meanBx))
  })

  it('keeps a comparison dimension that varies across the pooled comparisons', () => {
    // cmpd is the compared dim, but the pool spans two compounds (A, B) — as in a
    // multi-compound two-way ANOVA — so colouring by cmpd is meaningful and is kept.
    const cmpdCmp = rows.map((r) => ({ ...r, cmp_cond: 'cmpd', comparison: `${r.cmpd} | H2O` }))
    const c = buildResponseCluster(cmpdCmp, { method: 'pca', colorBy: 'cmpd' })
    expect(c.colorBy).toBe('cmpd')
    expect(new Set(c.points.map((p) => p.group))).toEqual(new Set(['A', 'B']))
  })

  it('falls back off a comparison dimension that is constant across the pool', () => {
    // A single-compound cmpd-comparison: cmpd is constant, so colouring by it is degenerate
    // and snaps to a varying context condition (dose here) instead of one collapsed series.
    const oneCmpd = rows
      .filter((r) => r.cmpd === 'A')
      .map((r) => ({ ...r, cmp_cond: 'cmpd', comparison: 'A | H2O' }))
    const c = buildResponseCluster(oneCmpd, { method: 'pca', colorBy: 'cmpd' })
    expect(c.colorBy).not.toBe('cmpd')
    expect(['cell', 'dose', 'time']).toContain(c.colorBy)
    expect(new Set(c.points.map((p) => p.group)).size).toBeGreaterThan(1)
  })

  it('produces finite coords for umap and tsne', () => {
    for (const method of ['umap', 'tsne'] as const) {
      const c = buildResponseCluster(rows, { method, colorBy: 'cmpd' })
      expect(c.method).toBe(method)
      expect(c.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    }
  })
})

describe('bubble top genes', () => {
  it('only genes significant at one level or more are top-N candidates', () => {
    const rows = [
      // biggest fold change, but never significant → left out
      cmp({ uniqID: 'big', dose: 1, log2FC: 5 }),
      cmp({ uniqID: 'big', dose: 10, log2FC: 6 }),
      // significant at the low dose only → in
      cmp({ uniqID: 'lowSig', dose: 1, log2FC: 2, signf: true }),
      cmp({ uniqID: 'lowSig', dose: 10, log2FC: 1 }),
      cmp({ uniqID: 'topSig', dose: 10, log2FC: -3, signf: true })
    ]
    const b = buildBubble(rows, { axis: 'dose', topGenes: 0 })
    expect(new Set(b.genes)).toEqual(new Set(['lowSig', 'topSig']))
    // focus genes still show as given, significant or not
    expect(buildBubble(rows, { axis: 'dose', topGenes: 0, focus: ['big'] }).genes).toEqual(['big'])
  })

  it('scores a gene at its peak level, or summed over its levels', () => {
    const rows = [
      // one strong level
      cmp({ uniqID: 'spike', dose: 1, log2FC: 0.2, signf: true }),
      cmp({ uniqID: 'spike', dose: 10, log2FC: 3 }),
      // steady at every level: a smaller peak, a bigger total
      cmp({ uniqID: 'steady', dose: 1, log2FC: 2, signf: true }),
      cmp({ uniqID: 'steady', dose: 10, log2FC: 2 }),
      // up then down: its total cancels
      cmp({ uniqID: 'flip', dose: 1, log2FC: 2.5, signf: true }),
      cmp({ uniqID: 'flip', dose: 10, log2FC: -2.4 })
    ]
    const opts = { axis: 'dose' as const, topGenes: 0 }
    expect(buildBubble(rows, opts).genes).toEqual(['spike', 'flip', 'steady'])
    expect(buildBubble(rows, { ...opts, over: 'total' }).genes).toEqual(['steady', 'spike', 'flip'])
  })

  it('ranks by the significance column when asked, signed by the fold change', () => {
    const rows = [
      // the biggest fold change, but only just significant
      cmp({ uniqID: 'bigFc', dose: 10, log2FC: 4, pQ: 1.4, signf: true }),
      // a smaller fold change, far more significant
      cmp({ uniqID: 'sure', dose: 10, log2FC: 1.5, pQ: 6, signf: true }),
      cmp({ uniqID: 'down', dose: 10, log2FC: -1, pQ: 3, signf: true })
    ]
    const opts = { axis: 'dose' as const, topGenes: 0 }
    expect(buildBubble(rows, opts).genes).toEqual(['bigFc', 'sure', 'down'])
    expect(buildBubble(rows, { ...opts, rank: 'pQ' }).genes).toEqual(['sure', 'bigFc', 'down'])
    // capped at one up gene: the fold-change rank keeps bigFc, the significance rank keeps sure
    const one = { ...opts, topGenes: 2 }
    expect(buildBubble(rows, one).genes).toContain('bigFc')
    expect(buildBubble(rows, { ...one, rank: 'pQ' }).genes).toContain('sure')
  })
})

describe('pickBalanced', () => {
  const side = (prefix: string, n: number, sign: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, signed: sign * (10 - i * 0.1) }))

  it('splits the top N in proportion to each side', () => {
    // 70 up / 30 down → 10 picks split 7:3, even though the down side has the larger magnitudes
    const up = side('u', 70, 1)
    const down = side('d', 30, -1).map((c) => ({ ...c, signed: c.signed * 3 }))
    const got = pickBalanced([...up, ...down], 10)
    expect(got.filter((id) => id.startsWith('u'))).toHaveLength(7)
    expect(got.filter((id) => id.startsWith('d'))).toHaveLength(3)
    // within a side, the largest first
    expect(got).toContain('u0')
    expect(got).toContain('d0')
  })

  it('hands a short side’s slots to the other, and returns everything when N covers it', () => {
    const cands = [...side('u', 2, 1), ...side('d', 1, -1)]
    expect(pickBalanced(cands, 10)).toHaveLength(3)
    // a 1-gene side gives what it has; the rest go to the other side
    const lopsided = [...side('u', 9, 1), ...side('d', 1, -1)]
    const got = pickBalanced(lopsided, 4)
    expect(got.filter((id) => id.startsWith('d'))).toEqual(['d0'])
    expect(got).toHaveLength(4)
  })

  it('gives each side at least a quarter, rounded up', () => {
    // 96:4 of 10 would round to 10:0; the floor keeps ceil(10 / 4) = 3 for down
    const got = pickBalanced([...side('u', 96, 1), ...side('d', 4, -1)], 10)
    expect(got.filter((id) => id.startsWith('d'))).toHaveLength(3)
    expect(got.filter((id) => id.startsWith('u'))).toHaveLength(7)
  })
})

describe('dose-response top genes', () => {
  it('colours significant genes only, split up / down in proportion, at the front', () => {
    const rows: CompareResultRow[] = []
    const gene = (id: string, top: number, signf: boolean) => {
      rows.push(cmp({ uniqID: id, dose: 1, log2FC: top / 2, signf }))
      rows.push(cmp({ uniqID: id, dose: 10, log2FC: top, signf }))
    }
    gene('upA', 3, true)
    gene('upB', 2.5, true)
    gene('upC', 2, true)
    gene('downA', -1, true)
    gene('noise', 9, false) // biggest change, never significant
    const dr = buildDR(rows, { axis: 'dose', topGenes: 2 })
    // 3 up : 1 down of 2 would round to 2:0; the quarter floor keeps one down
    expect(dr.highlight).toBe(2)
    expect(dr.series.slice(0, 2).map((s) => s.uniqID)).toEqual(['upA', 'downA'])
    // every curve is still drawn behind
    expect(dr.series.map((s) => s.uniqID)).toContain('noise')
    const all = buildDR(rows, { axis: 'dose', topGenes: 0 })
    expect(all.highlight).toBe(4)
    expect(all.series.slice(0, 4).map((s) => s.uniqID)).not.toContain('noise')
  })
})

describe('focus genes', () => {
  it('bubble focus shows exactly the focus genes (not top-N)', () => {
    const rows = [
      cmp({ uniqID: 'g1', dose: 1, log2FC: 0.1, signf: true }),
      cmp({ uniqID: 'g2', dose: 1, log2FC: 3, signf: true }),
      cmp({ uniqID: 'g3', dose: 1, log2FC: -2, signf: true })
    ]
    const all = buildBubble(rows, { axis: 'dose', topGenes: 0 })
    expect(all.genes.length).toBe(3)
    const focused = buildBubble(rows, { axis: 'dose', topGenes: 0, focus: ['g1'] })
    expect(focused.genes.length).toBe(1)
    expect(focused.points.every((p) => p.uniqID === 'g1')).toBe(true)
  })

  it('bubble appends `extra` genes after the base set, without reshuffling it', () => {
    const rows = [
      cmp({ uniqID: 'g1', dose: 1, log2FC: 0.1, signf: true }),
      cmp({ uniqID: 'g2', dose: 1, log2FC: 3, signf: true }),
      cmp({ uniqID: 'g3', dose: 1, log2FC: -2, signf: true })
    ]
    // top-1 base is g2 (largest |log2FC|); g3 is appended by the linked selection.
    const b = buildBubble(rows, { axis: 'dose', topGenes: 1, extra: ['g3'] })
    expect(b.points.map((p) => p.uniqID)).toEqual(['g2', 'g3'])
    // already-shown genes aren't duplicated when also in `extra`.
    const b2 = buildBubble(rows, { axis: 'dose', topGenes: 1, extra: ['g2', 'g3'] })
    expect(b2.points.map((p) => p.uniqID)).toEqual(['g2', 'g3'])
    // in GOI mode `extra` appends alongside the focus set.
    const b3 = buildBubble(rows, { axis: 'dose', topGenes: 0, focus: ['g1'], extra: ['g3'] })
    expect(b3.points.map((p) => p.uniqID)).toEqual(['g1', 'g3'])
  })
})

describe('buildTdr', () => {
  it('groups one gene into a line per time, x = dose', () => {
    const rows = [
      cmp({ uniqID: 'g1', dose: 1, time: 6, log2FC: 0.5 }),
      cmp({ uniqID: 'g1', dose: 2, time: 6, log2FC: 1.5 }),
      cmp({ uniqID: 'g1', dose: 1, time: 24, log2FC: -0.5 }),
      cmp({ uniqID: 'g1', dose: 2, time: 24, log2FC: -1 }),
      cmp({ uniqID: 'g2', dose: 1, time: 6, log2FC: 9 }) // other gene ignored
    ]
    const t = buildTdr(rows, 'g1', { g1: 'geneOne' })
    expect(t.gene).toBe('geneOne')
    expect(t.series.map((s) => s.time)).toEqual(['6', '24']) // sorted by time
    const six = t.series.find((s) => s.time === '6')!
    expect(six.points).toEqual([
      { x: 1, y: 0.5 },
      { x: 2, y: 1.5 }
    ])
  })
})

describe('buildGeneBar', () => {
  it('averages each focus gene per condition with sd over replicates', () => {
    const S = (uniqID: string, dose: number, rep: number, value: number): StandardRow => ({
      uniqID,
      cell: '',
      cmpd: 'A',
      dose,
      time: null,
      rep,
      value
    })
    const rows = [
      S('g1', 1, 1, 10),
      S('g1', 1, 2, 12), // cond A_1 mean 11
      S('g1', 2, 1, 20),
      S('g2', 1, 1, 5)
    ]
    const bar = buildGeneBar(rows, ['g1'], { g1: 'geneOne' })
    expect(bar.genes).toEqual([{ uniqID: 'g1', label: 'geneOne' }])
    const c1 = bar.bars.find((b) => b.cond === 'A_1')!
    expect(c1.mean).toBe(11)
    expect(c1.n).toBe(2)
    expect(c1.sd).toBeCloseTo(Math.sqrt(2), 9) // sample sd of [10,12]
    // g2 not requested → absent
    expect(bar.bars.every((b) => b.uniqID === 'g1')).toBe(true)
  })
})

describe('buildMA / buildDumbbell', () => {
  it('MA computes A = mean log10 abundance and M = log2FC', () => {
    const ma = buildMA(
      [
        {
          uniqID: 'g1',
          cmpd: 'X',
          dose: null,
          time: null,
          cmp_cond: 'cmpd',
          comparison: 'X | Y',
          mean1: 16,
          mean2: 4,
          sd1: 1,
          sd2: 1,
          log2FC: 2,
          pP: 1,
          pQ: 1,
          thrsh: '',
          signf: false,
          effect: 'none'
        }
      ],
      { fcLow: -1, fcHigh: 1 }
    )
    expect(ma.points).toHaveLength(1)
    expect(ma.points[0].x).toBeCloseTo(0.5 * (Math.log10(16) + Math.log10(4)), 9)
    expect(ma.points[0].y).toBe(2)
    expect(ma.comparison).toBe('X | Y') // single comparison → named on the FC axis
  })

  const mkDumbbell = (id: string, fcdiff: number, signf = true): ContrastResultRow => ({
    uniqID: id,
    dose: null,
    time: null,
    cmp_cond: 'cmpd',
    cmp1: 'A | DMSO',
    cmp2: 'B | DMSO',
    comparison: 'A | B',
    FC1: fcdiff,
    FC2: 0,
    FCdiff: fcdiff,
    P1: null,
    P2: null,
    Pdiff: null,
    Q1: null,
    Q2: null,
    Qdiff: null,
    signf1: false,
    signf2: false,
    effect1: 'none',
    effect2: 'none',
    thrsh: '',
    signf,
    effect: 'none'
  })

  it('dumbbell keeps the top-N significant genes by |FCdiff|', () => {
    const db = buildDumbbell([mkDumbbell('g1', 0.5), mkDumbbell('g2', 3), mkDumbbell('g3', -2)], {
      topGenes: 2
    })
    expect(db.rows.map((r) => r.label)).toEqual(['g2', 'g3'])
  })

  it('dumbbell shows only significant genes (non-significant dropped, even at high |FCdiff|)', () => {
    const db = buildDumbbell(
      [mkDumbbell('g1', 9, false), mkDumbbell('g2', 3, true), mkDumbbell('g3', -2, true)],
      { topGenes: 20 }
    )
    // g1 has the largest |FCdiff| but isn't significant, so it's excluded.
    expect(db.rows.map((r) => r.label)).toEqual(['g2', 'g3'])
  })

  it('dumbbell focus/GOI overrides the significant-only filter', () => {
    const db = buildDumbbell([mkDumbbell('g1', 9, false), mkDumbbell('g2', 3, true)], {
      topGenes: 20,
      focus: ['g1']
    })
    expect(db.rows.map((r) => r.label)).toEqual(['g1'])
  })

  it('dumbbell appends `extra` genes after the top-N, deduped', () => {
    const mk = (id: string, fcdiff: number): ContrastResultRow => mkDumbbell(id, fcdiff, true)
    const data = [mk('g1', 0.5), mk('g2', 3), mk('g3', -2)]
    // top-1 base is g2; g1 (linked selection) appended after it.
    expect(buildDumbbell(data, { topGenes: 1, extra: ['g1'] }).rows.map((r) => r.label)).toEqual([
      'g2',
      'g1'
    ])
    // a gene already shown isn't duplicated when it's also in `extra`.
    expect(buildDumbbell(data, { topGenes: 1, extra: ['g2'] }).rows.map((r) => r.label)).toEqual([
      'g2'
    ])
  })

  it('dumbbell order re-sorts the top-N by a side, high → low; the pick stays by |FCdiff|', () => {
    const mk = (id: string, fc1: number, fc2: number): ContrastResultRow => ({
      ...mkDumbbell(id, fc1 - fc2, true),
      FC1: fc1,
      FC2: fc2
    })
    // |FCdiff|: g1 4, g2 3, g3 2, g4 0.5 → top-3 is g1, g2, g3 whatever the order.
    const data = [mk('g1', -2, 2), mk('g2', 4, 1), mk('g3', 1, -1), mk('g4', 9, 8.5)]
    const labels = (order: 'fc1' | 'fc2' | 'diff'): string[] =>
      buildDumbbell(data, { topGenes: 3, order }).rows.map((r) => r.label)
    expect(labels('diff')).toEqual(['g1', 'g2', 'g3'])
    expect(labels('fc1')).toEqual(['g2', 'g3', 'g1'])
    expect(labels('fc2')).toEqual(['g1', 'g2', 'g3'])
    // linked-selection genes stay after the ordered base
    expect(
      buildDumbbell(data, { topGenes: 2, order: 'fc1', extra: ['g4'] }).rows.map((r) => r.label)
    ).toEqual(['g2', 'g1', 'g4'])
  })
})

describe('gene bar error bars', () => {
  const row = (rep: number, value: number): StandardRow =>
    ({ uniqID: 'g', cell: 'c', cmpd: 'x', dose: null, time: null, rep, value }) as StandardRow
  const rows = [row(1, 1), row(2, 2), row(3, 3)] // mean 2, sd 1, n 3
  const err = (e: 'sd' | 'sem' | 'ci95'): number =>
    buildGeneBar(rows, ['g'], undefined, false, e).bars[0].errUp

  it('shows SD, SEM or the t-based 95% CI of the mean', () => {
    expect(err('sd')).toBeCloseTo(1)
    expect(err('sem')).toBeCloseTo(1 / Math.sqrt(3))
    // t(0.975, df 2) ≈ 4.303
    expect(err('ci95')).toBeCloseTo((4.303 * 1) / Math.sqrt(3), 2)
  })
})

describe('thinPoints', () => {
  const vals = Array.from({ length: 1000 }, (_, i) => ((i * 37) % 1000) - 500)
  it('keeps everything under the cap', () => {
    expect(thinPoints(vals, 2000, Math.abs)).toBe(vals)
  })
  it('caps, keeps the most extreme, and preserves order', () => {
    const out = thinPoints(vals, 100, Math.abs)
    expect(out).toHaveLength(100)
    // the 20 largest |v| are all kept
    const top = [...vals].sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 20)
    for (const v of top) expect(out).toContain(v)
    // original order
    const idx = out.map((v) => vals.indexOf(v))
    expect(idx.every((x, i) => i === 0 || x > idx[i - 1])).toBe(true)
  })
})

describe('buildCluster — complete-case fallback', () => {
  // 12 samples × 24 genes, each gene missing in one sample: no gene is quantified everywhere.
  const rows: StandardRow[] = []
  for (let s = 0; s < 12; s++)
    for (let g = 0; g < 24; g++)
      rows.push({
        uniqID: `g${g}`,
        cell: '',
        cmpd: s < 6 ? 'A' : 'B',
        dose: null,
        time: null,
        rep: s,
        value: g % 12 === s ? null : (s < 6 ? 10 : 14) + ((g * 7 + s * 3) % 5) * 0.1
      })

  it('imputes instead of embedding nothing when no gene is complete, and says so', () => {
    const c = buildCluster(rows, { method: 'pca', colorBy: 'cmpd', missing: 'complete' })
    expect(c.points).toHaveLength(12)
    expect(c.diag?.completeFallback).toBe(0)
    expect(c.diag?.features).toBe(24)
  })

  it('leaves impute mode alone', () => {
    const c = buildCluster(rows, { method: 'pca', colorBy: 'cmpd', missing: 'impute' })
    expect(c.points).toHaveLength(12)
    expect(c.diag?.completeFallback).toBeUndefined()
  })
})

describe('sample order', () => {
  const meta = (cmpd: string, dose: number | null, rep: number | null): SampleMeta => ({
    cell: '',
    cmpd,
    dose,
    time: null,
    rep
  })
  // Items listed in neither natural nor the data's order.
  const items = [
    { id: 'a', meta: meta('A', 10, 1) },
    { id: 'b', meta: meta('A', 2, 2) },
    { id: 'c', meta: meta('A', 2, 1) }
  ]
  const samples: SampleConds[] = [
    { sample: 's1', ...meta('A', 2, 2) },
    { sample: 's2', ...meta('A', 10, 1) },
    { sample: 's3', ...meta('A', 2, 1) }
  ]
  const order = (by: 'natural' | 'original', perSample = true): string[] =>
    sortSamples([...items], { by, samples }, (t) => t.meta, perSample).map((t) => t.id)

  it('natural sorts by condition, dose numerically, then the replicate', () => {
    expect(order('natural')).toEqual(['c', 'b', 'a'])
  })
  it('natural compares text naturally (numbers in it numerically)', () => {
    const xs = ['cmp10', 'cmp2', 'Cmp1'].map((c) => ({ id: c, meta: meta(c, null, 1) }))
    const out = sortSamples(xs, { by: 'natural' }, (t) => t.meta, true)
    expect(out.map((t) => t.id)).toEqual(['Cmp1', 'cmp2', 'cmp10'])
  })
  it("original follows the data's sample order", () => {
    expect(order('original')).toEqual(['b', 'a', 'c'])
  })
  it('original pools replicates for condition slots: first sample of the condition', () => {
    // perSample false: b and c are both A·2, first seen at s1 → both before a (stable).
    expect(order('original', false)).toEqual(['b', 'c', 'a'])
  })
  it('original without samples keeps first-seen order', () => {
    const out = sortSamples([...items], { by: 'original' }, (t) => t.meta, true)
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  const S = (cmpd: string, dose: number, rep: number, value: number): StandardRow => ({
    uniqID: 'g',
    cell: '',
    cmpd,
    dose,
    time: null,
    rep,
    value
  })
  // data order B·10, A·10, A·2: the reverse of natural order
  const rows = [S('B', 10, 1, 1), S('A', 10, 1, 2), S('A', 2, 1, 3)]
  const stdSamples: SampleConds[] = rows.map((r, i) => ({
    sample: `s${i}`,
    cell: r.cell,
    cmpd: r.cmpd,
    dose: r.dose,
    time: r.time,
    rep: r.rep
  }))

  it('heatmap columns follow the chosen order', () => {
    const cols = (by: 'natural' | 'original'): string[] =>
      buildHeatmap(rows, { log10: false, cluster: false, order: { by, samples: stdSamples } }).x
    expect(cols('natural')).toEqual(['A_2_r1', 'A_10_r1', 'B_10_r1'])
    expect(cols('original')).toEqual(['B_10_r1', 'A_10_r1', 'A_2_r1'])
  })
  it('gene bar conditions follow the chosen order', () => {
    const conds = buildGeneBar(rows, ['g'], undefined, false, 'sd', {
      by: 'original',
      samples: stdSamples
    }).conds
    expect(conds).toEqual(['B_10', 'A_10', 'A_2'])
    expect(buildGeneBar(rows, ['g']).conds).toEqual(['A_2', 'A_10', 'B_10'])
  })
  it('QC groups follow the chosen order', () => {
    const std = {
      rows,
      samples: stdSamples,
      activeConditions: ['cmpd', 'dose']
    } as unknown as StandardizeResult
    const labels = (by: 'natural' | 'original'): string[] =>
      buildQc(std, 'proteins', 'linear', { by, samples: stdSamples }).groups.map((g) => g.label)
    expect(labels('original')).toEqual(['B · 10 · r1', 'A · 10 · r1', 'A · 2 · r1'])
    expect(labels('natural')).toEqual(['A · 2 · r1', 'A · 10 · r1', 'B · 10 · r1'])
  })
})

describe('curve-fit labels in plots', () => {
  it('names the fold change by method and reads the comparison with its compound and baseline', async () => {
    const { comparisonOf, fcName, fcMeasure } = await import('./plotData')
    const curve = {
      comparison: 'dose curve | 0',
      cmp_cond: 'dose',
      cmpd: 'drugA',
      curve: { baseline: 'dose 0 · time 60' }
    }
    expect(comparisonOf([curve])).toBe('drugA | baseline (dose 0 · time 60)')
    expect(comparisonOf([{ ...curve, curve: {} }])).toBe('drugA | baseline')
    expect(comparisonOf([curve, { ...curve, cmpd: 'drugB' }])).toBe(
      'dose curve | baseline (dose 0 · time 60)'
    )
    expect(fcName([curve])).toBe('curve log₂FC')
    expect(fcName([{ ...curve, curve: undefined, rs: {} }])).toBe('peak log₂FC')
    expect(
      comparisonOf([{ comparison: 'drugA | dose 0', cmp_cond: 'cmpd', cmpd: 'drugA', rs: {} }])
    ).toBe('drugA | baseline')
    // not a curve fit: untouched
    expect(comparisonOf([{ comparison: 'KO | WT', cmp_cond: 'cell' }])).toBe('KO | WT')
    expect(fcMeasure('curve_fit', '4pl')).toBe('curve log₂FC')
    expect(fcMeasure('curve_fit', '4pl', true)).toBe('peak log₂FC')
  })
})
