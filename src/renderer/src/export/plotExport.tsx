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
import { PALETTES } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { useUiTheme } from '../ui/useUiTheme'
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
  format: 'png' | 'pdf' | 'svg'
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

/** The ground an exported plot sits on: the tile's panel colour in the current theme. Plots draw
 *  on transparent paper over the panel, and their emphasis ring / labels are inked in the theme's
 *  text colour — so a dark-theme export must keep the dark ground or those turn white-on-white. */
const exportGround = (): string => PALETTES[useUiTheme.getState().mode].panel

/**
 * Rasterise an SVG data URL to a PNG data URL at `w`×`h` device pixels, on `ground` (default:
 * the current theme's panel colour, see exportGround). We go via SVG (not Plotly's own PNG path)
 * because the app's CSP allows `data:` but not `blob:` images, and Plotly's PNG rasteriser loads
 * the intermediate image from a blob URL — which CSP blocks. A `data:` SVG drawn onto a canvas
 * stays within CSP and, being vector, scales to any DPI crisply.
 */
function svgUrlToPng(
  svgUrl: string,
  w: number,
  h: number,
  ground: string = exportGround()
): Promise<string> {
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
      // A plot's own (opaque) paper colour paints over this; it only shows through where the
      // plot is transparent — which is everywhere for the app's plots, so this IS the background.
      ctx.fillStyle = ground
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

/** The size a live graph div is drawn at right now (Plotly's full layout, falling back to the
 *  element box). A per-tile copy/download snapshots at THIS size, not a fixed export layout, so
 *  the image is exactly the view on screen: same aspect, axis ranges, zoom, legend state,
 *  highlight/dim opacities, emphasis overlay and collision-placed labels (re-laying out at
 *  another size would move labels and reflow the legend). */
function liveSize(gd: Element): { w: number; h: number } {
  const fl = (gd as { _fullLayout?: { width?: number; height?: number } })._fullLayout
  const w = Math.round(fl?.width ?? (gd as HTMLElement).clientWidth) || BASE_W
  const h = Math.round(fl?.height ?? (gd as HTMLElement).clientHeight) || BASE_H
  return { w, h }
}

/** The SVG markup of a live graph div, as drawn (see liveSize). Plotly's toImage returns it as a
 *  `data:image/svg+xml,<url-encoded>` URL, decoded here. */
export async function gdToSvg(gd: Element): Promise<string> {
  const { w, h } = liveSize(gd)
  const url = await plotlyToImage(gd, { format: 'svg', width: w, height: h, scale: 1 })
  const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1))
  // The paper is transparent; give the file the tile's ground (see exportGround) as a first
  // rect, so it reads in a viewer the way it does on screen.
  return svg.replace(
    /<svg\b[^>]*>/,
    (open) => `${open}<rect width="100%" height="100%" fill="${exportGround()}"/>`
  )
}

/** base64 of a UTF-8 string (btoa alone chokes on non-Latin-1 glyphs such as ₂ or −). */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Build the export item for one live graph div in the chosen format: SVG markup (as base64, the
 *  main process writes bytes verbatim) or a PNG raster at `dpi` (also what a PDF page wraps). The
 *  physical size is the on-screen size at 96 dpi either way. */
export async function gdToExportItem(
  gd: Element,
  relPath: string,
  format: 'png' | 'pdf' | 'svg',
  dpi: number
): Promise<ExportItem> {
  if (format === 'svg') {
    const { w, h } = liveSize(gd)
    return {
      relPath,
      format,
      base64: utf8ToBase64(await gdToSvg(gd)),
      widthIn: w / DPI_BASE,
      heightIn: h / DPI_BASE
    }
  }
  const png = await rasterizeGd(gd, dpi)
  return { relPath, format, ...png }
}

/**
 * Rasterise a live graph div (a dashboard tile) to PNG bytes, as drawn (see liveSize) and at the
 * given DPI: pixels = on-screen px × dpi/96. Used by the per-panel copy/download, which doesn't
 * need the off-screen re-render path.
 */
export async function rasterizeGd(gd: Element, dpi = 300): Promise<PngResult> {
  const { w, h } = liveSize(gd)
  const svgUrl = await plotlyToImage(gd, { format: 'svg', width: w, height: h, scale: 1 })
  const scale = dpi / DPI_BASE
  const base64 = await svgUrlToPng(svgUrl, Math.round(w * scale), Math.round(h * scale))
  return { base64, widthIn: w / DPI_BASE, heightIn: h / DPI_BASE }
}

/**
 * Put one live graph div on the OS clipboard, as drawn: a PNG image at `dpi`, or the SVG markup as
 * text (no OS clipboard has a cross-app SVG image type). Electron's clipboard (via IPC) is the
 * primary path — it has none of the web Clipboard API's focus/permission rules. The web API is
 * the fallback for a dev session whose preload is stale until restart (the IPC method is then
 * absent), or if the IPC throws; when both fail the error carries both reasons.
 */
export async function copyGd(gd: Element, format: 'png' | 'svg', dpi: number): Promise<void> {
  const payload =
    format === 'svg'
      ? ({ format, svg: await gdToSvg(gd) } as const)
      : ({ format, base64: (await rasterizeGd(gd, dpi)).base64 } as const)
  const why = (e: unknown): string => (e instanceof Error ? e.message : String(e))
  let ipcErr = 'copyPlot IPC unavailable — restart the app to load the update'
  if (typeof window.api.copyPlot === 'function') {
    try {
      await window.api.copyPlot(payload)
      return
    } catch (e) {
      ipcErr = why(e)
    }
  }
  try {
    if (payload.format === 'svg') {
      await navigator.clipboard.writeText(payload.svg)
    } else {
      const bin = atob(payload.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })
      ])
    }
  } catch (e) {
    // The message carries both reasons (the lib target predates Error `cause`).
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`${ipcErr}; clipboard API: ${why(e)}`)
  }
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
  selectedOnly = false,
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
      selectedOnly,
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
  const hasSelection = useSelection.getState().pinnedIds.size > 0
  const specs = opts.includePlots ? collectSpecs(nodes, edges, results, only, hasSelection) : []
  const tables = opts.includeTables ? collectTableExports(nodes, edges, results, only) : []
  // Fan out: one job per (facet tuple) × (all-genes, and a selected-only variant when genes
  // are selected). A faceted plot thus exports every facet, not just the first.
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

  // Plots: render each job off-screen, then write in one batch. Selected-only variants are filed
  // under a `selected` subfolder; each facet tuple gets its own file (suffix names the facet).
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
      job.selectedOnly,
      job.facetSel
    )
    done++
    if (base64) {
      plotItems.push({
        relPath: exportPath(fold, fileBase, opts.structure, opts.plotFormat, job.selectedOnly),
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
