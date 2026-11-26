import { describe, expect, it } from 'vitest'

import { interactionAxes } from '../engine'
import { interactionDim, interactionShow, interactionShowWhy } from './types'

const factors = [
  { condition: 'cell', levels: ['P', 'M'] },
  { condition: 'cmpd', levels: ['NK', 'DMSO'] },
  { condition: 'time', levels: ['24', '6'] }
] as Parameters<typeof interactionAxes>[0]['factors']

describe('the interaction plot’s factors', () => {
  it('takes factor 2 none as factor 1 alone (every other factor averaged)', () => {
    expect(interactionAxes({ factors }, 'cmpd', 'none')).toEqual({ x: 1, line: null })
    expect(interactionAxes({ factors }, 'cmpd', undefined)).toEqual({ x: 1, line: 0 })
  })
})

describe('the interaction plot’s view and show', () => {
  const both = { two: true, numeric: true }
  const cat = { two: true, numeric: false }
  const one = { two: false, numeric: false }
  it('draws 3D only with a factor 2', () => {
    expect(interactionDim({ dim: '3d' }, both)).toBe('3d')
    expect(interactionDim({ dim: '3d' }, one)).toBe('2d')
  })
  it('falls back to lines where the view can’t draw the pick', () => {
    expect(interactionShow({ show: 'heatmap' }, both)).toBe('heatmap')
    expect(interactionShow({ dim: '3d', show: 'heatmap' }, both)).toBe('line')
    expect(interactionShow({ dim: '3d', show: 'surface' }, both)).toBe('surface')
    expect(interactionShow({ dim: '3d', show: 'surface' }, cat)).toBe('line')
    expect(interactionShow({ show: 'surface' }, both)).toBe('line')
  })
  it('says why a show is out', () => {
    expect(interactionShowWhy('3d', 'surface', cat)).toMatch(/numeric/)
    expect(interactionShowWhy('2d', 'heatmap', cat)).toBeUndefined()
  })
})
