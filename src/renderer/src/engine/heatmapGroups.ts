/** A Clean data heatmap's gene clustering as a plot run keeps it (nodes/heatmap/run.ts, in the
 *  worker): each cluster group as its genes (uniqIDs), so it matches the rows wherever they're
 *  pivoted again — by gene, not position — and the tile draws without clustering (groupsAt). */
import { clusterRowGroups } from './cluster'
import { buildHeatmapSteps } from './plotData'
import { fromLinear, type ValueScale } from './scale'
import type { StandardRow } from './types'

export interface HeatmapGroups {
  /** how many gene rows were clustered */
  n: number
  /** the cluster groups, each its genes' uniqIDs (empty: too few genes to cluster) */
  groups: string[][]
}

/** Pivot the rows (their values put on `scale`, as presentStd does), cluster the gene rows and
 *  cut the tree, as buildHeatmapSteps' clustering step does. */
export function heatmapGroups(
  rows: Iterable<StandardRow>,
  scale: ValueScale,
  k?: number
): HeatmapGroups {
  const scaled = function* (): Generator<StandardRow> {
    for (const r of rows) yield r.value == null ? r : { ...r, value: fromLinear(r.value, scale) }
  }
  const gen = buildHeatmapSteps(scaled(), {
    log10: false,
    order: { by: 'natural' },
    ...(k ? { clusterGroups: k } : null)
  })
  const r = gen.next()
  if (r.done) return { n: r.value.geneIds.length, groups: [] }
  const { matrix, k: kk, genes } = r.value
  return {
    n: matrix.length,
    groups: clusterRowGroups(matrix, kk).map((g) => g.map((i) => genes[i]))
  }
}

/** A run's groups as positions among `genes` (a heatmap's rows to cluster) — null unless they cover
 *  exactly those genes. */
export function groupsAt(
  run: HeatmapGroups | undefined,
  genes: readonly string[]
): number[][] | null {
  if (!run || run.n !== genes.length) return null
  const at = new Map<string, number>()
  genes.forEach((g, i) => at.set(g, i))
  let seen = 0
  const out: number[][] = []
  for (const g of run.groups) {
    const idx: number[] = []
    for (const id of g) {
      const i = at.get(id)
      if (i == null) return null
      idx.push(i)
    }
    seen += idx.length
    out.push(idx)
  }
  return seen === genes.length ? out : null
}
