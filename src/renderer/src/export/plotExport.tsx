/**
 * Batch plot export. Every plot in the app renders through PlotlyChart, and
 * `Plotly.toImage(gd)` rasterises just that graph div — so we can export a clean,
 * chrome-free image of any plot by mounting its dashboard body off-screen, waiting for
 * Plotly to draw, and snapshotting it. DPI is honoured via Plotly's `scale` (px = dpi/96).
 * Tables and empty ("connect a tile") plots produce no graph div and are skipped.
 *
 * PNG bytes go to the main process (`window.api.exportPlots`), which writes them — and,
 * for PDF, wraps each into a page sized to the plot's physical dimensions.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Edge } from '@xyflow/react'
import Plotly from 'plotly.js-dist-min'

import { PanelBody } from '../dashboard/PanelBody'
import { useGraph } from '../graph/store'
import type { NodeResult } from '../graph/types'
import { planPlotJobs } from './facets'
import { buildFolderMap, exportPath } from './paths'
import { collectSpecs, type ExportSpec } from './specs'
import { collectTableExports } from './tables'

export { collectSpecs } from './specs'
export { collectTableExports } from './tables'
export { planPlotJobs } from './facets'

/** Logical layout size (at 96 dpi) each plot is rendered/exported at. DPI scales pixels
 *  on top of this; the physical page size for PDF is derived from it. */
const BASE_W = 1000
const BASE_H = 680
const DPI_BASE = 96

interface ExportItem {
  relPath: string
  format: 'png' | 'pdf'
  base64: string
  widthIn: number
  heightIn: number
}

export interface ExportOptions {
  scope: 'all' | 'selection'
  structure: 'subfolder' | 'flat'
  includePlots: boolean
  includeTables: boolean
  plotFormat: 'png' | 'pdf'
  dpi: number
  tableFormat: 'csv' | 'xlsx'
  baseDir: string
}

export interface ExportSummary {
  dir: string
  written: number
  skipped: number
  errors: string[]
  total: number
}

type LiveGd = HTMLElement & { _fullLayout?: unknown; data?: unknown[] }

/** Resolve once Plotly has drawn a graph div inside `container` (null on timeout). */
function waitForPlot(container: HTMLElement, timeoutMs = 6000): Promise<LiveGd | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    const tick = (): void => {
      const gd = container.querySelector('.js-plotly-plot') as LiveGd | null
      if (gd && gd._fullLayout && gd.data && gd.data.length) {
        // Let the initial draw settle one frame before snapshotting.
        requestAnimationFrame(() => resolve(gd))
        return
      }
      if (performance.now() - start > timeoutMs) {
        resolve(null)
        return
      }
      setTimeout(tick, 60)
    }
    tick()
  })
}

/** toImage is a real Plotly API but absent from the dist-min typings. */
const plotlyToImage = (
  Plotly as unknown as {
    toImage: (
      el: unknown,
      opts: { format: string; width: number; height: number; scale: number }
    ) => Promise<string>
  }
).toImage

/**
 * Rasterise an SVG data URL to a PNG data URL at `w`×`h` device pixels, on a white
 * ground. We go via SVG (not Plotly's own PNG path) because the app's CSP allows `data:`
 * but not `blob:` images, and Plotly's PNG rasteriser loads the intermediate image from a
 * blob URL — which CSP blocks. A `data:` SVG drawn onto a canvas stays within CSP and,
 * being vector, scales to any DPI crisply.
 */
function svgUrlToPng(svgUrl: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('no 2d context'))
        return
      }
      // A plot's own (opaque) paper colour paints over this; it only shows through where
      // the plot is transparent, keeping exported figures on white rather than black.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''))
    }
    img.onerror = () => reject(new Error('svg image load failed'))
    img.src = svgUrl
  })
}

export interface PngResult {
  base64: string
  widthIn: number
  heightIn: number
}

/**
 * Rasterise an already-rendered Plotly graph div (a live dashboard tile) to PNG bytes at
 * the export layout size and the given DPI. Used by the per-panel download button, which
 * doesn't need the off-screen re-render path.
 */
export async function rasterizeGd(gd: Element, dpi = 300): Promise<PngResult> {
  const svgUrl = await plotlyToImage(gd, { format: 'svg', width: BASE_W, height: BASE_H, scale: 1 })
  const scale = dpi / DPI_BASE
  const base64 = await svgUrlToPng(svgUrl, Math.round(BASE_W * scale), Math.round(BASE_H * scale))
  return { base64, widthIn: BASE_W / DPI_BASE, heightIn: BASE_H / DPI_BASE }
}

/**
 * Render one plot off-screen and return its PNG bytes (base64, no data: prefix), or null
 * if it produced no plot (a table, or an empty "connect a tile" state).
 */
