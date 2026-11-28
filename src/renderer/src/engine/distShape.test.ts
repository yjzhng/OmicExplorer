import { describe, expect, it } from 'vitest'
import { distShape, VIOLIN_CAP } from './distShape'

/** a deterministic spread of values: a skewed mix */
function values(n: number): number[] {
  let s = 7
  const rnd = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  return Array.from({ length: n }, () => {
    const u = rnd()
    return u < 0.8
      ? 20 + 3 * Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(6.283 * rnd())
      : 30 + rnd() * 5
  })
}

describe('distShape', () => {
  it("states a box as Plotly's 'linear' quartiles would", () => {
    const d = distShape([4, 1, 3, 2])!
    // Plotly's interp: the p-quantile at p·n − ½
    expect(d.median).toBe(2.5)
    expect(d.q1).toBe(1.5)
    expect(d.q3).toBe(3.5)
    expect([d.min, d.max, d.n]).toEqual([1, 4, 4])
    // the tooltip's quartiles at (n − 1)·p, as the QC plot stated them before
    expect(d.tipQ1).toBe(1.75)
    expect(d.tipQ3).toBe(3.25)
  })
  it('keeps every value up to the cap, sorted', () => {
    const v = values(200)
    const d = distShape(v)!
    expect(d.sample).toEqual([...v].sort((a, b) => a - b))
  })
  it('past the cap, draws from quantiles that keep the ends and the quartiles', () => {
    const v = values(20000)
    const d = distShape(v)!
    expect(d.sample.length).toBe(VIOLIN_CAP)
    expect(d.sample[0]).toBe(d.min)
    expect(d.sample[VIOLIN_CAP - 1]).toBe(d.max)
    const sub = distShape(d.sample)!
    const iqr = d.q3 - d.q1
    expect(Math.abs(sub.median - d.median)).toBeLessThan(iqr * 0.01)
    expect(Math.abs(sub.q1 - d.q1)).toBeLessThan(iqr * 0.01)
    expect(Math.abs(sub.q3 - d.q3)).toBeLessThan(iqr * 0.01)
    // the bandwidth is the one for all the values, narrower than the sample's own
    expect(d.bandwidth).toBeLessThan(sub.bandwidth)
  })
  it('skips non-finite values; none at all is null', () => {
    expect(distShape([NaN, Infinity])).toBeNull()
    expect(distShape([1, NaN, 3])!.n).toBe(2)
  })
})
