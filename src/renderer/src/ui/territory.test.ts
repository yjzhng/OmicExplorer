/** Cluster-plot territory geometry: the convex hull of a condition's replicates, and the Gaussian
 *  alternative. Degenerate inputs matter here — a condition can easily have 1 or 2 replicates, or
 *  replicates that land on the same spot. */
import { describe, expect, it } from 'vitest'

import { convexHull, gaussianEllipse, territoryRing, type Pt } from './territory'

const p = (x: number, y: number): Pt => ({ x, y })
const setOf = (pts: Pt[]): Set<string> => new Set(pts.map((q) => `${q.x},${q.y}`))

describe('convexHull', () => {
  it('returns the corners of a square and drops an interior point', () => {
    const h = convexHull([p(0, 0), p(2, 0), p(2, 2), p(0, 2), p(1, 1)])
    expect(h).toHaveLength(4)
    expect(setOf(h)).toEqual(setOf([p(0, 0), p(2, 0), p(2, 2), p(0, 2)]))
  })

  it('drops a point lying ON an edge (only real corners survive)', () => {
    const h = convexHull([p(0, 0), p(2, 0), p(2, 2), p(0, 2), p(1, 0)])
    expect(h).toHaveLength(4)
    expect(setOf(h)).not.toContain('1,0')
  })

  it('winds counter-clockwise', () => {
    const h = convexHull([p(0, 0), p(2, 0), p(2, 2), p(0, 2)])
    // Shoelace area is positive for a counter-clockwise ring.
    let a = 0
    for (let i = 0; i < h.length; i++) {
      const q = h[i]
      const r = h[(i + 1) % h.length]
      a += q.x * r.y - r.x * q.y
    }
    expect(a).toBeGreaterThan(0)
  })

  it('collapses collinear points to their two extremes', () => {
    expect(convexHull([p(0, 0), p(1, 1), p(2, 2)])).toEqual([p(0, 0), p(2, 2)])
  })

  it('handles too-few and duplicate points without inventing area', () => {
    expect(convexHull([])).toEqual([])
    expect(convexHull([p(1, 1)])).toEqual([p(1, 1)])
    expect(convexHull([p(1, 1), p(1, 1), p(1, 1)])).toEqual([p(1, 1)])
    expect(convexHull([p(0, 0), p(1, 0)])).toEqual([p(0, 0), p(1, 0)])
  })
})

describe('gaussianEllipse', () => {
  it('centres on the mean', () => {
    const ring = gaussianEllipse([p(9, 19), p(11, 21), p(11, 19), p(9, 21)])
    expect(ring).not.toBeNull()
    const n = ring!.length
    const cx = ring!.reduce((s, q) => s + q.x, 0) / n
    const cy = ring!.reduce((s, q) => s + q.y, 0) / n
    expect(cx).toBeCloseTo(10, 6)
    expect(cy).toBeCloseTo(20, 6)
  })

  it('scales with the spread, and stretches along the dominant axis', () => {
    // Wide in x, narrow in y.
    const ring = gaussianEllipse([p(-10, 0), p(10, 0), p(0, 1), p(0, -1)])!
    const xs = ring.map((q) => q.x)
    const ys = ring.map((q) => q.y)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)
    expect(spanX).toBeGreaterThan(spanY * 3)
  })

  it('covers the points it was built from (a 95% region of 4 symmetric points)', () => {
    const pts = [p(0, 0), p(2, 0), p(2, 2), p(0, 2)]
    const ring = gaussianEllipse(pts)!
    const xs = ring.map((q) => q.x)
    const ys = ring.map((q) => q.y)
    expect(Math.min(...xs)).toBeLessThan(0)
    expect(Math.max(...xs)).toBeGreaterThan(2)
    expect(Math.min(...ys)).toBeLessThan(0)
    expect(Math.max(...ys)).toBeGreaterThan(2)
  })

  it('declines to draw when there is no spread to estimate', () => {
    expect(gaussianEllipse([])).toBeNull()
    expect(gaussianEllipse([p(1, 1)])).toBeNull()
    expect(gaussianEllipse([p(0, 0), p(1, 1)])).toBeNull() // 2 points: degenerate
    expect(gaussianEllipse([p(1, 1), p(1, 1), p(1, 1)])).toBeNull() // all identical
    expect(gaussianEllipse([p(0, 0), p(1, 1), p(2, 2)])).toBeNull() // exactly collinear
  })
})

describe('territoryRing', () => {
  it('closes the ring so it can be filled', () => {
    const ring = territoryRing([p(0, 0), p(2, 0), p(1, 2)], 'hull')!
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring).toHaveLength(4) // 3 corners + the repeat
  })

  it('keeps a 2-replicate hull as a segment (spread shown, no area claimed)', () => {
    const ring = territoryRing([p(0, 0), p(4, 1)], 'hull')!
    expect(ring).toEqual([p(0, 0), p(4, 1), p(0, 0)])
  })

  it('gives a single replicate no territory in either shape', () => {
    expect(territoryRing([p(1, 1)], 'hull')).toBeNull()
    expect(territoryRing([p(1, 1)], 'gaussian')).toBeNull()
    expect(territoryRing([p(1, 1), p(1, 1)], 'hull')).toBeNull()
  })

  it('gives a 2-replicate gaussian no territory (unlike the hull)', () => {
    expect(territoryRing([p(0, 0), p(4, 1)], 'gaussian')).toBeNull()
    expect(territoryRing([p(0, 0), p(4, 1)], 'hull')).not.toBeNull()
  })
})
