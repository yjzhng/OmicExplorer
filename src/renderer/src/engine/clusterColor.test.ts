/**
 * Colouring an embedding by a COMPUTED grouping (`colorBy: 'cluster'`) rather than by a condition.
 *
 * Both knobs matter and are tested: what the grouping is computed from (the 2-D coordinates, or the
 * full feature matrix), and how the group count is chosen (fixed / one per condition / automatic).
 */
import { describe, expect, it } from 'vitest'

import { suggestClusterCount } from './cluster'
import { buildCluster, CLUSTER_COLOR } from './plotData'
import type { StandardRow } from './types'

/** Three conditions × 2 replicates, separated on a block of genes each. */
function rows(): StandardRow[] {
  const out: StandardRow[] = []
  const conds = ['A', 'B', 'C']
  conds.forEach((cmpd, ci) => {
    for (let rep = 1; rep <= 2; rep++) {
      for (let g = 0; g < 12; g++) {
        // Each condition's own block of 4 genes is high; the rest are low.
        const high = Math.floor(g / 4) === ci
        out.push({
          uniqID: `g${g}`,
          cell: 'WT',
          cmpd,
          dose: null,
          time: null,
          rep,
          value: (high ? 1000 : 10) + rep + g * 0.1
        })
      }
    }
  })
  return out
}

const groupsOf = (pts: Array<{ group: string }>): string[] => [...new Set(pts.map((p) => p.group))]

describe('colorBy: cluster', () => {
  it('labels points by cluster instead of by a condition value', () => {
    const c = buildCluster(rows(), { method: 'pca', colorBy: CLUSTER_COLOR, clusterK: 3 })
    expect(c.colorBy).toBe('cluster')
    expect(groupsOf(c.points).sort()).toEqual(['Cluster 1', 'Cluster 2', 'Cluster 3'])
    expect(c.clusterK).toBe(3)
  })

  it('still colours by a condition when asked to', () => {
    const c = buildCluster(rows(), { method: 'pca', colorBy: 'cmpd' })
    expect(groupsOf(c.points).sort()).toEqual(['A', 'B', 'C'])
    expect(c.clusterK).toBeUndefined()
  })

  it('recovers the real groups — replicates of one condition land in one cluster', () => {
    const c = buildCluster(rows(), { method: 'pca', colorBy: CLUSTER_COLOR, clusterK: 3 })
    const byCond = new Map<string, Set<string>>()
    for (const p of c.points) {
      if (!byCond.has(p.cond)) byCond.set(p.cond, new Set())
      byCond.get(p.cond)!.add(p.group)
    }
    // Every condition's replicates share one cluster, and no two conditions share it.
    for (const set of byCond.values()) expect(set.size).toBe(1)
    expect(new Set([...byCond.values()].map((s) => [...s][0])).size).toBe(byCond.size)
  })

  it('honours `clusterK`', () => {
    for (const k of [2, 3, 4]) {
      const c = buildCluster(rows(), { method: 'pca', colorBy: CLUSTER_COLOR, clusterK: k })
      expect(c.clusterK).toBe(k)
      expect(groupsOf(c.points)).toHaveLength(k)
    }
  })

  it('clamps k to the item count instead of inventing empty clusters', () => {
    const c = buildCluster(rows(), { method: 'pca', colorBy: CLUSTER_COLOR, clusterK: 99 })
    expect(c.clusterK).toBeLessThanOrEqual(c.points.length)
    expect(groupsOf(c.points).length).toBe(c.clusterK)
  })

  it("`clusterCount: 'conditions'` uses one group per distinct condition", () => {
    const c = buildCluster(rows(), {
      method: 'pca',
      colorBy: CLUSTER_COLOR,
      clusterCount: 'conditions'
    })
    // 3 conditions in the fixture (replicates share a condition).
    expect(c.clusterK).toBe(3)
  })

  it("`clusterCount: 'auto'` finds the count without being told", () => {
    const c = buildCluster(rows(), { method: 'pca', colorBy: CLUSTER_COLOR, clusterCount: 'auto' })
    expect(c.clusterK).toBe(3)
  })

  it('clusters coordinates or features, and coordinates follow the embedding method', () => {
    const feat = (method: 'pca' | 'tsne') =>
      buildCluster(rows(), {
        method,
        colorBy: CLUSTER_COLOR,
        clusterOn: 'features',
        clusterK: 3
      }).points.map((p) => p.group)
    // Clustering the features is a property of the data, so it is the same whichever method draws.
    expect(feat('pca')).toEqual(feat('tsne'))

    const coords = buildCluster(rows(), {
      method: 'pca',
      colorBy: CLUSTER_COLOR,
      clusterOn: 'coords',
      clusterK: 3
    })
    // Both sources should still recover 3 groups on data this cleanly separated.
    expect(groupsOf(coords.points)).toHaveLength(3)
  })
})

