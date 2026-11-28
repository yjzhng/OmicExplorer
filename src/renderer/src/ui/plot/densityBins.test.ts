import { describe, expect, it } from 'vitest'

import {
  BIN_EXTENT,
  BIN_IDS,
  BIN_MIN_POINTS,
  binDenseTraces,
  DENSITY_OF,
  densityCounts,
  wouldBin
} from './densityBins'

/** A deterministic pseudo-random cloud (LCG), with a few NaN/null points mixed in. */
function cloud(n: number, seed = 1): { x: (number | null)[]; y: number[]; ids: string[] } {
  let s = seed
  const rnd = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1
  const x: (number | null)[] = []
  const y: number[] = []
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    x.push(i % 997 === 5 ? null : rnd() * 3 + rnd())
    y.push(i % 991 === 7 ? NaN : Math.abs(rnd() * 4))
    ids.push(`g${i}`)
  }
  return { x, y, ids }
}

/** A view's three effect traces, as VolcanoView builds them (the bulk flagged). */
function volcano(n: number) {
  const c = cloud(n)
  const bulk = {
    type: 'scatter',
    mode: 'markers',
    name: `not significant (${n})`,
    showlegend: true,
    x: c.x,
    y: c.y,
    text: c.ids.map((id) => id.toUpperCase()),
    customdata: c.ids,
    hovertemplate: '%{text}',
    marker: { color: '#9e9e9e', size: 6, opacity: 0.6, line: { width: 0.5, color: '#000' } }
  }
  const up = {
    type: 'scatter',
    mode: 'markers',
    name: 'up (2)',
    x: [5, 6],
    y: [9, 10],
    customdata: ['u1', 'u2'],
    marker: { color: '#d62728', size: 8 }
  }
  return { bulk, up, flagged: [{ ...bulk, __oeBin: true }, up] }
}

