import { describe, expect, it } from 'vitest'

import { hasGlTraces, toGlOverlay, toGlTraces, toSvgTraces } from './glTraces'

const pts = (n: number): number[] => Array.from({ length: n }, (_, i) => i)

describe('toGlTraces', () => {
  it('leaves a sparse plot as SVG (same array)', () => {
    const data = [{ type: 'scatter', mode: 'markers', x: pts(100), y: pts(100) }]
    expect(toGlTraces(data, 3000)).toBe(data)
  })

  it('switches every plain marker trace once the plot is dense', () => {
    const data = [
      { type: 'scatter', mode: 'markers', x: pts(2500) },
      { mode: 'markers', x: pts(600) },
      { type: 'scatter', mode: 'lines', x: pts(5000) },
      { type: 'scatter', mode: 'markers+text', x: pts(10) },
      { type: 'scatter', mode: 'markers', fill: 'tozeroy', x: pts(10) },
      { type: 'scatter', mode: 'markers', x: pts(10), __oeNoGl: true },
      { type: 'bar', x: pts(10) }
    ]
    const out = toGlTraces(data, 3000) as { type?: string }[]
    expect(out.map((t) => t.type)).toEqual([
      'scattergl',
      'scattergl',
      'scattergl',
      'scatter',
      'scatter',
      'scatter',
      'bar'
    ])
    expect(hasGlTraces(out)).toBe(true)
    expect(data[0].type).toBe('scatter') // input untouched
  })

  it('does not count lines or an unset mode toward the threshold', () => {
    const data = [
      { type: 'scatter', x: pts(5000) },
      { type: 'scatter', mode: 'lines', x: pts(5000) }
    ]
    expect(toGlTraces(data, 3000)).toBe(data)
  })
})

describe('toSvgTraces', () => {
  it('swaps scattergl back to scatter and keeps everything else', () => {
    const gl = toGlTraces([{ type: 'scatter', mode: 'markers', x: pts(4000), marker: { size: 5 } }])
    const svg = toSvgTraces(gl) as { type: string; marker: unknown }[]
    expect(svg[0].type).toBe('scatter')
    expect(svg[0].marker).toEqual({ size: 5 })
    expect(hasGlTraces(svg)).toBe(false)
  })
})

describe('toGlOverlay', () => {
  it('draws the overlay in WebGL with a named bold, and toSvgTraces restores it exactly', () => {
    const overlay = {
      type: 'scatter',
      mode: 'markers+text',
      x: [1],
      textfont: { size: [12], color: '#000', weight: 700 },
      marker: { size: [9] }
    }
    const gl = toGlOverlay(overlay) as { type: string; textfont: { weight: unknown } }
    expect(gl.type).toBe('scattergl')
    expect(gl.textfont.weight).toBe('bold')
    expect(overlay.textfont.weight).toBe(700) // input untouched
    expect(toSvgTraces([gl])[0]).toEqual(overlay)
  })

  it('round-trips an overlay without a weight or a textfont', () => {
    const a = { type: 'scatter', mode: 'markers+text', textfont: { size: [12] } }
    expect(toSvgTraces([toGlOverlay(a)])[0]).toEqual(a)
    const b = { type: 'scatter', mode: 'markers' }
    expect(toSvgTraces([toGlOverlay(b)])[0]).toEqual(b)
  })
})