describe('suggestClusterCount', () => {
  const blob = (cx: number, cy: number): number[][] => [
    [cx, cy],
    [cx + 0.1, cy],
    [cx, cy + 0.1]
  ]

  it('finds the number of well-separated groups', () => {
    expect(suggestClusterCount([...blob(0, 0), ...blob(50, 0), ...blob(0, 50)])).toBe(3)
    expect(suggestClusterCount([...blob(0, 0), ...blob(50, 0)])).toBe(2)
  })

  it('degenerates safely', () => {
    expect(suggestClusterCount([])).toBe(1)
    expect(suggestClusterCount([[1, 1]])).toBe(1)
    expect(
      suggestClusterCount([
        [1, 1],
        [2, 2]
      ])
    ).toBe(1)
  })

  it('never exceeds its cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => [i * 10, 0])
    expect(suggestClusterCount(many, 4)).toBeLessThanOrEqual(4)
  })
})

describe('PCA loadings', () => {
  /** In the fixture each condition is high on its own block of 4 genes (g0-3 → A, g4-7 → B,
   *  g8-11 → C). A gene's loading must therefore point the same way as the condition it marks. */
  const cos = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
    const na = Math.hypot(a.x, a.y)
    const nb = Math.hypot(b.x, b.y)
    return na > 0 && nb > 0 ? (a.x * b.x + a.y * b.y) / (na * nb) : 0
  }

  it('are only computed when asked for', () => {
    expect(buildCluster(rows(), { method: 'pca', colorBy: 'cmpd' }).loadings).toBeUndefined()
    expect(
      buildCluster(rows(), { method: 'pca', colorBy: 'cmpd', loadings: 5 }).loadings
    ).toHaveLength(5)
  })

  it('are PCA-only — UMAP/t-SNE have no feature axes to project onto', () => {
    for (const method of ['umap', 'tsne'] as const)
      expect(
        buildCluster(rows(), { method, colorBy: 'cmpd', loadings: 5 }).loadings,
        method
      ).toBeUndefined()
  })

  it('point toward the condition whose genes they are', () => {
    const c = buildCluster(rows(), {
      method: 'pca',
      colorBy: 'cmpd',
      loadings: 12,
      displayMap: Object.fromEntries(Array.from({ length: 12 }, (_, g) => [`g${g}`, `gene${g}`]))
    })
    const lo = c.loadings!
    // A point per condition (replicates share coordinates on this fixture).
    const centroid = (cmpd: string) => {
      const pts = c.points.filter((p) => p.meta.cmpd === cmpd)
      return {
        x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
        y: pts.reduce((a, p) => a + p.y, 0) / pts.length
      }
    }
    for (const [cmpd, genes] of [
      ['A', [0, 1, 2, 3]],
      ['B', [4, 5, 6, 7]],
      ['C', [8, 9, 10, 11]]
    ] as const) {
      const target = centroid(cmpd)
      for (const g of genes) {
        const arrow = lo.find((l) => l.label === `gene${g}`)!
        expect(arrow, `gene${g}`).toBeDefined()
        // Same half-plane as its condition, and not perpendicular to it.
        expect(cos(arrow, target), `gene${g} vs ${cmpd}`).toBeGreaterThan(0.5)
      }
    }
  })

  it('carry display labels, and fall back to the id without a displayMap', () => {
    const named = buildCluster(rows(), {
      method: 'pca',
      colorBy: 'cmpd',
      loadings: 3,
      displayMap: { g0: 'argF' }
    }).loadings!
    expect(named.every((l) => typeof l.label === 'string' && l.label.length > 0)).toBe(true)
    const raw = buildCluster(rows(), { method: 'pca', colorBy: 'cmpd', loadings: 3 }).loadings!
    expect(raw.every((l) => /^g\d+$/.test(l.label))).toBe(true)
  })

  it('are ordered longest vector first', () => {
    const c = buildCluster(rows(), { method: 'pca', colorBy: 'cmpd', loadings: 12 })
    const lens = c.loadings!.map((l) => Math.hypot(l.x, l.y))
    expect([...lens].sort((a, b) => b - a)).toEqual(lens)
  })

  it('are unscaled — the loadings plot has its own axes, not the scores’', () => {
    // Asking for fewer features must not change the ones returned: a scaling factor derived from
    // the set would have made every coordinate depend on how many were requested.
    const all = buildCluster(rows(), { method: 'pca', colorBy: 'cmpd', loadings: 12 }).loadings!
    const few = buildCluster(rows(), { method: 'pca', colorBy: 'cmpd', loadings: 3 }).loadings!
    expect(few).toEqual(all.slice(0, 3))
  })
})
