/**
 * Custom (user-defined) condition axes: a samplesheet column beyond the five presets becomes an
 * extra categorical condition, keyed `@name` and carried in each row's `extra` bag.
 *
 * The invariant these tests exist to hold: a custom condition behaves like `cell`/`cmpd`
 * everywhere (grouping, context, faceting, dedupe keys) and like NEITHER `dose` nor `time`
 * anywhere that assumes an order.
 */
import { describe, expect, it } from 'vitest'

import { runVehNorm } from './compare'
import { runDirect } from './direct'
import { detectCustomConditions, standardize } from './ingest'
import { buildStandardInputs } from './interactive'
import { buildFcHeatmap, buildHeatmap, facetCompareRows, facetContextDims } from './plotData'
import { condsIn, customCond, isNumericCond, orderConds, validCondName } from './types'

// 4 samples: two genotypes × two compounds, one replicate each.
const DATA = ['id,s1,s2,s3,s4', 'g1,10,20,30,40', 'g2,11,21,31,41'].join('\n')
const SHEET = [
  'sample,cell,cmpd,genotype',
  's1,WT,DMSO,parent',
  's2,WT,DrugA,parent',
  's3,WT,DMSO,mutant',
  's4,WT,DrugA,mutant'
].join('\n')

const std = (over: Partial<Parameters<typeof standardize>[0]> = {}) =>
  standardize({ dataText: DATA, dataFilename: 'd_wide.csv', samplesheetText: SHEET, ...over })

describe('custom condition names', () => {
  it('accepts a lowercase identifier and rejects a reserved or malformed one', () => {
    expect(validCondName('genotype')).toBe(true)
    expect(validCondName('batch_2')).toBe(true)
    expect(validCondName('cmpd')).toBe(false) // preset
    expect(validCondName('rep')).toBe(false) // reserved samplesheet column
    expect(validCondName('sample')).toBe(false)
    expect(validCondName('Genotype')).toBe(false) // ingest lowercases headers
    expect(validCondName('2batch')).toBe(false)
    expect(validCondName('')).toBe(false)
  })

  it('is never numeric, so ordered channels can exclude it by type alone', () => {
    expect(isNumericCond('dose')).toBe(true)
    expect(isNumericCond('time')).toBe(true)
    expect(isNumericCond(customCond('genotype'))).toBe(false)
    // Even when its values happen to be numbers.
    expect(isNumericCond(customCond('batch'))).toBe(false)
  })

  it('sorts after the presets in canonical order', () => {
    expect(orderConds([customCond('zone'), 'time', customCond('area'), 'cell'])).toEqual([
      'cell',
      'time',
      '@area',
      '@zone'
    ])
  })
})

describe('auto-detecting custom conditions in a samplesheet', () => {
  const rows = (...lines: string[]) =>
    lines.map((l) => {
      const [sample, v] = l.split(',')
      return { sample, col: v }
    })

  it('takes a column that groups the samples', () => {
    expect(detectCustomConditions(rows('s1,a', 's2,a', 's3,b', 's4,b'))).toEqual(['col'])
  })

  it('skips a column with one distinct value per sample (an id or free text, not a factor)', () => {
    expect(detectCustomConditions(rows('s1,a', 's2,b', 's3,c', 's4,d'))).toEqual([])
  })

  it('skips an entirely empty column and a reserved name', () => {
    expect(detectCustomConditions(rows('s1,', 's2,', 's3,', 's4,'))).toEqual([])
    expect(
      detectCustomConditions([
        { sample: 's1', rep: '1' },
        { sample: 's2', rep: '1' },
        { sample: 's3', rep: '2' }
      ])
    ).toEqual([])
  })
})

