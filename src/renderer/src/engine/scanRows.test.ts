import { describe, expect, it } from 'vitest'

import { attachLazyRows, holderTable } from './lazyRows'
import { buildGeneBar, buildHeatmap, buildQc, buildSampleCorr } from './plotData'
import { scanRows } from './rowView'
import type { StandardizeResult, StandardRow } from './types'
import { encodeTable } from './wire'

/** A Clean data table: genes × (2 compounds × 3 doses × 3 replicates), a custom condition, some
 *  missing and imputed values. */
function stdRows(): StandardRow[] {
  const out: StandardRow[] = []
  for (let g = 0; g < 120; g++)
    for (const cmpd of ['DMSO', 'E28'])
      for (const dose of [0, 1, 10])
        for (const rep of [1, 2, 3]) {
          const i = out.length
          out.push({
            uniqID: `P${g}`,
            cell: 'WT',
            cmpd,
            dose,
            time: null,
            rep,
            ...(g % 2 ? { extra: { strain: g % 4 ? 'ko' : 'wt' } } : {}),
            value: i % 23 === 0 ? null : 100 + ((i * 37) % 900),
            ...(i % 31 === 0 ? { imputed: true } : {})
          } as StandardRow)
        }
  return out
}

function std(lazy: boolean): StandardizeResult {
  const base = {
    scale: 'linear',
    samples: [],
    activeConditions: ['cmpd', 'dose', '@strain'],
    displayMap: {}
  } as unknown as Record<string, unknown>
  if (!lazy) return { ...base, rows: stdRows() } as unknown as StandardizeResult
  attachLazyRows(base, encodeTable(stdRows() as unknown as Record<string, unknown>[], []))
  return base as unknown as StandardizeResult
}

describe('scanRows over a columnar result', () => {
  it('gives buildQc the same answer, every metric', () => {
    const lazy = std(true)
    expect(holderTable(lazy)).toBeDefined()
    for (const metric of ['intensity', 'cv', 'proteins'] as const)
      expect(buildQc(lazy, metric, 'log10')).toEqual(buildQc(std(false), metric, 'log10'))
  })

  it('gives the heatmap the same cells', () => {
    const keys = ['uniqID', 'cell', 'cmpd', 'dose', 'time', 'rep', 'extra', 'value']
    const lazy = std(true)
    expect(buildHeatmap(scanRows(lazy, keys), { log10: false })).toEqual(
      buildHeatmap(std(false).rows, { log10: false })
    )
  })

  it('gives the sample correlation and the gene bars the same answer', () => {
    expect(buildSampleCorr(std(true), { scale: 'log10' })).toEqual(
      buildSampleCorr(std(false), { scale: 'log10' })
    )
    const keys = ['uniqID', 'cell', 'cmpd', 'dose', 'time', 'rep', 'extra', 'value']
    for (const error of ['sd', 'sem', 'ci95'] as const)
      expect(buildGeneBar(scanRows(std(true), keys), ['P3', 'P7'], {}, true, error)).toEqual(
        buildGeneBar(std(false).rows, ['P3', 'P7'], {}, true, error)
      )
  })
})

describe('sample correlation metrics', () => {
  /** Two samples over 400 proteins spanning 4 log units; the second = the first + noise (sd 0.1),
   *  a shift, and (optionally) a minority of 20 proteins changed by 3 log units. */
  function pair(shift: number, minority: boolean): StandardizeResult {
    let seed = 7
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const noise = (): number =>
      Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd()) * 0.1
    const rows: StandardRow[] = []
    for (let g = 0; g < 400; g++) {
      const base = (g / 400) * 4
      const b = base + shift + noise() + (minority && g % 20 === 0 ? 3 : 0)
      // (as intensities: the matrix logs them)
      const at = (cmpd: string, log: number): StandardRow =>
        ({
          uniqID: `P${g}`,
          cell: '',
          cmpd,
          dose: null,
          time: null,
          rep: 1,
          value: 10 ** (4 + log)
        }) as StandardRow
      rows.push(at('A', base), at('B', b))
    }
    return { rows, activeConditions: ['cmpd'], displayMap: {} } as unknown as StandardizeResult
  }
  const score = (s: StandardizeResult, metric: 'pearson' | 'spearman' | 'ccc'): number =>
    buildSampleCorr(s, { scale: 'log10', metric, cluster: false }).z[0][1]

  it('Pearson and Spearman ignore a shift; concordance counts it', () => {
    const shifted = pair(0.5, false)
    expect(score(shifted, 'pearson')).toBeGreaterThan(0.99)
    expect(score(shifted, 'spearman')).toBeGreaterThan(0.99)
    expect(score(shifted, 'ccc')).toBeLessThan(score(pair(0, false), 'ccc'))
  })

  it('reports its metric and puts 1 on the diagonal', () => {
    const d = buildSampleCorr(pair(0, true), { metric: 'ccc', cluster: false })
    expect(d.metric).toBe('ccc')
    expect(d.z[0][0]).toBe(1)
    expect(d.max).toBeGreaterThan(d.min - 1e-12)
  })
})
