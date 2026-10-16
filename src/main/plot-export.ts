import { execFile } from 'node:child_process'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { BrowserWindow, clipboard, ipcMain, nativeImage, shell } from 'electron'

import { buildCsv, buildXlsx } from './xlsx'

/** One plot to write: a base64 PNG (produced in the renderer via Plotly.toImage) — or, for
 *  `svg`, the base64 SVG markup — plus the physical page size to use when wrapping it into a
 *  PDF. */
export interface ExportItem {
  /** path relative to the export base dir, using '/' separators (may contain one subdir) */
  relPath: string
  format: 'png' | 'pdf' | 'svg'
  /** base64-encoded file bytes (PNG, or the SVG markup; no data: prefix) */
  base64: string
  widthIn: number
  heightIn: number
}

/** One plot to put on the clipboard: PNG bytes as an image, or SVG markup as text. */
export type CopyPayload = { format: 'png'; base64: string } | { format: 'svg'; svg: string }

export interface ExportPayload {
  baseDir: string
  items: ExportItem[]
}

export interface ExportResult {
  dir: string
  written: number
  errors: string[]
}

type Cell = string | number | null

/** One table to write as CSV or XLSX. */
export interface TableItem {
  relPath: string
  sheetName: string
  columns: string[]
  rows: Cell[][]
}

export interface TablePayload {
  baseDir: string
  format: 'csv' | 'xlsx'
  items: TableItem[]
}

/** Resolve a renderer relPath ('a/b.png') to an absolute path under baseDir, portably. */
function resolveOut(baseDir: string, relPath: string): string {
  return join(baseDir, ...relPath.split('/'))
}

/**
 * Wrap a PNG into a single-page PDF sized to the plot's physical dimensions. Plotly
 * can't emit PDF in-browser, so we rasterise at the chosen DPI in the renderer and let
 * Chromium's print engine lay that bitmap onto an exactly-sized page here. The image is
 * routed through a temp file rather than a data: URL so multi-megabyte high-DPI plots
 * don't blow the URL length limit.
 */
async function pngToPdf(
  win: BrowserWindow,
  base64: string,
  widthIn: number,
  heightIn: number
): Promise<Buffer> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  const pngPath = join(tmpdir(), `oe-export-${stamp}.png`)
  const htmlPath = join(tmpdir(), `oe-export-${stamp}.html`)
  await writeFile(pngPath, Buffer.from(base64, 'base64'))
  // The html references the png by bare filename (same temp dir → same file origin), so
  // loadFile can read it. @page fixes the physical size; preferCSSPageSize honours it.
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `@page{size:${widthIn}in ${heightIn}in;margin:0}` +
    `html,body{margin:0;padding:0}` +
    `img{display:block;width:${widthIn}in;height:${heightIn}in}` +
    `</style></head><body><img src="oe-export-${stamp}.png"></body></html>`
  await writeFile(htmlPath, html, 'utf8')
  try {
    await win.loadFile(htmlPath)
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' }
    })
  } finally {
    await unlink(pngPath).catch(() => {})
    await unlink(htmlPath).catch(() => {})
  }
}

/**
 * Lay an SVG onto a single page of its own size as a VECTOR PDF: Chromium's print engine draws
 * the inline SVG as paths and real (embedded) text, unlike pngToPdf's bitmap. Sized from the
 * SVG's own width/height (CSS px, 96 per inch).
 */
async function svgToPdf(win: BrowserWindow, svg: string): Promise<Buffer> {
  const open = /<svg\b[^>]*>/.exec(svg)?.[0] ?? ''
  const px = (attr: string): number =>
    parseFloat(new RegExp(`\\s${attr}="([\\d.]+)`).exec(open)?.[1] ?? '') || 0
  const widthIn = px('width') / 96 || 10
  const heightIn = px('height') / 96 || 7
  const htmlPath = join(tmpdir(), `oe-copy-${Date.now()}-${Math.round(Math.random() * 1e9)}.html`)
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `@page{size:${widthIn}in ${heightIn}in;margin:0}` +
    `html,body{margin:0;padding:0;overflow:hidden}svg{display:block}` +
    `</style></head><body>${svg}</body></html>`
  await writeFile(htmlPath, html, 'utf8')
  try {
    await win.loadFile(htmlPath)
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' }
    })
  } finally {
    await unlink(htmlPath).catch(() => {})
  }
}

/** JXA (osascript) that puts one item on the macOS pasteboard in two flavours at once —
 *  Electron's clipboard API writes either one custom buffer or text, never both. argv: the SVG
 *  file, the PDF file. Declared order is preference: an app takes the first flavour it reads. */