describe('standardize with a custom condition', () => {
  it('carries the value in `extra` and lists the condition as active', () => {
    const r = std()
    expect(r.activeConditions).toContain('@genotype')
    expect(r.activeConditions.indexOf('@genotype')).toBeGreaterThan(
      r.activeConditions.indexOf('cmpd')
    )
    const s1 = r.rows.find((x) => x.cmpd === 'DMSO' && x.extra?.genotype === 'parent')
    expect(s1).toBeDefined()
    expect(condsIn(r.rows)).toContain('@genotype')
  })

  it('honours an explicit customConditions list over auto-detection', () => {
    // Declaring nothing means "no custom conditions", not "detect them".
    const r = std({ customConditions: [] })
    expect(r.activeConditions).not.toContain('@genotype')
    expect(r.rows.every((x) => x.extra == null)).toBe(true)
  })

  it('does not treat samples differing only in a custom condition as replicates', () => {
    // s1 and s3 share cell+cmpd and differ only in genotype. Auto-numbering must not call them
    // rep 1 and rep 2 of one condition — they are two distinct conditions.
    const r = std()
    const dmso = r.rows.filter((x) => x.uniqID === 'g1' && x.cmpd === 'DMSO')
    expect(dmso).toHaveLength(2)
    expect(new Set(dmso.map((x) => x.rep))).toEqual(new Set([1]))
    expect(new Set(dmso.map((x) => x.extra?.genotype))).toEqual(new Set(['parent', 'mutant']))
  })

  it('groups clean-up coverage within a custom condition when asked', () => {
    // g2 is missing from both mutant samples; measured per genotype it clears the bar in `parent`
    // and so is kept whole, which is the same rule the preset conditions get.
    const data = ['id,s1,s2,s3,s4', 'g1,10,20,30,40', 'g2,11,21,,'].join('\n')
    const pooled = standardize({
      dataText: data,
      dataFilename: 'd_wide.csv',
      samplesheetText: SHEET,
      minSamplePct: 75
    })
    expect(new Set(pooled.rows.map((r) => r.uniqID))).toEqual(new Set(['g1']))
    const grouped = standardize({
      dataText: data,
      dataFilename: 'd_wide.csv',
      samplesheetText: SHEET,
      minSamplePct: 75,
      minSamplePctBy: [customCond('genotype')]
    })
    expect(new Set(grouped.rows.map((r) => r.uniqID))).toEqual(new Set(['g1', 'g2']))
    expect(grouped.cleanup.by).toEqual(['@genotype'])
  })
})

describe('a custom condition as a comparison axis and as context', () => {
  const rows = () => std().rows

  it('compares two levels of a custom condition, matched on the rest', () => {
    const r = runDirect({
      rows: rows(),
      condition: customCond('genotype'),
      pairs: [['mutant', 'parent']],
      activeConditions: condsIn(rows()),
      transform: false
    })
    expect(r.rows.length).toBeGreaterThan(0)
    expect(r.rows.every((x) => x.cmp_cond === '@genotype')).toBe(true)
    // cmpd is the remaining context, so each compound is its own comparison row.
    expect(new Set(r.rows.map((x) => x.cmpd))).toEqual(new Set(['DMSO', 'DrugA']))
  })

  it('carries a custom condition onto result rows as context, and facets by it', () => {
    const r = runDirect({
      rows: rows(),
      condition: 'cmpd',
      pairs: [['DrugA', 'DMSO']],
      activeConditions: condsIn(rows()),
      transform: false
    })
    expect(r.rows.every((x) => x.extra?.genotype != null)).toBe(true)
    expect(facetContextDims(r.rows)).toContain('@genotype')
    const groups = facetCompareRows(r.rows, [customCond('genotype')])
    expect(groups.map((g) => g.key)).toEqual(['@genotype=mutant', '@genotype=parent'])
  })
})

describe('facet ordering treats a custom condition as categorical', () => {
  // Its levels look like numbers, but a custom condition has no defined order — so it must sort by
  // code point like cell/cmpd, not numerically like dose. (Sorting "2" before "10" here would
  // imply an ordering the data does not carry.)
  const mk = (v: string) => ({ cmp_cond: 'cmpd', extra: { batch: v } })
  const numeric = (v: number) => ({ cmp_cond: 'cmpd', dose: v })

  it('orders a custom dim by code point', () => {
    const groups = facetCompareRows([mk('10'), mk('2'), mk('1')], [customCond('batch')])
    expect(groups.map((g) => g.values[0].value)).toEqual(['1', '10', '2'])
  })

  it('still orders dose numerically', () => {
    const groups = facetCompareRows([numeric(10), numeric(2), numeric(1)], ['dose'])
    expect(groups.map((g) => g.values[0].value)).toEqual([1, 2, 10])
  })
})

