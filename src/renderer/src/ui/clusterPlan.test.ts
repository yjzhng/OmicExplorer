/**
 * The cluster view's complex-legend plan. The behaviour worth pinning down is the channel
 * hierarchy, and above all that the ORDERED channels (light→dark shade, low→high arrow) are only
 * ever handed a numeric condition — a custom condition has no order, so putting one on either
 * channel would draw a ranking the data doesn't carry.
 */
import { describe, expect, it } from 'vitest'

import { customCond, type ClusterMeta, type ConditionKey } from '../engine'
import { condsOf, planAesthetics } from './clusterPlan'

const plan = (varying: ConditionKey[], conds?: ConditionKey[]) =>
  planAesthetics(new Set(varying), conds ?? ['cell', 'cmpd', 'dose', 'time'])

const GENO = customCond('genotype')
const MEDIUM = customCond('medium')
const WITH_CUSTOM: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time', GENO, MEDIUM]

describe('the preset plans are unchanged', () => {
  it('one qualitative takes colour; a lone quantitative takes shade', () => {
    expect(plan(['cell', 'dose'])).toMatchObject({
      grouped: false,
      colorKey: 'cell',
      colorRamp: false,
      shadeKey: 'dose',
      arrowKey: null
    })
  })

  it('cell + cmpd group into hue families, dose gets the arrows and time the shade', () => {
    expect(plan(['cell', 'cmpd', 'dose', 'time'])).toMatchObject({
      grouped: true,
      quals: ['cell', 'cmpd'],
      arrowKey: 'dose',
      shadeKey: 'time'
    })
  })

  it('with no qualitative at all, the first quantitative becomes a ramp', () => {
    expect(plan(['dose', 'time'])).toMatchObject({
      colorKey: 'dose',
      colorRamp: true,
      arrowKey: 'time'
    })
  })

  it('one qualitative with dose+time shades by time and connects doses', () => {
    expect(plan(['cmpd', 'dose', 'time'])).toMatchObject({
      colorKey: 'cmpd',
      shadeKey: 'time',
      arrowKey: 'dose'
    })
  })

  it('nothing varying yields no colour at all (the view falls back to simple mode)', () => {
    expect(plan([])).toMatchObject({ grouped: false, colorKey: null })
  })
})

describe('a custom condition only ever joins the colour channel', () => {
  it('alone, it takes colour like cell would', () => {
    expect(plan([GENO], WITH_CUSTOM)).toMatchObject({
      grouped: false,
      colorKey: GENO,
      colorRamp: false,
      shadeKey: null,
      arrowKey: null
    })
  })

  it('never takes shade, even when it is the only unused condition', () => {
    // cell colours; genotype is left over. It must NOT become the shade (light→dark) key.
    const p = plan(['cell', GENO], WITH_CUSTOM)
    expect(p.shadeKey).toBeNull()
    expect(p.arrowKey).toBeNull()
    // Instead both qualitatives go to colour, so the two stay distinguishable.
    expect(p).toMatchObject({ grouped: true, quals: ['cell', GENO] })
  })

  it('never takes the arrow channel either', () => {
    const p = plan(['cell', 'cmpd', GENO], WITH_CUSTOM)
    expect(p.arrowKey).toBeNull()
    expect(p.shadeKey).toBeNull()
    expect(p).toMatchObject({ grouped: true, quals: ['cell', 'cmpd', GENO] })
  })

  it('is never used as a colour RAMP (that needs an order too)', () => {
    const p = plan([GENO, MEDIUM], WITH_CUSTOM)
    expect(p.colorRamp).toBe(false)
  })
})

describe('the hierarchy extends past two qualitatives', () => {
  it('keeps every varying qualitative on colour, in hierarchy order', () => {
    const p = plan(['cell', 'cmpd', GENO, MEDIUM], WITH_CUSTOM)
    expect(p.grouped).toBe(true)
    // cell is the hue family; cmpd, genotype and medium refine within it. Custom conditions come
    // after the presets and are alphabetical among themselves.
    expect(p.quals).toEqual(['cell', 'cmpd', GENO, MEDIUM])
  })

  it('still hands the quantitatives the ordered channels alongside them', () => {
    const p = plan(['cell', GENO, 'dose', 'time'], WITH_CUSTOM)
    expect(p).toMatchObject({
      grouped: true,
      quals: ['cell', GENO],
      arrowKey: 'dose',
      shadeKey: 'time'
    })
  })
})

describe('condsOf', () => {
  const meta = (extra?: Record<string, string>): ClusterMeta => ({
    cell: 'WT',
    cmpd: 'A',
    dose: null,
    time: null,
    ...(extra ? { extra } : null)
  })

  it('lists the presets alone when no meta carries a custom condition', () => {
    expect(condsOf([meta(), meta()])).toEqual(['cell', 'cmpd', 'dose', 'time'])
  })

  it('appends the custom conditions the metas carry, after the presets', () => {
    expect(condsOf([meta({ medium: 'rich' }), meta({ genotype: 'parent' })])).toEqual([
      'cell',
      'cmpd',
      'dose',
      'time',
      GENO,
      MEDIUM
    ])
  })

  it('ignores a custom condition present but blank everywhere', () => {
    expect(condsOf([meta({ genotype: '' })])).toEqual(['cell', 'cmpd', 'dose', 'time'])
  })
})
