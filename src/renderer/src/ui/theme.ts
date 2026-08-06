import { type CSSProperties } from 'react'

/** A concrete color palette for one theme mode. */
export interface Palette {
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
}

/** Minimal neutral-grey themes (no blue hues). */
export const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
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
    axis: '#3a3a3a'
  },
  light: {
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
    axis: '#cfcfcf'
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
  accentText: 'var(--accent-text)'
}

/** CSS custom properties for a palette — spread onto the app root's style. */
export function cssVars(p: Palette): CSSProperties {
  return {
    '--bg': p.bg,
    '--panel': p.panel,
    '--panel-alt': p.panelAlt,
    '--panel-raised': p.panelRaised,
    '--border': p.border,
    '--text': p.text,
    '--text-muted': p.textMuted,
    '--accent': p.accent,
    '--accent-text': p.accentText
  } as CSSProperties
}

/** Effect colors — colorblind-safe red/blue with a neutral grey (theme-independent). */
export const EFFECT_COLOR: Record<'up' | 'down' | 'none', string> = {
  up: '#e15759',
  down: '#4e79a7',
  none: '#8a8f98'
}

/** Linked-selection highlight — a vivid hue kept OUT of CATEGORICAL so a hovered/pinned
 *  gene reads as "selected" over both the grey background and the top-N series colors. */
export const HIGHLIGHT = '#ff2d95'

/** Categorical series colors (Tableau-10, colorblind-tolerant) for lines/groups. */
export const CATEGORICAL: string[] = [
  '#4e79a7',
  '#f28e2b',
  '#59a14f',
  '#e15759',
  '#b07aa1',
  '#76b7b2',
  '#edc948',
  '#ff9da7',
  '#9c755f',
  '#bab0ac'
]

/** Base Plotly layout for the active palette (Plotly needs concrete colors). */
export function plotBase(p: Palette): Record<string, unknown> {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    // Muted font so axis titles/labels/legend read as faint chrome behind the data
    // (which carries its own colors). size stays 12.
    font: { color: p.textMuted, family: 'system-ui, sans-serif', size: 12 },
    // Vertical legend just outside the plot on the right. x > 1 places it outside the
    // axes; Plotly reserves margin for it so it never overlays the data.
    legend: { orientation: 'v', x: 1.02, xanchor: 'left', y: 1, yanchor: 'top' }
  }
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