describe('the interactive import writes a column per custom condition', () => {
  it('emits the declared columns, in order, with each sample’s value', () => {
    const matrix = ['uniqID,s1,s2', 'g1,1,2'].join('\n')
    const out = buildStandardInputs(matrix, {
      roles: { uniqID: 'id', s1: 'sample', s2: 'sample' },
      conditions: {
        s1: {
          sample: 's1',
          cell: 'WT',
          cmpd: 'A',
          dose: '',
          time: '',
          rep: '1',
          extra: { genotype: 'parent' }
        },
        s2: {
          sample: 's2',
          cell: 'WT',
          cmpd: 'A',
          dose: '',
          time: '',
          rep: '2',
          extra: { genotype: 'mutant' }
        }
      },
      customConditions: ['genotype']
    })
    // Papa writes CRLF line endings.
    const [header, r1, r2] = out.samplesheetText.trim().split(/\r?\n/)
    expect(header).toBe('sample,cell,cmpd,dose,time,rep,genotype')
    expect(r1.endsWith(',parent')).toBe(true)
    expect(r2.endsWith(',mutant')).toBe(true)
  })

  it('round-trips through standardize as a real condition', () => {
    const matrix = ['uniqID,s1,s2', 'g1,1,2'].join('\n')
    const out = buildStandardInputs(matrix, {
      roles: { uniqID: 'id', s1: 'sample', s2: 'sample' },
      conditions: {
        s1: {
          sample: 's1',
          cell: '',
          cmpd: '',
          dose: '',
          time: '',
          rep: '',
          extra: { medium: 'rich' }
        },
        s2: {
          sample: 's2',
          cell: '',
          cmpd: '',
          dose: '',
          time: '',
          rep: '',
          extra: { medium: 'poor' }
        }
      },
      customConditions: ['medium']
    })
    const r = standardize({
      dataText: out.dataText,
      dataFilename: out.dataFilename,
      samplesheetText: out.samplesheetText,
      customConditions: ['medium']
    })
    expect(r.activeConditions).toEqual(['@medium'])
    expect(new Set(r.rows.map((x) => x.extra?.medium))).toEqual(new Set(['rich', 'poor']))
  })
})

describe('the intensity heatmap treats a custom condition as its own annotation track', () => {
  it('lists it among the tracks and keeps the samples apart', () => {
    const h = buildHeatmap(std().rows, { log10: false })
    expect(h.conds).toContain('@genotype')
    // 4 distinct samples, not 2 — the sample label must include the custom condition, or the two
    // genotypes of one cell × cmpd would pivot into a single column.
    expect(h.x).toHaveLength(4)
    expect(new Set(h.samples.map((m) => m.extra?.genotype))).toEqual(new Set(['parent', 'mutant']))
  })

  it('orders the sample columns with the custom condition after the presets', () => {
    const h = buildHeatmap(std().rows, { log10: false })
    const key = h.samples.map((m) => `${m.cmpd}/${m.extra?.genotype}`)
    // cmpd (a preset) dominates; genotype only breaks ties within it.
    expect(key).toEqual(['DMSO/mutant', 'DMSO/parent', 'DrugA/mutant', 'DrugA/parent'])
  })
})

describe('the vehicle-normalised path carries a custom condition as context', () => {
  // A vehicle only at dose 0 against a drug at dose 5 — the asymmetric case veh_norm exists for.
  // `medium` cross-cuts both compounds, so it must survive as context onto every result row and
  // reach the fold-change heatmap's column labels under its plain name.
  const DATA = ['id,v1,v2,d1,d2', 'g1,10,12,40,44', 'g2,10,11,5,6'].join('\n')
  const SHEET = [
    'sample,cmpd,dose,rep,medium',
    'v1,DMSO,0,1,rich',
    'v2,DMSO,0,1,minimal',
    'd1,DrugA,5,1,rich',
    'd2,DrugA,5,1,minimal'
  ].join('\n')
  const s = standardize({ dataText: DATA, dataFilename: 'd_wide.csv', samplesheetText: SHEET })

  it('pools FDR per context and keeps the custom value on the rows', () => {
    const r = runVehNorm({
      rows: s.rows,
      pairs: [['DrugA', 'DMSO']],
      activeConditions: s.activeConditions
    })
    expect(r.rows.length).toBeGreaterThan(0)
    expect(new Set(r.rows.map((x) => x.extra?.medium))).toEqual(new Set(['rich', 'minimal']))
    expect(facetContextDims(r.rows)).toContain('@medium')
  })

  it('names it plainly in the fold-change heatmap columns (no @ prefix on screen)', () => {
    const r = runVehNorm({
      rows: s.rows,
      pairs: [['DrugA', 'DMSO']],
      activeConditions: s.activeConditions
    })
    const fc = buildFcHeatmap(r.rows)
    expect(fc.columns.some((c) => c.includes('medium=rich'))).toBe(true)
    expect(fc.columns.every((c) => !c.includes('@medium'))).toBe(true)
  })
})
