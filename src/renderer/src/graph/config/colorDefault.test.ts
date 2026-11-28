import { describe, expect, it } from 'vitest'
import { numericConds } from '../../engine'

import type { SampleConds, StandardizeResult } from '../../engine'
import { barColoring, conditionColoring, conditionColorWrite, primaryColorLevels } from './coloring'
import { heatmapCondBar, type HeatmapConfig } from './heatmap'
import { qcColorBy, type QcConfig } from './qc'
import type { BarConfig } from './genePlots'

/** dose and time numeric, no custom condition declared (the schema of these tests' data) */
const numeric = numericConds()

/** `nCmpd` compounds × 8 doses × 3 replicates: many samples, few primary levels. */
const std = (nCmpd: number): Pick<StandardizeResult, 'activeConditions' | 'samples' | 'rows'> => {
  const samples: SampleConds[] = []
  for (let c = 0; c < nCmpd; c++)
    for (let d = 0; d < 8; d++)
      for (let r = 1; r <= 3; r++)
        samples.push({
          sample: `s${c}_${d}_${r}`,
          cell: '',
          cmpd: `C${c}`,
          dose: d,
          time: null,
          rep: r
        })
  return { activeConditions: ['cmpd', 'dose'], samples, rows: [] }
}

describe('colour-by-condition default: the primary condition’s levels', () => {
  it('counts the levels of the first categorical condition, not the samples', () => {
    expect(primaryColorLevels(std(3))).toBe(3) // 72 samples, 3 compounds
  })
  it('colours by condition while the levels fit the palette (≤ 10)', () => {
    const levels = primaryColorLevels(std(3))
    expect(qcColorBy({ metric: 'intensity', plot: 'box' } as QcConfig, levels)).toBe('condition')
    expect(barColoring({} as BarConfig, ['cmpd', 'dose'], levels, numeric)).toEqual({
      picks: ['cmpd'],
      fade: 'dose'
    })
    expect(heatmapCondBar({} as HeatmapConfig, levels)).toBe(true)
  })
  it('falls back past 10 levels', () => {
    const levels = primaryColorLevels(std(11))
    expect(qcColorBy({ metric: 'intensity', plot: 'box' } as QcConfig, levels)).toBe('single')
    expect(barColoring({} as BarConfig, ['cmpd', 'dose'], levels, numeric)).toBeNull()
    expect(heatmapCondBar({} as HeatmapConfig, levels)).toBe(false)
  })
  it('keeps a choice the tile made', () => {
    expect(qcColorBy({ colorBy: 'condition' } as QcConfig, 50)).toBe('condition')
  })
})

describe('QC / gene bar colour by condition: colour picks and a fade', () => {
  const active = ['time', 'cmpd', 'dose', 'cell'] as const
  const of = (c: Parameters<typeof conditionColoring>[0]) =>
    conditionColoring(c, [...active], numeric)
  it('defaults to every categorical condition, the first numeric as the fade, in order', () => {
    expect(of({})).toEqual({ picks: ['cell', 'cmpd'], fade: 'dose' })
  })
  it('keeps the picks as made — any types, every combination a colour', () => {
    expect(of(conditionColorWrite(['cmpd', 'time'], 'dose'))).toEqual({
      picks: ['cmpd', 'time'],
      fade: 'dose'
    })
    expect(of(conditionColorWrite(['cmpd'], null))).toEqual({ picks: ['cmpd'], fade: null })
  })
  it('never fades by a colour condition', () => {
    expect(of(conditionColorWrite(['cmpd', 'dose'], 'dose')).fade).toBeNull()
  })
  it('reads an older pair back: the categorical one colours, the numeric one fades', () => {
    expect(of({ colorConds: ['cmpd', 'dose'] })).toEqual({ picks: ['cmpd'], fade: 'dose' })
    expect(of({ colorConds: ['dose'] })).toEqual({ picks: ['dose'], fade: null })
  })
  it("reads a gene bar's older single condition key", () => {
    expect(barColoring({ colorBy: 'cell' } as BarConfig, [...active], 3, numeric)).toEqual({
      picks: ['cell'],
      fade: null
    })
  })
})