async function renderSpecToPng(
  spec: ExportSpec,
  edges: Edge[],
  results: Record<string, NodeResult>,
  dpi: number,
  goiOnly = false,
  facetSel?: Record<string, string>
): Promise<string | null> {
  const container = document.createElement('div')
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${BASE_W}px;height:${BASE_H}px;pointer-events:none;`
  document.body.appendChild(container)
  const root = createRoot(container)
  root.render(
    createElement(PanelBody, {
      node: spec.node,
      edges,
      results,
      child: spec.child,
      goiOnly,
      facetSel
    })
  )
  try {
    const gd = await waitForPlot(container)
    if (!gd) return null
    const svgUrl = await plotlyToImage(gd, {
      format: 'svg',
      width: BASE_W,
      height: BASE_H,
      scale: 1
    })
    const scale = dpi / DPI_BASE
    return await svgUrlToPng(svgUrl, Math.round(BASE_W * scale), Math.round(BASE_H * scale))
  } catch {
    return null
  } finally {
    root.unmount()
    container.remove()
  }
}

/**
 * Run a full export: rasterise the chosen plots (reporting progress) and/or serialise the
 * chosen tables, then hand both to the main process to write. Plot rendering is serial so
 * the UI can show progress and a huge dashboard doesn't spawn dozens of concurrent draws.
 */
export async function runExport(
  opts: ExportOptions,
  onProgress: (done: number, total: number) => void
): Promise<ExportSummary> {
  const { nodes, edges, results, canvasSelection } = useGraph.getState()
  const only = opts.scope === 'selection' ? new Set(canvasSelection) : undefined
  const specs = opts.includePlots ? collectSpecs(nodes, edges, results, only) : []
  const tables = opts.includeTables ? collectTableExports(nodes, edges, results, only) : []
  // Fan out: one job per (facet tuple) × (all-genes, and a GOI-subset variant when the plot
  // has focus genes). A faceted plot thus exports every facet, not just the first.
  const jobs = planPlotJobs(specs, edges, results)
  const total = jobs.length + tables.length

  // Each analysis gets a unique folder even when two share a label (e.g. two "clpP | WT").
  const folder = buildFolderMap([
    ...specs.map((s) => ({ rootId: s.rootId, analysis: s.analysis })),
    ...tables.map((t) => ({ rootId: t.key, analysis: t.analysis }))
  ])

  const errors: string[] = []
  let written = 0
  let skipped = 0
  let done = 0
  const dims = { widthIn: BASE_W / DPI_BASE, heightIn: BASE_H / DPI_BASE }

  // Plots: render each job off-screen, then write in one batch. GOI variants are filed under
  // a `GOI` subfolder; each facet tuple gets its own file (suffix names the facet).
  const plotItems: ExportItem[] = []
  for (const job of jobs) {
    const fold = folder.get(job.spec.rootId) ?? 'export'
    const fileBase = `${job.spec.plot}_${job.spec.key}${job.suffix ? `__${job.suffix}` : ''}`
    onProgress(done, total)
    const base64 = await renderSpecToPng(
      job.spec,
      edges,
      results,
      opts.dpi,
      job.goiOnly,
      job.facetSel
    )
    done++
    if (base64) {
      plotItems.push({
        relPath: exportPath(fold, fileBase, opts.structure, opts.plotFormat, job.goiOnly),
        format: opts.plotFormat,
        base64,
        ...dims
      })
    } else {
      skipped++
    }
  }
  if (plotItems.length) {
    // A failing IPC (e.g. a stale preload after HMR, so the handler is absent) must surface
    // as an error, never leave the caller awaiting forever.
    try {
      const res = await window.api.exportPlots({ baseDir: opts.baseDir, items: plotItems })
      written += res.written
      errors.push(...res.errors)
    } catch (e) {
      errors.push(`plots: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Tables: serialise (fast) and write in one batch.
  if (tables.length) {
    onProgress(done, total)
    const tableItems = tables.map((t) => ({
      relPath: exportPath(
        folder.get(t.key) ?? 'export',
        `${t.label}_${t.key}`,
        opts.structure,
        opts.tableFormat,
        false
      ),
      sheetName: `${t.label} ${t.key}`,
      columns: t.columns,
      rows: t.rows
    }))
    try {
      if (typeof window.api.exportTables !== 'function') {
        throw new Error('table export unavailable — restart the app to load the update')
      }
      const res = await window.api.exportTables({
        baseDir: opts.baseDir,
        format: opts.tableFormat,
        items: tableItems
      })
      written += res.written
      errors.push(...res.errors)
    } catch (e) {
      errors.push(`tables: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  onProgress(total, total)
  return { dir: opts.baseDir, written, skipped, errors, total }
}
