/** Two-condition Response panel body: one gene's measured log₂FC over a pair of numeric conditions
 *  (dose × time, or any two), drawn by the Response plot's views (ResponseSurfaceView) — 2-D lines
 *  per level of the second or a heatmap, 3-D lines or a surface. The first condition takes the
 *  view's dose slot (x), the second its time slot (the lines). */
import { useMemo } from 'react'

import {
  comparisonOf,
  ctxNum,
  detectAxisScale,
  replicateLog2FCs,
  type StdLookup,
  type CompareResultRow,
  type ConditionKey
} from '../engine'
import type { ResponseLook } from '../graph/types'
import type { PaletteRef } from '../ui/palettes'
import {
  ResponseSurfaceView,
  type MeasuredCell,
  type ResponseShow
} from '../ui/ResponseSurfaceView'

export function TdrBody({
  rows,
  pair,
  gene,
  std,
  global,
  scaleGenes,
  ...view
}: {
  /** the facet's rows (the pair's two conditions left free) */
  rows: CompareResultRow[]
  /** the two numeric conditions: along x, and one line per level */
  pair: [ConditionKey, ConditionKey]
  gene: string
  /** the Clean data rows the Compare ran on — each level's replicates are drawn from them */
  std?: StdLookup
  /** scale: global — the value axis spans every gene in the facet, so paging keeps one scale */
  global?: boolean
  /** a global scale over just these genes (the selection on show); unset = every gene */
  scaleGenes?: readonly string[]
  dim: '2d' | '3d'
  show: ResponseShow
  look: ResponseLook
  /** lines (2-D or 3-D): a curve along the first at each level of the second ('time'), or the reverse */
  slice?: 'time' | 'dose'
  /** 3-D: the camera's projection */
  projection?: 'perspective' | 'orthographic'
  rolePalettes: { value: PaletteRef; points: PaletteRef }
  doseLabel?: string
  timeLabel?: string
}) {
  const [ax, ay] = pair
  // Each level pair of the gene: its log₂FC, the fold change's SE and its replicates.
  const measured = useMemo(() => {
    const geneStd = std?.get(gene) ?? []
    const mine = rows.filter((r) => r.uniqID === gene)
    const cells: MeasuredCell[] = []
    for (const r of mine) {
      const x = ctxNum(r, ax)
      const y = ctxNum(r, ay)
      if (x == null || y == null || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
      cells.push({
        dose: x,
        time: y,
        y: r.log2FC,
        ...(r.fcSE != null ? { se: r.fcSE } : null),
        reps: replicateLog2FCs(r, geneStd)
      })
    }
    return { cells, comparison: comparisonOf(mine) }
  }, [rows, gene, std, ax, ay])
  // Each axis log or linear by its levels' spacing (detectAxisScale) — over the facet's levels, so
  // every gene is drawn on the same axes; linear where it can't tell, as a curve fit's.
  const scales = useMemo(() => {
    const scaleOf = (c: ConditionKey): 'log' | 'linear' => {
      const levels = [
        ...new Set(rows.map((r) => ctxNum(r, c)).filter((v): v is number => v != null))
      ]
      return detectAxisScale(levels).scale ?? 'linear'
    }
    return { x: scaleOf(ax), y: scaleOf(ay) }
  }, [rows, ax, ay])
  const range = useMemo(() => {
    if (!global) return undefined
    const keep = scaleGenes ? new Set(scaleGenes) : null
    return tdrValueRange(keep ? rows.filter((r) => keep.has(r.uniqID)) : rows, [ax, ay], std)
  }, [global, scaleGenes, rows, ax, ay, std])
  return (
    <ResponseSurfaceView
      measured={measured}
      valueRange={range}
      scales={scales}
      xRole={ax === 'time' ? 'time' : 'dose'}
      yRole={ay === 'time' ? 'time' : 'dose'}
      {...view}
    />
  )
}

/** The value range the given genes (rows) span over the pair — fold changes, their error bars and
 *  their replicates — padded a little, so a global scale clips none of them. */
function tdrValueRange(
  rows: CompareResultRow[],
  [ax, ay]: [ConditionKey, ConditionKey],
  byGene: StdLookup | undefined
): [number, number] | undefined {
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number): void => {
    if (!Number.isFinite(v)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (const r of rows) {
    if (ctxNum(r, ax) == null || ctxNum(r, ay) == null) continue
    if (r.log2FC == null || !Number.isFinite(r.log2FC)) continue
    const se = r.fcSE ?? 0
    take(r.log2FC - se)
    take(r.log2FC + se)
    const g = byGene?.get(r.uniqID)
    if (g) for (const v of replicateLog2FCs(r, g)) take(v)
  }
  if (!(lo <= hi)) return undefined
  const pad = (hi - lo) * 0.05 || 0.1
  return [lo - pad, hi + pad]
}
