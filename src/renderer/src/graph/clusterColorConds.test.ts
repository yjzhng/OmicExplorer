import { describe, expect, it } from 'vitest'

import { clusterColorConds, clusterTwoConds, type ClusterConfig } from './types'

const cfg = (o: Partial<ClusterConfig>): ClusterConfig =>
  ({ method: 'pca', colorBy: 'cmpd', display: 'replicate', ...o }) as ClusterConfig

describe('cluster colour by up to two conditions', () => {
  it('reads colorBy alone until two are picked', () => {
    expect(clusterColorConds(cfg({}))).toEqual(['cmpd'])
    expect(clusterTwoConds(cfg({}))).toBeNull()
  })
  it('draws a colour and a dose/time shade, no arrows', () => {
    const c = cfg({ colorConds: ['cmpd', 'dose'] })
    expect(clusterColorConds(c)).toEqual(['cmpd', 'dose'])
    expect(clusterTwoConds(c)).toEqual({ color: ['cmpd'], shade: 'dose', arrow: 'none' })
  })
  it('drops the pair when colorBy is later switched to another condition, or to clusters', () => {
    expect(clusterColorConds(cfg({ colorBy: 'cell', colorConds: ['cmpd', 'dose'] }))).toEqual([
      'cell'
    ])
    expect(clusterColorConds(cfg({ colorBy: 'cluster', colorConds: ['cmpd', 'dose'] }))).toEqual([])
  })
})

describe('cluster colour by a numeric condition', () => {
  it('takes no shade on top of dose or time', () => {
    expect(clusterColorConds(cfg({ colorBy: 'dose', colorConds: ['cmpd', 'dose'] }))).toEqual([
      'dose'
    ])
  })
})