const PASTEBOARD_JXA = `ObjC.import('AppKit')
function run(argv) {
  const pb = $.NSPasteboard.generalPasteboard
  pb.declareTypesOwner($(['public.svg-image', 'com.adobe.pdf']), null)
  pb.setDataForType($.NSData.dataWithContentsOfFile(argv[0]), 'public.svg-image')
  pb.setDataForType($.NSData.dataWithContentsOfFile(argv[1]), 'com.adobe.pdf')
}`

/**
 * Copy an SVG plot as a picture on macOS: the SVG image first (Office reads it as an SVG
 * graphic, which "Convert to Shape" makes editable), then a vector PDF (Illustrator, Keynote and
 * older Office paste that as vector artwork). No plain-text markup: offered alongside, PowerPoint
 * pastes the text in preference to either picture.
 */
async function copySvgMac(svg: string): Promise<void> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
  const pdfPath = join(tmpdir(), `oe-copy-${stamp}.pdf`)
  const svgPath = join(tmpdir(), `oe-copy-${stamp}.svg`)
  const win = new BrowserWindow({ show: false })
  try {
    await writeFile(pdfPath, await svgToPdf(win, svg))
    await writeFile(svgPath, svg, 'utf8')
    await promisify(execFile)('osascript', [
      '-l',
      'JavaScript',
      '-e',
      PASTEBOARD_JXA,
      svgPath,
      pdfPath
    ])
  } finally {
    win.destroy()
    await unlink(pdfPath).catch(() => {})
    await unlink(svgPath).catch(() => {})
  }
}

/**
 * Register the plot-export IPC. The renderer rasterises every selected plot to a PNG
 * (Plotly is only available there); this side just writes bytes to disk — optionally
 * wrapping each into a PDF — and can reveal the folder afterwards.
 */
export function registerPlotExport(): void {
  ipcMain.handle('plots:export', async (_evt, payload: ExportPayload): Promise<ExportResult> => {
    const { baseDir, items } = payload
    const errors: string[] = []
    let written = 0
    let pdfWin: BrowserWindow | null = null
    try {
      for (const it of items) {
        try {
          const abs = resolveOut(baseDir, it.relPath)
          await mkdir(dirname(abs), { recursive: true })
          if (it.format === 'pdf') {
            if (!pdfWin) pdfWin = new BrowserWindow({ show: false })
            const pdf = await pngToPdf(pdfWin, it.base64, it.widthIn, it.heightIn)
            await writeFile(abs, pdf)
          } else {
            // PNG bytes, or the SVG markup — both arrive base64 and are written verbatim.
            await writeFile(abs, Buffer.from(it.base64, 'base64'))
          }
          written++
        } catch (e) {
          errors.push(`${it.relPath}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } finally {
      pdfWin?.destroy()
    }
    return { dir: baseDir, written, errors }
  })

  ipcMain.handle('tables:export', async (_evt, payload: TablePayload): Promise<ExportResult> => {
    const { baseDir, format, items } = payload
    const errors: string[] = []
    let written = 0
    for (const it of items) {
      try {
        const abs = resolveOut(baseDir, it.relPath)
        await mkdir(dirname(abs), { recursive: true })
        if (format === 'xlsx') {
          await writeFile(abs, buildXlsx(it.sheetName, it.columns, it.rows))
        } else {
          // BOM so Excel opens UTF-8 CSV with the right encoding.
          await writeFile(abs, '﻿' + buildCsv(it.columns, it.rows), 'utf8')
        }
        written++
      } catch (e) {
        errors.push(`${it.relPath}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    return { dir: baseDir, written, errors }
  })

  /** Per-tile "copy" button: PNG goes on the clipboard as an image (pastes into slides, docs,
   *  chat). SVG goes on as a vector picture on macOS (copySvgMac); elsewhere — or if that fails —
   *  as its markup text. Done here with Electron's clipboard, which has none of the
   *  focus/permission rules of the web API. */
  ipcMain.handle('plots:copy', async (_evt, payload: CopyPayload): Promise<void> => {
    if (payload.format === 'svg') {
      if (process.platform === 'darwin') {
        try {
          await copySvgMac(payload.svg)
          return
        } catch {
          // Fall back to plain markup: still pastes into Illustrator and code editors.
        }
      }
      clipboard.writeText(payload.svg)
    } else clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(payload.base64, 'base64')))
  })

  /** Plain text on the clipboard (e.g. the home page's citation). */
  ipcMain.handle('clip:text', (_evt, text: string): void => clipboard.writeText(text))

  ipcMain.handle('plots:reveal', async (_evt, dir: string): Promise<void> => {
    await shell.openPath(dir)
  })
}
