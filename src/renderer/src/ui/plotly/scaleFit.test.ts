import { describe, expect, it } from 'vitest'
import { scaleFit, scaleLevel, withScaleFit } from './scaleFit'

// the enrichment dot plot's bar: 30% of the plot's height, no padding, a 13px title on top
const enrichBar = {
  title: { text: 'up', side: 'top', font: { size: 13 } },
  thickness: 9,
  lenmode: 'fraction',
  len: 0.3,
  ypad: 0
}

describe('scaleLevel', () => {
  it('whole when the bar and its title fit', () => {
    expect(scaleLevel(enrichBar, 300, 300)).toBe(2)
  })
  it('without its title when only the bar fits', () => {
    // 0.3 × 80 = 24px: the bar fits, the title (~22px) on top of it doesn't
    expect(scaleLevel(enrichBar, 300, 80)).toBe(1)
  })
  it('not at all when even the bar doesn’t', () => {
    // 0.3 × 30 = 9px
    expect(scaleLevel(enrichBar, 300, 30)).toBe(0)
  })
  it('a title beside a vertical bar takes none of its length', () => {
    const side = { title: { text: 'log₂FC', side: 'right' }, len: 0.3 }
    // 0.3 × 110 = 33px less Plotly's default 10px padding each end: 13px of bar
    expect(scaleLevel(side, 300, 110)).toBe(2)
  })
  it('a pixel length is its own, whatever the plot', () => {
    expect(scaleLevel({ lenmode: 'pixels', len: 120, ypad: 0 }, 300, 40)).toBe(2)
  })
})

describe('scaleFit', () => {
  const traces = [
    { type: 'scatter', marker: { color: [1, 2], colorbar: enrichBar } },
    { type: 'heatmap', z: [[1]], colorbar: { title: { text: 'z' } } },
    { type: 'scatter', marker: { color: [1], showscale: false, colorbar: enrichBar } }
  ]

  it('fits every bar shown, trace and layout alike, and leaves hidden ones be', () => {
    const fits = scaleFit(traces, { coloraxis: { colorbar: { len: 0.3 } } }, 300, 30)
    // the heatmap's whole-height bar: 30px less 10px padding each end fits, its title (on top, by
    // Plotly's default) doesn't
    expect(fits.map((f) => [f.trace, f.level])).toEqual([
      [0, 0],
      [1, 1],
      [null, 0]
    ])
  })

  it('writes the edits in, and gives a bar its own back when it fits again', () => {
    const small = withScaleFit(traces, {}, scaleFit(traces, {}, 300, 80))
    const m0 = (small.traces[0] as { marker: Record<string, unknown> }).marker
    expect((m0.colorbar as { title: { text: string } }).title.text).toBe('')
    const big = scaleFit(small.traces, {}, 300, 300)
    // (the fit reads the bar as the view drew it: titled again from the original)
    expect(scaleFit(traces, {}, 300, 300)[0].edits).toEqual({
      'marker.showscale': null,
      'marker.colorbar.title.text': 'up'
    })
    expect(big[0].level).toBe(2)
  })

  it('leaves the inputs untouched', () => {
    withScaleFit(traces, {}, scaleFit(traces, {}, 300, 30))
    expect(traces[0].marker.colorbar.title.text).toBe('up')
  })
})
