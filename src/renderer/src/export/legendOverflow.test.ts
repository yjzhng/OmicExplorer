import { describe, expect, it } from 'vitest'

import { extendPaperDown, legendOverflow } from './legendOverflow'

describe('legendOverflow', () => {
  it('is 0 when every legend shows whole', () => {
    expect(legendOverflow({ legend: { _height: 200, _effHeight: 200, y: 1 } })).toBe(0)
    expect(legendOverflow({})).toBe(0)
    expect(legendOverflow(undefined)).toBe(0)
  })
  it('a legend beside the plot: what is cut off', () => {
    expect(legendOverflow({ legend: { _height: 900, _effHeight: 400, y: 1 } })).toBe(500)
  })
  it('a legend above or below the plot: twice that (capped at half the figure)', () => {
    expect(legendOverflow({ legend: { _height: 500, _effHeight: 300, y: -0.2 } })).toBe(400)
    expect(
      legendOverflow({ legend: { _height: 500, _effHeight: 300, y: 1, yanchor: 'bottom' } })
    ).toBe(400)
  })
  it('the most any legend needs, of several', () => {
    expect(
      legendOverflow({
        legend: { _height: 600, _effHeight: 400, y: 1 },
        legend2: { _height: 1000, _effHeight: 400, y: 0.5 },
        xaxis: { _height: 9999 }
      })
    ).toBe(600)
  })
})

describe('extendPaperDown', () => {
  // plot area 400 px tall, 200 px of room added under it: a paper fraction keeps its pixels from
  // the top — y → 1 − (1 − y)·400/600
  const full = {
    _size: { h: 400 },
    yaxis: { domain: [0, 1] },
    yaxis2: { domain: [0.55, 1] },
    xaxis: { anchor: 'y' },
    legend: { y: 1 }
  }
  const at = (y: number): number => 1 - ((1 - y) * 400) / 600

  it('keeps every subplot where it was drawn, the room left under it', () => {
    const layout: Record<string, unknown> = { yaxis: { title: 'a' } }
    extendPaperDown(layout, [], full, 200)
    expect(layout.yaxis).toEqual({ title: 'a', domain: [at(0), 1] })
    expect(layout.yaxis2).toEqual({ domain: [at(0.55), 1] })
    expect(layout.xaxis).toBeUndefined()
    expect(layout.legend).toEqual({ y: 1 })
  })

  it('moves what is placed by paper fraction, leaves what is placed by data', () => {
    const layout: Record<string, unknown> = {
      annotations: [
        { yref: 'paper', y: 0, text: 'p' },
        { yref: 'y', y: 0, text: 'd' }
      ],
      shapes: [{ yref: 'paper', y0: 0, y1: 1 }],
      images: [{ yref: 'paper', y: 0.5, sizey: 0.3 }]
    }
    extendPaperDown(layout, [], full, 200)
    expect(layout.annotations).toEqual([
      { yref: 'paper', y: at(0), text: 'p' },
      { yref: 'y', y: 0, text: 'd' }
    ])
    expect(layout.shapes).toEqual([{ yref: 'paper', y0: at(0), y1: 1 }])
    expect(layout.images).toEqual([{ yref: 'paper', y: at(0.5), sizey: 0.3 * (400 / 600) }])
  })

  it('keeps a colour bar its drawn length and place', () => {
    const data: Record<string, unknown>[] = [
      { type: 'heatmap', colorbar: { len: 1 } },
      { type: 'scatter', marker: { showscale: true } },
      { type: 'scatter' }
    ]
    extendPaperDown({}, data, full, 200)
    expect(data[0].colorbar).toEqual({ len: 400 / 600, y: at(0.5) })
    expect((data[1].marker as { colorbar: unknown }).colorbar).toEqual({
      len: 400 / 600,
      y: at(0.5)
    })
    expect(data[2]).toEqual({ type: 'scatter' })
  })

  it('changes nothing without room to add', () => {
    const layout: Record<string, unknown> = { yaxis: {} }
    extendPaperDown(layout, [], full, 0)
    expect(layout).toEqual({ yaxis: {} })
  })
})
