import { describe, expect, it } from 'vitest'

import { contrastStatDrag } from '../engine/contrast'
import { tailStep } from './contrastModel'

describe('tailStep', () => {
  it('climbs the rungs to 1%, then by 0.5 to 50', () => {
    const up: number[] = [0.001]
    while (up[up.length - 1] < 2.5) up.push(tailStep(up[up.length - 1], 1))
    expect(up).toEqual([0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 1.5, 2, 2.5])
    expect(tailStep(50, 1)).toBe(50)
  })

  it('comes back down the same way, stopping at 0.001', () => {
    const down: number[] = [2]
    while (down[down.length - 1] > 0.001) down.push(tailStep(down[down.length - 1], -1))
    expect(down).toEqual([2, 1.5, 1, 0.5, 0.1, 0.05, 0.01, 0.005, 0.001])
    expect(tailStep(0.001, -1)).toBe(0.001)
  })

  it('steps a value between rungs to the next one in that direction', () => {
    expect(tailStep(0.03, 1)).toBe(0.05)
    expect(tailStep(0.03, -1)).toBe(0.01)
    expect(tailStep(1.2, 1)).toBe(1.5)
    expect(tailStep(1.2, -1)).toBe(1)
  })
})

describe('contrastStatDrag', () => {
  it('keeps a band dragged to a 0.001% tail', () => {
    expect(contrastStatDrag(undefined, 'bandUp', 0.999999)).toEqual({
      bandConfidence: 0.99999,
      cutoffQ: 0.00001
    })
  })
})
