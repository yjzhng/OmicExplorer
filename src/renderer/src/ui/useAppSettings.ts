import { create } from 'zustand'

import type { NodeKind } from '../graph/types'
import {
  CUSTOM_CATEGORICAL_MAX,
  CUSTOM_SPECTRUM_MAX,
  DEFAULT_CATEGORICAL,
  isCategoricalId,
  setCustomCategorical,
  setCustomSpectrum,
  type CustomSpectrum,
  ROLE_DEFAULTS,
  toPaletteRef,
  type CategoricalId,
  type PaletteRef,
  type PaletteRole
} from './palettes'
import {
  DEFAULT_PLOT_FONT,
  isPlotFontId,
  setCategorical,
  setPlotFont,
  type PlotFontId
} from './theme'

/** Image format a plot tile's Copy button puts on the clipboard (PDF has no clipboard form). */
export type CopyFormat = 'png' | 'svg'
/** File format a plot tile's Download button saves. */
export type PlotFileFormat = 'svg' | 'png' | 'pdf'
/** File format a table tile's Download button saves. */
export type TableFileFormat = 'csv' | 'xlsx'

/** What an exported/copied plot sits on: plain white, or nothing (transparent, for placing on a
 *  coloured slide or a figure panel). */
export type ExportBackground = 'white' | 'transparent'

/** DPI choices offered wherever a plot is rasterised (copy defaults, per-tile download, export). */
export const DPI_CHOICES = [96, 150, 300, 600] as const

const KEY = 'omicexplorer-settings'

/** How the app presents the pipeline and its output.
 *  - `flow`: the React Flow canvas + the drag/resize results dashboard (the default).
 *  - `form`: a sectioned long form for the workflow, and one plot per page for the results —
 *    for people who'd rather read a document than navigate a graph. */
export type UiStyle = 'flow' | 'form'

/** Form-layout column widths, in px. Clamped on read as well as on write: a stored value can come
 *  from a wider window than the one now open. */
export const NAV_WIDTH = { min: 150, max: 420, default: 216 }
export const DETAILS_WIDTH = { min: 280, max: 720, default: 420 }
export const CONFIG_WIDTH = { min: 280, max: 640, default: 380 }
export const PLOT_NAV_WIDTH = { min: 150, max: 420, default: 200 }

export interface AppSettings {
  /** which presentation the Workflow and Results views use */
  uiStyle: UiStyle
  /** width of the form layout's left nav */
  navWidth: number
  /** width of the form workflow's step-details column */
  detailsWidth: number
  /** width of the form results' plot-list column */
  plotNavWidth: number
  /** width of the form workflow's settings column, when a step's details window sits beside it */
  configWidth: number
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
  /** the ground every exported or copied plot is drawn on */
  exportBackground: ExportBackground
  /** the font plot text is set in, on screen and in every export */
  plotFont: PlotFontId
  /** per plot kind, the settings a NEW tile of that kind starts with — the look (markers,
   *  highlight, axes), caps, and whatever else that kind's config panel offers. Merged over the
   *  kind's built-in defaults at creation; existing tiles keep what they have. */
  plotDefaults: Partial<Record<NodeKind, Record<string, unknown>>>
  /** each palette role's default (see palettes.ts PaletteRole): a plot's Automatic palette */
  palettes: Record<PaletteRole, PaletteRef>
  /** the categorical palette groups and conditions are coloured from */
  categorical: CategoricalId
  /** the user's custom spectrum (palette id 'custom'), when defined */
  customSpectrum?: CustomSpectrum
  /** the user's custom categorical palette (id 'custom'), when defined */
  customCategorical?: string[]
}

const DEFAULTS: AppSettings = {
  uiStyle: 'flow',
  navWidth: NAV_WIDTH.default,
  detailsWidth: DETAILS_WIDTH.default,
  plotNavWidth: PLOT_NAV_WIDTH.default,
  configWidth: CONFIG_WIDTH.default,
  copyFormat: 'png',
  copyDpi: 300,
  downloadFormat: 'png',
  downloadDpi: 300,
  tableFormat: 'csv',
  exportBackground: 'white',
  plotFont: DEFAULT_PLOT_FONT,
  plotDefaults: {},
  palettes: ROLE_DEFAULTS,
  categorical: DEFAULT_CATEGORICAL
}

/** A stored width, held inside its bounds; anything unusable falls back to the default. */
export const clampWidth = (
  v: unknown,
  { min, max, default: fb }: { min: number; max: number; default: number }
): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb)

const dpiOr = (v: unknown, fb: number): number =>
  DPI_CHOICES.includes(v as (typeof DPI_CHOICES)[number]) ? (v as number) : fb

