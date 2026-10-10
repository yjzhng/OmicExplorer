import { describe, expect, it } from 'vitest'

import {
  axisTitle,
  condUnitsFor,
  curveDoseUnit,
  normalizeCompareConfig,
  type CompareConfig,
  type GraphNode
} from './types'

const step = (id: string, kind: string, config: Record<string, unknown> = {}): GraphNode =>
  ({
    id,
    type: 'step',
    position: { x: 0, y: 0 },
    data: { kind, config, status: 'idle' }
  }) as GraphNode

const curve = (patch: Partial<CompareConfig> = {}): CompareConfig => ({
  ...normalizeCompareConfig({} as CompareConfig),
  analysis: 'curve_fit',
  ...patch
})

describe('condUnitsFor (units set at import, read downstream)', () => {
  it('walks up the chain to the Load tile', () => {
    const nodes = [
      step('load-1', 'load', { units: { dose: 'µM', time: 'h' } }),
      step('std-1', 'standardize'),
      step('cmp-1', 'compare')
    ]
    const edges = [
      { source: 'load-1', target: 'std-1' },
      { source: 'std-1', target: 'cmp-1' }
    ]
    expect(condUnitsFor({ nodes, edges }, 'cmp-1')).toEqual({ dose: 'µM', time: 'h' })
  })

  it('through a Merge, the first input naming each unit wins it', () => {
    const nodes = [
      step('load-1', 'load', { units: { dose: 'nM' } }),
      step('load-2', 'load', { units: { dose: 'mM', time: 'min' } }),
      step('merge-1', 'merge')
    ]
    const edges = [
      { source: 'load-1', target: 'merge-1' },
      { source: 'load-2', target: 'merge-1' }
    ]
    expect(condUnitsFor({ nodes, edges }, 'merge-1')).toEqual({ dose: 'nM', time: 'min' })
  })

  it('nothing upstream ⇒ no units', () => {
    expect(condUnitsFor({ nodes: [], edges: [] }, undefined)).toEqual({})
  })
})

describe('curveDoseUnit', () => {
  it('a dose curve takes the imported unit, molar', () => {
    expect(curveDoseUnit(curve(), { dose: 'µM' })).toEqual({ unit: 'µM', scale: 1e-6, molar: true })
  })
  it('falls back to a legacy Compare-level unit, else a.u. (no molar scale)', () => {
    expect(curveDoseUnit(curve({ doseUnit: 'pM' }), {}).unit).toBe('pM')
    expect(curveDoseUnit(curve(), {})).toEqual({ scale: 1 })
    expect(curveDoseUnit(curve({ doseUnit: 'pM' }), { dose: 'M' }).unit).toBe('M')
  })
  it('a.u. picked for dose: labelled a.u., no molar scale (not even a legacy unit)', () => {
    expect(curveDoseUnit(curve({ doseUnit: 'nM' }), { dose: 'a.u.' })).toEqual({
      unit: 'a.u.',
      scale: 1
    })
  })
  it('a time curve labels its EC50 in the time unit, with no molar scale', () => {
    expect(curveDoseUnit(curve({ curveAxis: 'time' }), { time: 'h' })).toEqual({
      unit: 'h',
      scale: 1
    })
  })
  it('not a curve fit ⇒ nothing', () => {
    expect(curveDoseUnit(curve({ analysis: 'compare' }), { dose: 'nM' })).toEqual({ scale: 1 })
  })
})

describe('axisTitle', () => {
  it('appends the unit when one is set', () => {
    expect(axisTitle('dose', { dose: 'nM' })).toBe('dose (nM)')
    expect(axisTitle('time', {})).toBe('time')
  })
})
