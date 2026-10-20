/**
 * The cluster view's complex-legend plan. The behaviour worth pinning down is the channel
 * hierarchy, and above all that the ORDERED channels (light→dark shade, low→high arrow) are only
 * ever handed a numeric condition — a custom condition has no order, so putting one on either
 * channel would draw a ranking the data doesn't carry.
 */
import { describe, expect, it } from 'vitest'

import { customCond, numericConds, type ClusterMeta, type ConditionKey } from '../engine'
import { condsOf, planAesthetics } from './clusterPlan'

/** dose and time numeric, no custom condition declared (the schema of these tests' data) */
const numeric = numericConds()

const plan = (varying: ConditionKey[], conds?: ConditionKey[]) =>
  planAesthetics(new Set(varying), conds ?? ['cell', 'cmpd', 'dose', 'time'], numeric)

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

describe('the user’s channel choices', () => {
  const ALL: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time']
  const withOv = (varying: ConditionKey[], ov: Parameters<typeof planAesthetics>[3]) =>
    planAesthetics(new Set(varying), ALL, numeric, ov)

  it('no choices: exactly the automatic plan', () => {
    for (const v of [
      ['cell', 'dose'],
      ['cell', 'cmpd', 'dose', 'time'],
      ['dose', 'time']
    ] as ConditionKey[][])
      expect(withOv(v, {})).toEqual(plan(v))
  })

  it('colour by a chosen condition; the numerics fill shade then arrows', () => {
    expect(withOv(['cell', 'cmpd', 'dose', 'time'], { color: ['cmpd'] })).toMatchObject({
      grouped: false,
      colorKey: 'cmpd',
      shadeKey: 'time',
      arrowKey: 'dose'
    })
  })

  it('colour by several categoricals, in the chosen order', () => {
    expect(withOv(['cell', 'cmpd'], { color: ['cmpd', 'cell'] })).toMatchObject({
      grouped: true,
      quals: ['cmpd', 'cell']
    })
  })

  it('shade / arrow by a chosen numeric, or none', () => {
    expect(withOv(['cell', 'dose', 'time'], { shade: 'dose', arrow: 'time' })).toMatchObject({
      shadeKey: 'dose',
      arrowKey: 'time'
    })
    expect(withOv(['cell', 'dose', 'time'], { arrow: 'none' })).toMatchObject({
      shadeKey: 'time',
      arrowKey: null
    })
  })

  it('never puts a categorical on an ordered channel, whatever was chosen', () => {
    const p = withOv(['cell', 'cmpd', 'dose'], { color: ['cell'], shade: 'cmpd', arrow: 'cmpd' })
    expect(p.shadeKey).not.toBe('cmpd')
    expect(p.arrowKey).not.toBe('cmpd')
  })

  it('skips a chosen colour condition that does not vary', () => {
    expect(withOv(['cell', 'dose'], { color: ['cmpd'] })).toMatchObject({ colorKey: 'cell' })
  })
})

describe('a custom condition declared numeric takes the ordered channels, as dose and time do', () => {
  const TEMP = customCond('temp')
  const conds: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time', TEMP]
  const declared = numericConds([TEMP])
  const planD = (varying: ConditionKey[]) => planAesthetics(new Set(varying), conds, declared)

  it('with one qualitative it takes the shade', () => {
    expect(planD(['cell', TEMP])).toMatchObject({
      colorKey: 'cell',
      shadeKey: TEMP,
      arrowKey: null
    })
  })
  it('beside dose, dose keeps the arrows and it takes the shade', () => {
    expect(planD(['cmpd', 'dose', TEMP])).toMatchObject({
      colorKey: 'cmpd',
      arrowKey: 'dose',
      shadeKey: TEMP
    })
  })
  it('alone it becomes a ramp', () => {
    expect(planD([TEMP])).toMatchObject({ colorKey: TEMP, colorRamp: true })
  })
  it('undeclared, the same condition is categorical: colour only', () => {
    expect(planAesthetics(new Set(['cell', TEMP]), conds, numeric)).toMatchObject({
      grouped: true,
      quals: ['cell', TEMP],
      shadeKey: null,
      arrowKey: null
    })
  })
})
