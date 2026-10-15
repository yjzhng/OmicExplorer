import { describe, expect, it } from 'vitest'

import type { SampleConds, StandardizeResult } from '../engine'
import {
  barColorConds,
  heatmapCondBar,
  primaryColorLevels,
  qcColorBy,
  type BarConfig,
  type HeatmapConfig,
  type QcConfig
} from './types'

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
    expect(barColorConds({} as BarConfig, ['cmpd', 'dose'], levels)).toEqual(['cmpd'])
    expect(heatmapCondBar({} as HeatmapConfig, levels)).toBe(true)
  })
  it('falls back past 10 levels', () => {
    const levels = primaryColorLevels(std(11))
    expect(qcColorBy({ metric: 'intensity', plot: 'box' } as QcConfig, levels)).toBe('single')
    expect(barColorConds({} as BarConfig, ['cmpd', 'dose'], levels)).toEqual([])
    expect(heatmapCondBar({} as HeatmapConfig, levels)).toBe(false)
  })
  it('keeps a choice the tile made', () => {
    expect(qcColorBy({ colorBy: 'condition' } as QcConfig, 50)).toBe('condition')
  })
})
