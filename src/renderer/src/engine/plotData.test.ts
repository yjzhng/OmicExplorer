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
  buildBubble,
  buildTdr,
  buildGeneBar,
  buildDR,
  pickBalanced
} from './plotData'
import type { CompareResultRow, ContrastResultRow, StandardRow } from './types'

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
      // significant at the low dose only → in, ranked by its top-dose |log2FC|
      cmp({ uniqID: 'lowSig', dose: 1, log2FC: 2, signf: true }),
      cmp({ uniqID: 'lowSig', dose: 10, log2FC: 1 }),
      cmp({ uniqID: 'topSig', dose: 10, log2FC: -3, signf: true })
    ]
    const b = buildBubble(rows, { axis: 'dose', topGenes: 0 })
    expect(new Set(b.genes)).toEqual(new Set(['lowSig', 'topSig']))
    // focus genes still show as given, significant or not
    expect(buildBubble(rows, { axis: 'dose', topGenes: 0, focus: ['big'] }).genes).toEqual(['big'])
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
