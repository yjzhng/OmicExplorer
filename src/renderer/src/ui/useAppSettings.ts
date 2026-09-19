import { create } from 'zustand'

/** Image format a plot tile's Copy button puts on the clipboard (PDF has no clipboard form). */
export type CopyFormat = 'png' | 'svg'
/** File format a plot tile's Download button saves. */
export type PlotFileFormat = 'svg' | 'png' | 'pdf'
/** File format a table tile's Download button saves. */
export type TableFileFormat = 'csv' | 'xlsx'

/** DPI choices offered wherever a plot is rasterised (copy defaults, per-tile download, export). */
export const DPI_CHOICES = [96, 150, 300, 600] as const

const KEY = 'omicexplorer-settings'

export interface AppSettings {
  /** what a plot tile's Copy button copies */
  copyFormat: CopyFormat
  /** raster DPI for Copy */
  copyDpi: number
  /** what a plot tile's Download button saves (it goes straight to the OS save window) */
  downloadFormat: PlotFileFormat
  /** raster DPI for a PNG/PDF download */
  downloadDpi: number
  /** what a table tile's Download button saves */
  tableFormat: TableFileFormat
}

const DEFAULTS: AppSettings = {
  copyFormat: 'png',
  copyDpi: 300,
  downloadFormat: 'png',
  downloadDpi: 300,
  tableFormat: 'csv'
}

const dpiOr = (v: unknown, fb: number): number =>
  DPI_CHOICES.includes(v as (typeof DPI_CHOICES)[number]) ? (v as number) : fb

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<AppSettings>
    return {
      copyFormat: v.copyFormat === 'svg' ? 'svg' : 'png',
      copyDpi: dpiOr(v.copyDpi, DEFAULTS.copyDpi),
      downloadFormat:
        v.downloadFormat === 'svg' || v.downloadFormat === 'pdf' ? v.downloadFormat : 'png',
      downloadDpi: dpiOr(v.downloadDpi, DEFAULTS.downloadDpi),
      tableFormat: v.tableFormat === 'xlsx' ? 'xlsx' : 'csv'
    }
  } catch {
    return DEFAULTS
  }
}

function persist(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

interface AppSettingsState extends AppSettings {
  update: (patch: Partial<AppSettings>) => void
}

/** App-wide preferences (the Settings window), persisted to localStorage like the theme. */
export const useAppSettings = create<AppSettingsState>((set, get) => ({
  ...load(),
  update: (patch) => {
    const { copyFormat, copyDpi, downloadFormat, downloadDpi, tableFormat } = get()
    const next: AppSettings = {
      copyFormat,
      copyDpi,
      downloadFormat,
      downloadDpi,
      tableFormat,
      ...patch
    }
    persist(next)
    set(next)
  }
}))