const HEX = /^#[0-9a-f]{6}$/i
/** A stored custom spectrum, if it's well-formed (2–5 hex colours, a midpoint per pair). */
function readSpectrum(v: unknown): CustomSpectrum | undefined {
  const d = v as Partial<CustomSpectrum> | undefined
  const colors = Array.isArray(d?.colors) ? d.colors.filter((c) => HEX.test(String(c))) : []
  if (colors.length < 2 || colors.length > CUSTOM_SPECTRUM_MAX) return undefined
  const mids = colors.slice(1).map((_, i) => {
    const m = Number(d?.mids?.[i])
    return Number.isFinite(m) ? Math.min(0.95, Math.max(0.05, m)) : 0.5
  })
  return { colors, mids }
}
const readCategorical = (v: unknown): string[] | undefined => {
  const c = Array.isArray(v) ? v.filter((x) => HEX.test(String(x))) : []
  return c.length ? c.slice(0, CUSTOM_CATEGORICAL_MAX) : undefined
}

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<AppSettings>
    // The custom palettes first, so a role or the categorical setting naming one reads as valid.
    const customSpectrum = readSpectrum(v.customSpectrum)
    const customCategorical = readCategorical(v.customCategorical)
    setCustomSpectrum(customSpectrum)
    setCustomCategorical(customCategorical)
    return {
      uiStyle: v.uiStyle === 'form' ? 'form' : 'flow',
      navWidth: clampWidth(v.navWidth, NAV_WIDTH),
      detailsWidth: clampWidth(v.detailsWidth, DETAILS_WIDTH),
      plotNavWidth: clampWidth(v.plotNavWidth, PLOT_NAV_WIDTH),
      configWidth: clampWidth(v.configWidth, CONFIG_WIDTH),
      copyFormat: v.copyFormat === 'svg' ? 'svg' : 'png',
      copyDpi: dpiOr(v.copyDpi, DEFAULTS.copyDpi),
      downloadFormat:
        v.downloadFormat === 'svg' || v.downloadFormat === 'pdf' ? v.downloadFormat : 'png',
      downloadDpi: dpiOr(v.downloadDpi, DEFAULTS.downloadDpi),
      tableFormat: v.tableFormat === 'xlsx' ? 'xlsx' : 'csv',
      exportBackground: v.exportBackground === 'transparent' ? 'transparent' : 'white',
      plotFont: isPlotFontId(v.plotFont) ? v.plotFont : DEFAULT_PLOT_FONT,
      // Shapes change as the panels grow, so this is taken as-is and merged over the current
      // defaults at creation: a stale or unknown key simply never matches a config field.
      plotDefaults:
        v.plotDefaults && typeof v.plotDefaults === 'object' ? { ...v.plotDefaults } : {},
      palettes: Object.fromEntries(
        (Object.keys(ROLE_DEFAULTS) as PaletteRole[]).map((r) => [
          r,
          toPaletteRef((v.palettes as Partial<Record<PaletteRole, unknown>> | undefined)?.[r]) ??
            ROLE_DEFAULTS[r]
        ])
      ) as Record<PaletteRole, PaletteRef>,
      categorical: isCategoricalId(v.categorical) ? v.categorical : DEFAULT_CATEGORICAL,
      customSpectrum,
      customCategorical
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
  /** Patch one plot kind's defaults (what a new tile of that kind starts with). */
  setPlotDefault: (kind: NodeKind, patch: Record<string, unknown>) => void
  /** Drop a kind's defaults, so new tiles start from the built-in ones again. */
  clearPlotDefault: (kind: NodeKind) => void
}

/** App-wide preferences (the Settings window), persisted to localStorage like the theme. */
const initial = load()
// The live categorical palette (theme.CATEGORICAL) follows the setting from the start.
setCategorical(initial.categorical)
setPlotFont(initial.plotFont)

export const useAppSettings = create<AppSettingsState>((set, get) => ({
  ...initial,
  update: (patch) => {
    const {
      uiStyle,
      navWidth,
      detailsWidth,
      plotNavWidth,
      configWidth,
      copyFormat,
      copyDpi,
      downloadFormat,
      downloadDpi,
      tableFormat,
      exportBackground,
      plotFont,
      plotDefaults,
      palettes,
      categorical,
      customSpectrum,
      customCategorical
    } = get()
    const next: AppSettings = {
      uiStyle,
      navWidth,
      detailsWidth,
      plotNavWidth,
      configWidth,
      copyFormat,
      copyDpi,
      downloadFormat,
      downloadDpi,
      tableFormat,
      exportBackground,
      plotFont,
      plotDefaults,
      palettes,
      categorical,
      customSpectrum,
      customCategorical,
      ...patch
    }
    // A custom palette changed: register it — and, dropped, send whatever used it back to its
    // default (a role → its built-in default; the categorical setting → tab10).
    if ('customSpectrum' in patch) {
      setCustomSpectrum(next.customSpectrum)
      if (!next.customSpectrum)
        next.palettes = Object.fromEntries(
          (Object.keys(next.palettes) as PaletteRole[]).map((r) => [
            r,
            next.palettes[r].id === 'custom' ? ROLE_DEFAULTS[r] : next.palettes[r]
          ])
        ) as Record<PaletteRole, PaletteRef>
    }
    if ('customCategorical' in patch) {
      setCustomCategorical(next.customCategorical)
      if (!next.customCategorical?.length && next.categorical === 'custom')
        next.categorical = DEFAULT_CATEGORICAL
    }
    persist(next)
    if (next.categorical !== categorical || 'customCategorical' in patch)
      setCategorical(next.categorical)
    if (next.plotFont !== plotFont) setPlotFont(next.plotFont)
    set(next)
  },
  setPlotDefault: (kind, patch) => {
    const plotDefaults = {
      ...get().plotDefaults,
      [kind]: { ...get().plotDefaults[kind], ...patch }
    }
    get().update({ plotDefaults })
  },
  clearPlotDefault: (kind) => {
    const plotDefaults = { ...get().plotDefaults }
    delete plotDefaults[kind]
    get().update({ plotDefaults })
  }
}))

/** A palette role's global default — what a plot's Automatic palette for that role is. */
export const useRolePalette = (role: PaletteRole): PaletteRef =>
  useAppSettings((s) => s.palettes[role])
