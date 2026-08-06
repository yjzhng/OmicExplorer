import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

import { BrowserWindow, ipcMain, shell } from 'electron'

import { buildCsv, buildXlsx } from './xlsx'

/** One plot to write: a base64 PNG (produced in the renderer via Plotly.toImage),
 *  plus the physical page size to use when wrapping it into a PDF. */
export interface ExportItem {
  /** path relative to the export base dir, using '/' separators (may contain one subdir) */
  relPath: string
  format: 'png' | 'pdf'
  /** base64-encoded PNG bytes (no data: prefix) */
  base64: string
  widthIn: number
  heightIn: number
}

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

  ipcMain.handle('plots:reveal', async (_evt, dir: string): Promise<void> => {
    await shell.openPath(dir)
  })
}