describe('binDenseTraces', () => {
  it('returns the very array when no trace is flagged', () => {
    const { bulk, up } = volcano(200)
    const data = [bulk, up]
    expect(binDenseTraces(data, new Set(), 100).traces).toBe(data)
  })

  it('below the threshold the traces are exactly the unflagged ones', () => {
    const { bulk, up, flagged } = volcano(1000)
    const out = binDenseTraces(flagged, new Set(['g3']), 1000)
    expect(out.density.size).toBe(0)
    expect(out.traces).toEqual([bulk, up])
    expect(out.traces[1]).toBe(up)
    expect(wouldBin(flagged, 1000)).toBe(false)
  })

  it('defaults to a 100 000-point threshold', () => {
    expect(BIN_MIN_POINTS).toBe(100_000)
    const { flagged } = volcano(5000)
    expect(binDenseTraces(flagged).density.size).toBe(0)
  })

  it('above it: markers keep exactly the labelled points, bins hold the rest, extent is the data’s', () => {
    const n = 20_000
    const { bulk, up, flagged } = volcano(n)
    const keep = new Set(['g0', 'g17', 'g4321', 'g19999', 'u1', 'nope'])
    expect(wouldBin(flagged, 10_000)).toBe(true)
    const out = binDenseTraces(flagged, keep, 10_000)
    // view slots unchanged in order; density + extent appended
    expect(out.traces).toHaveLength(4)
    expect(out.traces[1]).toBe(up)
    expect(out.density.get(0)).toBe(2)

    const markers = out.traces[0] as Record<string, unknown> & {
      marker: Record<string, unknown>
    }
    const keptIdx = [0, 17, 4321, 19999]
    expect(markers.customdata).toEqual(keptIdx.map((k) => `g${k}`))
    expect(markers.x).toEqual(keptIdx.map((k) => bulk.x[k]))
    expect(markers.y).toEqual(keptIdx.map((k) => bulk.y[k]))
    expect(markers.text).toEqual(keptIdx.map((k) => `G${k}`))
    expect(markers.marker).toEqual(bulk.marker)
    expect(markers.name).toBe(bulk.name)
    expect(markers[BIN_IDS]).toBe(bulk.customdata)
    expect(markers.__oeBin).toBeUndefined()

    const dens = out.traces[2] as Record<string, unknown>
    expect(dens.type).toBe('heatmap')
    expect(dens.hoverinfo).toBe('skip')
    expect(dens.showscale).toBe(false)
    expect(dens[DENSITY_OF]).toBe(0)
    // no ids on the density: the highlight and click paths skip it
    expect(dens.customdata).toBeUndefined()
    const counts = densityCounts(dens as { z: (number | null)[][] })
    const total = counts.flat().reduce((a, b) => a + b, 0)
    const finitePts = bulk.x.filter(
      (x, k) => typeof x === 'number' && Number.isFinite(bulk.y[k])
    ).length
    const keptFinite = keptIdx.filter(
      (k) => typeof bulk.x[k] === 'number' && Number.isFinite(bulk.y[k])
    ).length
    expect(total).toBe(finitePts - keptFinite)
    expect(counts).toHaveLength(200)
    expect(counts[0]).toHaveLength(300)

    // the extent: the full cloud's min/max on both axes, invisible, inert
    const fx = bulk.x.filter(
      (x, k): x is number => typeof x === 'number' && Number.isFinite(bulk.y[k])
    )
    const fy = bulk.y.filter((y, k) => Number.isFinite(y) && typeof bulk.x[k] === 'number')
    const ext = out.traces[3] as Record<string, unknown> & {
      x: number[]
      y: number[]
      marker: Record<string, unknown>
    }
    expect(ext[BIN_EXTENT]).toBe(true)
    expect(ext.hoverinfo).toBe('skip')
    expect(ext.marker.opacity).toBe(0)
    expect(Math.min(...ext.x)).toBe(Math.min(...fx))
    expect(Math.max(...ext.x)).toBe(Math.max(...fx))
    expect(Math.min(...ext.y)).toBe(Math.min(...fy))
    expect(Math.max(...ext.y)).toBe(Math.max(...fy))
    expect(ext.marker.size).toBe(6)
    // the density's cells span exactly that extent
    const x0 = dens.x0 as number
    const dx = dens.dx as number
    expect(x0 - dx / 2).toBeCloseTo(Math.min(...fx), 9)
    expect(x0 - dx / 2 + 300 * dx).toBeCloseTo(Math.max(...fx), 9)
    // every trace of the split shares one legend group, so a legend toggle hides them together
    expect(new Set([markers, dens, ext].map((t) => t.legendgroup)).size).toBe(1)
  })

  it('places each point in its bin and slices per-point marker arrays', () => {
    const x = [0, 0.1, 9.9, 10, 5, 5]
    const y = [0, 0, 10, 10, 5, 5]
    const data = [
      {
        type: 'scatter',
        mode: 'markers',
        __oeBin: true,
        x,
        y,
        customdata: ['a', 'b', 'c', 'd', 'e', 'f'],
        marker: { color: 'rgb(10,20,30)', size: [1, 2, 3, 4, 5, 6] }
      }
    ]
    const out = binDenseTraces(data, new Set(['e']), 5, { x: 2, y: 2 })
    const m = out.traces[0] as { marker: { size: number[] }; customdata: string[] }
    expect(m.customdata).toEqual(['e'])
    expect(m.marker.size).toEqual([5])
    expect(densityCounts(out.traces[1] as { z: (number | null)[][] })).toEqual([
      [2, 0],
      [0, 3]
    ])
    // zero bins are transparent gaps
    expect((out.traces[1] as { z: unknown[][] }).z[0][1]).toBeNull()
  })

  it('leaves a trace it cannot colour-match as points', () => {
    const data = [
      {
        type: 'scatter',
        mode: 'markers',
        __oeBin: true,
        x: [1, 2, 3],
        y: [1, 2, 3],
        marker: { color: ['#111', '#222', '#333'] }
      }
    ]
    const out = binDenseTraces(data, new Set(), 1)
    expect(out.density.size).toBe(0)
    expect(out.traces).toEqual([
      {
        type: 'scatter',
        mode: 'markers',
        x: [1, 2, 3],
        y: [1, 2, 3],
        marker: { color: ['#111', '#222', '#333'] }
      }
    ])
  })
})
