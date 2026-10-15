/**
 * A cluster plot's run computes the embedding (in the worker); which setting changes need another
 * run, and which only redraw from the stored one.
 */
import { describe, expect, it } from 'vitest'

import { NODE_SPECS } from './registry'
import { clusterRunOf, type ClusterConfig, type NodeResult } from './types'

const base = NODE_SPECS.pca.defaultConfig() as ClusterConfig
const ranOn = (c: ClusterConfig): NodeResult => ({
  kind: 'cluster',
  cluster: { points: [], method: c.method, varExplained: [0, 0], colorBy: c.colorBy },
  ran: clusterRunOf(c)
})
const stale = (next: Partial<ClusterConfig>, from: ClusterConfig = base): boolean =>
  NODE_SPECS.pca.staleOn!({ ...from, ...next }, from, ranOn(from))

describe('cluster plot staleness', () => {
  it('view settings only redraw', () => {
    expect(stale({ colorBy: 'cell' })).toBe(false)
    expect(stale({ plot: 'scree' })).toBe(false)
    expect(stale({ plot: 'loadings', loadings: 25 })).toBe(false)
    expect(stale({ outline: 'gaussian', display: 'centroid' })).toBe(false)
    expect(stale({ legend: 'complex', markerSize: 12 })).toBe(false)
  })
  it('the embedding’s settings need another run', () => {
    expect(stale({ method: 'umap' })).toBe(true)
    expect(stale({ scale: 'unit' })).toBe(true)
    expect(stale({ missing: 'impute' })).toBe(true)
    expect(stale({ center: 'median' })).toBe(true)
    expect(stale({ topVar: 500 })).toBe(true)
    expect(stale({ transform: 'log2' })).toBe(true)
    expect(stale({ replicates: 'mean' })).toBe(true)
  })
  it('colouring by cluster needs a run that computed that clustering', () => {
    expect(stale({ colorBy: 'cluster' })).toBe(true)
    const byCluster = { ...base, colorBy: 'cluster' as const }
    expect(stale({ clusterK: 5 }, byCluster)).toBe(true)
    expect(stale({ clusterOn: 'features' }, byCluster)).toBe(true)
    // the clustering's settings are ignored while colouring by a condition
    expect(stale({ clusterK: 5 })).toBe(false)
    // back to a condition reads the same embedding
    expect(stale({ colorBy: 'cmpd' }, byCluster)).toBe(false)
  })
  it('a result from before the cluster computed in its run needs one', () => {
    expect(NODE_SPECS.pca.staleOn!(base, base, { kind: 'plot' })).toBe(true)
  })
})
