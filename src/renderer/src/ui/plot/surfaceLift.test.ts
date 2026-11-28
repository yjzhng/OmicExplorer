import { describe, expect, it } from 'vitest'

import { LIFT, liftGrid } from './surfaceLift'

const lin = (lo: number, hi: number) => ({ range: [lo, hi] as [number, number], log: false })

describe('liftGrid', () => {
  const x = [0, 1, 2]
  const y = [0, 1, 2]
  const z = y.map(() => x.map(() => 5))
  // a box 2 × 2 × 10 in data, drawn 1 × 1 × 0.5 in scene units
  const scene = {
    axes: [lin(0, 2), lin(0, 2), lin(0, 10)] as [
      ReturnType<typeof lin>,
      ReturnType<typeof lin>,
      ReturnType<typeof lin>
    ],
    aspect: [1, 1, 0.5] as [number, number, number]
  }

  it('moves every vertex the same way, straight at the camera', () => {
    const up = liftGrid(x, y, z, scene, [0, 0, 1])
    // eps scene units along z = eps / 0.5 of the box's height = eps × 2 × 10 data units
    expect(up.z[1][1]).toBeCloseTo(5 + LIFT * 20)
    expect(up.x[1][1]).toBeCloseTo(1)
    expect(up.z[0][2]).toBeCloseTo(up.z[1][1]!)
    const side = liftGrid(x, y, z, scene, [3, -4, 0])
    expect(side.x[1][1]).toBeCloseTo(1 + LIFT * 0.6 * 2)
    expect(side.y[1][1]).toBeCloseTo(1 - LIFT * 0.8 * 2)
    expect(side.z[1][1]).toBeCloseTo(5)
  })

  it('works in log units on a log axis and keeps missing values missing', () => {
    const lx = [1, 10, 100]
    const zz: Array<Array<number | null>> = [
      [0, 0, 0],
      [0, null, 0],
      [0, 0, 0]
    ]
    const logScene = {
      ...scene,
      axes: [
        { range: [0, 2] as [number, number], log: true },
        scene.axes[1],
        scene.axes[2]
      ] as typeof scene.axes
    }
    const l = liftGrid(lx, y, zz, logScene, [1, 0, 0])
    expect(Math.log10(l.x[0][1])).toBeCloseTo(1 + LIFT * 2)
    expect(l.z[1][1]).toBeNull()
    expect(l.x[1][1]).toBe(10)
  })
})
