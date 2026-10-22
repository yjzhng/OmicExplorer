import { type CSSProperties } from 'react'

import {
  CATEGORICAL_SCHEMES,
  DEFAULT_CATEGORICAL,
  ROLE_DEFAULTS,
  paletteEffectColors,
  type CategoricalId
} from './palettes'

/** A concrete color palette for one theme mode. */
export interface Palette {
  mode: 'dark' | 'light'
  bg: string
  panel: string
  panelAlt: string
  /** a surface lighter than `panel` in both themes (e.g. pending/placeholder tiles) */
  panelRaised: string
  border: string
  text: string
  textMuted: string
  /** monochrome accent for active/selected/primary affordances */
  accent: string
  /** text color on top of `accent` fills */
  accentText: string
  /** chart gridlines / axis lines */
  grid: string
  axis: string
  /** status TEXT colours (see ui/StatusNote): blue info/tip, amber warning, red error, green
   *  result — tuned per theme so they stay legible on that theme's panels */
  info: string
  warn: string
  err: string
  ok: string
}

/** Minimal neutral-grey themes (no blue hues). */
export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    mode: 'dark',
    bg: '#181818',
    panel: '#202020',
    panelAlt: '#2a2a2a',
    panelRaised: '#313131',
    border: '#343434',
    text: '#ececec',
    textMuted: '#8c8c8c',
    accent: '#d8d8d8',
    accentText: '#1a1a1a',
    grid: '#2e2e2e',
    axis: '#3a3a3a',
    info: '#6ea1d6',
    warn: '#e2b93b',
    err: '#e5484d',
    ok: '#3fae5a'
  },
  light: {
    mode: 'light',
    bg: '#ffffff',
    panel: '#f7f7f7',
    panelAlt: '#ededed',
    panelRaised: '#ffffff',
    border: '#e0e0e0',
    text: '#1c1c1c',
    textMuted: '#6a6a6a',
    accent: '#2b2b2b',
    accentText: '#ffffff',
    grid: '#ececec',
    axis: '#cfcfcf',
    info: '#2f6fb0',
    warn: '#9a6a00',
    err: '#c8373d',
    ok: '#1f8a3f'
  }
}

/**
 * DOM styling reads these CSS variables (defined on the app root from the active
 * palette), so inline styles adapt to theme automatically without per-component
 * theme reads. Charts (Plotly) need concrete colors — use PALETTES + the theme store.
 */
export const UI = {
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  panelAlt: 'var(--panel-alt)',
  panelRaised: 'var(--panel-raised)',
  border: 'var(--border)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  accent: 'var(--accent)',
  accentText: 'var(--accent-text)',
  info: 'var(--info)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  ok: 'var(--ok)'
}

/** The accent colour choices (Settings → Appearance): the palettes' own monochrome Graphite, the
 *  logo's blue and orange (sampled from build-resources/icon.png), or a custom colour. The blue is
 *  the logo's #7780fc lightened 25% toward white, so the dark text on it reads at 7.3:1 (WCAG AAA)
 *  rather than 5.2:1. */
export type AccentId = 'graphite' | 'blue' | 'orange' | 'custom'
export const ACCENT_LABELS: Record<AccentId, string> = {
  graphite: 'Graphite',
  blue: 'Blue',
  orange: 'Orange',
  custom: 'Custom'
}
const LOGO_BLUE = '#99a0fd'
const LOGO_ORANGE = '#eab400'
/** The Custom accent's colour until one is picked: a mid grey. */
export const DEFAULT_CUSTOM_ACCENT = '#8c8c8c'

/** Text that reads on `hex`: near-black on a light colour, white on a dark one (WCAG relative
 *  luminance, split where the two contrasts are equal). */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const n = parseInt(m[1], 16)
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.179 ? '#1a1a1a' : '#ffffff'
}

/** An accent's colour, and the text colour on it, for one theme. */
export function accentColors(
  id: AccentId,
  mode: 'dark' | 'light',
  custom: string
): [accent: string, text: string] {
  const c =
    id === 'blue' ? LOGO_BLUE : id === 'orange' ? LOGO_ORANGE : id === 'custom' ? custom : null
  return c ? [c, textOn(c)] : [PALETTES[mode].accent, PALETTES[mode].accentText]
}

/** The accent in effect — set by the theme store (useUiTheme), read by cssVars, so every surface
 *  built from a palette picks it up. */
let accentInEffect: { id: AccentId; custom: string } = {
  id: 'graphite',
  custom: DEFAULT_CUSTOM_ACCENT
}
export const setAccentInEffect = (id: AccentId, custom: string): void => {
  accentInEffect = { id, custom }
}

/** CSS custom properties for a palette, with the chosen accent — spread onto the app root's style
 *  (and any portal that renders outside it). */
export function cssVars(
  p: Palette,
  chosen: { id: AccentId; custom: string } = accentInEffect
): CSSProperties {
  const [accent, accentText] = accentColors(chosen.id, p.mode, chosen.custom)
  return {
    '--bg': p.bg,
    '--panel': p.panel,
    '--panel-alt': p.panelAlt,
    '--panel-raised': p.panelRaised,
    '--border': p.border,
    '--text': p.text,
    '--text-muted': p.textMuted,
    '--accent': accent,
    '--accent-text': accentText,
    '--info': p.info,
    '--warn': p.warn,
    '--err': p.err,
    '--ok': p.ok
  } as CSSProperties
}

