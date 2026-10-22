import { describe, expect, it } from 'vitest'

import { applyPlotAxes, AXIS_LINE_WIDTH, fitMargins, thinAxes, withoutLegend } from './plotAxes'

describe('thinAxes', () => {
  it('gives every shown 2-D axis the default widths and a frame', () => {
    const out = thinAxes({ xaxis: { title: 'x' }, yaxis2: {}, scene: {} })
    expect(out.xaxis).toEqual({
      title: 'x',
      linewidth: AXIS_LINE_WIDTH,
      gridwidth: AXIS_LINE_WIDTH,
      showline: true,
      mirror: true
    })
    expect(out.yaxis2).toMatchObject({ showline: true, mirror: true })
    expect(out.scene).toEqual({})
  })

  it("keeps the view's own settings, and frames no axis whose line is off", () => {
    const out = thinAxes({ xaxis: { linewidth: 2, showline: false }, yaxis: { visible: false } })
    expect(out.xaxis).toEqual({ linewidth: 2, gridwidth: AXIS_LINE_WIDTH, showline: false })
    expect(out.yaxis).toEqual({ visible: false })
  })

  it('a user turning the frame off wins over the default', () => {
    const lay = applyPlotAxes(thinAxes({ xaxis: {} }), { x: { mirror: false } }, [])
    expect((lay.xaxis as Record<string, unknown>).mirror).toBe(false)
  })

  it('a dashed axis line still gets its (hand-drawn) default frame', () => {
    const lay = applyPlotAxes(thinAxes({ xaxis: {} }), { x: { lineStyle: 'dash' } }, [])
    // the axis line and the frame both drawn as shapes
    expect((lay.shapes as unknown[]).length).toBe(2)
  })
})

describe('withoutLegend', () => {
  it('hides the legend and every colour scale bar', () => {
    const { traces, layout } = withoutLegend(
      [
        { type: 'heatmap', z: [[1]], colorscale: 'Viridis' },
        { type: 'scatter', marker: { color: [1], colorscale: 'Viridis', showscale: true } },
        { type: 'scatter', marker: { color: 'red' } }
      ],
      { showlegend: true, coloraxis: { colorscale: 'RdBu' } }
    )
    expect(layout.showlegend).toBe(false)
    expect(layout.coloraxis).toMatchObject({ showscale: false })
    expect(traces[0]).toMatchObject({ showscale: false })
    expect((traces[1] as { marker: unknown }).marker).toMatchObject({ showscale: false })
    // a trace with no scale is left as it was
    expect(traces[2]).toEqual({ type: 'scatter', marker: { color: 'red' } })
  })
})

describe('fitMargins', () => {
  it('leaves margins that fit, and an unmeasured box, alone', () => {
    const lay = { margin: { l: 10, r: 10, t: 30, b: 50 } }
    expect(fitMargins(lay, 400, 300)).toBe(lay)
    expect(fitMargins(lay, 0, 0)).toBe(lay)
  })

  it('scales a pair down, together, so the plot keeps room', () => {
    const out = fitMargins({ margin: { l: 10, r: 10, t: 30, b: 50 } }, 400, 64)
    const m = out.margin as Record<string, number>
    expect(m.t + m.b).toBeLessThanOrEqual(64 - 24)
    expect(m.t / m.b).toBeCloseTo(30 / 50, 1)
    expect(m.l).toBe(10)
  })
})
