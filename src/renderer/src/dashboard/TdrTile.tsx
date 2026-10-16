/** Time & Dose-response panel body: one gene's measured log₂FC over dose × time, drawn by the
 *  Response plot's views (ResponseSurfaceView) — 2-D lines per time or a heatmap, 3-D lines or a
 *  surface. */
import { useMemo } from 'react'

import {
  comparisonOf,
  replicateLog2FCs,
  stdByGene,
  type CompareResultRow,
  type StandardRow
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
  gene,
  std,
  global,
  ...view
}: {
  /** the facet's rows (dose and time left free) */
  rows: CompareResultRow[]
  gene: string
  /** the Clean data rows the Compare ran on — each level's replicates are drawn from them */
  std?: StandardRow[]
  /** scale: global — the value axis spans every gene in the facet, so paging keeps one scale */
  global?: boolean
  dim: '2d' | '3d'
  show: ResponseShow
  look: ResponseLook
  /** 3-D lines: a dose curve at each time, or a time curve at each dose */
  slice?: 'time' | 'dose'
  /** 3-D: the camera's projection */
  projection?: 'perspective' | 'orthographic'
  rolePalettes: { value: PaletteRef; points: PaletteRef }
  doseLabel?: string
  timeLabel?: string
}) {
  // Each dose × time level of the gene: its log₂FC, the fold change's SE and its replicates.
  const measured = useMemo(() => {
    const geneStd = (std && stdByGene(std).get(gene)) ?? []
    const mine = rows.filter((r) => r.uniqID === gene)
    const cells: MeasuredCell[] = []
    for (const r of mine) {
      if (r.dose == null || r.time == null || r.log2FC == null || !Number.isFinite(r.log2FC))
        continue
      cells.push({
        dose: r.dose,
        time: r.time,
        y: r.log2FC,
        ...(r.fcSE != null ? { se: r.fcSE } : null),
        reps: replicateLog2FCs(r, geneStd)
      })
    }
    return { cells, comparison: comparisonOf(mine) }
  }, [rows, gene, std])
  const range = useMemo(() => (global ? tdrValueRange(rows, std) : undefined), [global, rows, std])
  return <ResponseSurfaceView measured={measured} valueRange={range} {...view} />
}

/** The value range every gene in the facet spans over dose × time — fold changes, their error
 *  bars and their replicates — padded a little, so a global scale clips none of them. */
function tdrValueRange(
  rows: CompareResultRow[],
  std: StandardRow[] | undefined
): [number, number] | undefined {
  const byGene = std ? stdByGene(std) : undefined
  let lo = Infinity
  let hi = -Infinity
  const take = (v: number): void => {
    if (!Number.isFinite(v)) return
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (const r of rows) {
    if (r.dose == null || r.time == null || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
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