/** Effect colours when nothing else is set: sampled from the default fold-change palette (down its
 *  low end, none its middle, up its high end — see palettes.ts). Plots resolve theirs from the
 *  global / their own palette (plotEffectColors); this is the last fallback. */
export const EFFECT_COLOR: Record<'up' | 'down' | 'none', string> = paletteEffectColors(
  ROLE_DEFAULTS.fcObject
)

/** Linked-selection highlight — a vivid hue kept OUT of CATEGORICAL so a hovered/pinned
 *  gene reads as "selected" over both the grey background and the top-N series colors. */
export const HIGHLIGHT = '#ff2d95'

/** Categorical series colors (Tableau-10, colorblind-tolerant) for lines/groups. */
/** QC colour — the logo's blue (sampled from build-resources/icon.png), distinct from the
 *  greyscale accent so the violins/boxes/bars read clearly in both themes. */
export const QC_FILL = '#7780fc'

/** A hex (#rgb / #rrggbb) or rgb() colour at an opacity, as rgba — for the Plotly parts that take
 *  no opacity of their own (error bars, fills). Any other colour string passes through unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color)
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export const CATEGORICAL: string[] = [...CATEGORICAL_SCHEMES[DEFAULT_CATEGORICAL]]
/** Point CATEGORICAL at another categorical palette (app settings → categorical), in place: every
 *  module holding the array sees the change. Plot tiles remount when it changes (PanelTile keys
 *  its body on it), so memoised plots redraw in the new colours. */
export function setCategorical(id: CategoricalId): void {
  CATEGORICAL.splice(0, CATEGORICAL.length, ...CATEGORICAL_SCHEMES[id])
}

/** Fonts offered for plot text — the ones journals' figure guidelines ask for. `name` is the one
 *  family an exported SVG names (an editor resolves a single installed font, not a CSS list);
 *  `css` is what plots draw and measure with on screen. */
export const PLOT_FONTS = {
  arial: { label: 'Arial', name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  helvetica: { label: 'Helvetica', name: 'Helvetica', css: 'Helvetica, Arial, sans-serif' },
  times: {
    label: 'Times New Roman',
    name: 'Times New Roman',
    css: '"Times New Roman", Times, serif'
  }
} as const
export type PlotFontId = keyof typeof PLOT_FONTS
export const DEFAULT_PLOT_FONT: PlotFontId = 'arial'
export const isPlotFontId = (v: unknown): v is PlotFontId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLOT_FONTS, v)

let plotFont: PlotFontId = DEFAULT_PLOT_FONT
/** Point plot text at another font (app settings → plot font). Like setCategorical, read deep in
 *  the plot builders; plot tiles remount on a change so memoised plots redraw in it. */
export function setPlotFont(id: PlotFontId): void {
  plotFont = id
}
/** The plot font as a CSS family list (Plotly layouts, canvas text measurement). */
export const plotFontCss = (): string => PLOT_FONTS[plotFont].css
/** The plot font's single family name (exported SVG). */
export const plotFontName = (): string => PLOT_FONTS[plotFont].name

/** Base Plotly layout for the active palette (Plotly needs concrete colors). */
export function plotBase(p: Palette): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    // Muted font so axis titles/labels/legend read as faint chrome behind the data
    // (which carries its own colors). size stays 12.
    font: { color: p.textMuted, family: plotFontCss(), size: 12 },
    // Vertical legend just outside the plot on the right. x > 1 places it outside the
    // axes; Plotly reserves margin for it so it never overlays the data.
    legend: { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top' },
    // Tooltip styled like the app's own (the guide-drag tip): a raised panel surface with a hairline
    // border and the theme's text, in the UI font, rather than Plotly's trace-coloured box. Views
    // keep the trace-name side box off with `<extra></extra>` in their hovertemplates.
    hoverlabel: {
      bgcolor: p.panelRaised,
      bordercolor: p.border,
      font: { color: p.text, family: 'system-ui, sans-serif', size: 11 },
      align: 'left',
      namelength: -1
    }
  }
}

/** A threshold / reference guide line's default width, px (a point plot's `guideWidth`). */
export const GUIDE_WIDTH = 0.5

/** Shared style for threshold / reference guide lines (volcano/MA/scatter). Uses the muted text
 *  colour (not the near-invisible border) so thresholds read clearly against the cloud. */
export function guideLine(
  p: Palette,
  width = GUIDE_WIDTH
): { color: string; width: number; dash: 'dash' } {
  return { color: p.textMuted, width, dash: 'dash' }
}

/**
 * Faint axis chrome, no gridlines by default. Lines/ticks use the border color; tick
 * labels inherit the muted layout font. Plots that need to track named categories
 * (bubble/dumbbell) turn gridlines back on per-axis with `showgrid: true`.
 */
export function axisBase(p: Palette): Record<string, unknown> {
  return {
    showgrid: false,
    gridcolor: p.grid,
    zeroline: true,
    zerolinecolor: p.border,
    linecolor: p.border,
    tickcolor: p.border
  }
}
