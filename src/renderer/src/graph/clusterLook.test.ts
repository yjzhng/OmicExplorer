/** A cluster plot's look is two settings — what marks the data, and the territory outlining it —
 *  read from new configs and from old ones that had a single combined `display`. */
import { describe, expect, it } from 'vitest'

import { clusterLook, quickOn } from './types'

describe('clusterLook', () => {
  it('reads the two settings as written', () => {
    expect(clusterLook({ display: 'replicate', outline: 'gaussian' })).toEqual({
      data: 'replicate',
      territory: 'gaussian'
    })
    expect(clusterLook({ display: 'centroid', outline: 'none' })).toEqual({
      data: 'centroid',
      territory: 'none'
    })
  })

  it("reads an old 'territory' display as centroids with its saved shape", () => {
    expect(clusterLook({ display: 'territory', territory: 'gaussian' })).toEqual({
      data: 'centroid',
      territory: 'gaussian'
    })
    expect(clusterLook({ display: 'territory' })).toEqual({ data: 'centroid', territory: 'hull' })
  })

  it('draws no outline on an old plot that never showed one, whatever shape lingers', () => {
    // A shape picked, then the display switched back: the old plot showed no outline.
    expect(clusterLook({ display: 'replicate', territory: 'hull' })).toEqual({
      data: 'replicate',
      territory: 'none'
    })
    expect(clusterLook({ display: 'centroid' })).toEqual({ data: 'centroid', territory: 'none' })
  })
})

describe('cluster quick access', () => {
  it('starts with only the plot type, the colouring and the territory on the tile', () => {
    const on = ['plot', 'colorBy', 'territory']
    const off = ['legend', 'clusterOn', 'clusterCount', 'display']
    for (const f of on) expect(quickOn({}, f, 'pca'), f).toBe(true)
    for (const f of off) expect(quickOn({}, f, 'pca'), f).toBe(false)
  })

  it("keeps the user's own choice either way", () => {
    expect(quickOn({ quick: { display: true } }, 'display', 'pca')).toBe(true)
    expect(quickOn({ quick: { territory: false } }, 'territory', 'pca')).toBe(false)
  })

  it('leaves every other kind on by default', () => {
    expect(quickOn({}, 'display')).toBe(true)
    expect(quickOn({}, 'legend', 'volcano')).toBe(true)
  })
})
