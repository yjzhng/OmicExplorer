/**
 * The app's colour palettes (continuous colormaps), shared by every plot that colours by a value
 * or a direction. One palette drives a fold change's whole encoding: its continuous scale (the
 * fold-change heatmap, the bubble plot, a curve's effect…), the up / down / none colours sampled
 * from it (down = its low end, none = its middle, up = its high end), and enrichment's two ramps
 * (its two halves). The global default lives in app settings (fcPalette); a plot may pick its own.
 *
 * Sources — none written from memory: d3-scale-chromatic (ColorBrewer, viridis / cividis /
 * inferno), and matplotlib 3.9.2's coolwarm (_cm.py `_coolwarm_data`, Moreland's CoolWarmFloat33),
 * its 33 points interpolated linearly in RGB as matplotlib does. 'classic' is the app's own
 * earlier effect colours.
 */
import {
  schemeCategory10,
  schemeSet2,
  interpolateBlues,
  interpolateBrBG,
  interpolateCividis,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateOranges,
  interpolatePiYG,
  interpolatePRGn,
  interpolatePuOr,
  interpolatePurples,
  interpolateRdBu,
  interpolateRdYlBu,
  interpolateRdYlGn,
  interpolateReds,
  interpolateSpectral,
  interpolateViridis,
  interpolateYlGnBu,
  interpolateYlOrBr
} from 'd3-scale-chromatic'

export type PaletteId =
  | 'viridis'
  | 'cividis'
  | 'inferno'
  | 'Greys'
  | 'Purples'
  | 'Blues'
  | 'Greens'
  | 'Oranges'
  | 'Reds'
  | 'YlOrBr'
  | 'YlGnBu'
  | 'RdBu'
  | 'PiYG'
  | 'PRGn'
  | 'BrBG'
  | 'PuOr'
  | 'coolwarm'
  | 'classic'
  | 'Spectral'
  | 'RdYlBu'
  | 'RdYlGn'
  | 'custom'

/** A palette as picked: which one, and whether it runs the other way. */
export interface PaletteRef {
  id: PaletteId
  reverse?: boolean
}

export type PaletteKind = 'uniform' | 'sequential' | 'diverging' | 'spectrum' | 'custom'

/** The palettes by kind, in the selector's order. */
export const PALETTE_GROUPS: { kind: PaletteKind; label: string; ids: PaletteId[] }[] = [
  { kind: 'uniform', label: 'Uniform', ids: ['viridis', 'cividis', 'inferno'] },
  {
    kind: 'sequential',
    label: 'Sequential',
    ids: ['Greys', 'Purples', 'Blues', 'Greens', 'Oranges', 'Reds', 'YlOrBr', 'YlGnBu']
  },
  { kind: 'diverging', label: 'Diverging', ids: ['RdBu', 'PiYG', 'PRGn', 'BrBG', 'PuOr'] },
  {
    kind: 'spectrum',
    label: 'Spectrum',
    ids: ['coolwarm', 'classic', 'Spectral', 'RdYlBu', 'RdYlGn']
  },
  // the user's own (Settings → Customisation → Custom palettes); offered only once it's defined
  { kind: 'custom', label: 'Custom', ids: ['custom'] }
]
export const PALETTE_IDS: PaletteId[] = PALETTE_GROUPS.flatMap((g) => g.ids)
export const paletteKind = (id: PaletteId): PaletteKind =>
  PALETTE_GROUPS.find((g) => g.ids.includes(id))!.kind

/**
 * What a palette is FOR — each plot's Automatic palette is its role's global default (app settings
 * → palettes), so what a plot draws and what its settings name always agree:
 *  - data: data values (Clean data's abundance — its heatmap, table, gene bars) → viridis
 *  - fc: a fold change filling a grid or surface (the log₂FC heatmap, signed table cells, the
 *    Response surface / heatmap) → RdBu reversed (down blue, white 0, up red)
 *  - fcObject: a fold change on objects — dots, bubbles, nodes, lines (volcano, MA, scatter,
 *    potency, DR, bubble, enrichment, network, Response points) and the up / down / none colours
 *    sampled from it; its middle must stay visible on the panel → classic (grey 0)
 *  - corr: correlations → Greens
 *  - dose / time: a numeric condition's levels in order (the heatmap's condition tracks, the
 *    Response plot's lines per dose / per time) → Blues / Greens
 */
export type PaletteRole = 'data' | 'fc' | 'fcObject' | 'corr' | 'dose' | 'time'
export const ROLE_DEFAULTS: Record<PaletteRole, PaletteRef> = {
  data: { id: 'viridis' },
  fc: { id: 'RdBu', reverse: true },
  fcObject: { id: 'classic' },
  corr: { id: 'Greens' },
  dose: { id: 'Blues' },
  time: { id: 'Greens' }
}
export const PALETTE_ROLES: { role: PaletteRole; label: string; hint: string }[] = [
  {
    role: 'data',
    label: 'Data values',
    hint: 'Abundance: the Clean data heatmap and table, gene bar values.'
  },
  {
    role: 'fc',
    label: 'Fold change',
    hint: 'A fold change filling a grid or surface: the log₂FC heatmap, signed table cells, the Response surface and heatmap.'
  },
  {
    role: 'fcObject',
    label: 'Fold change (objects)',
    hint: 'A fold change on dots, bubbles, nodes and lines — volcano, MA, scatter, potency, DR, bubble, enrichment (its two halves), network, Response points — and the up / down / none colours (its low end, middle, high end). Its middle should stay visible on the panel.'
  },
  { role: 'corr', label: 'Correlations', hint: 'The sample-correlation matrix.' },
  {
    role: 'dose',
    label: 'Dose levels',
    hint: 'Dose levels in order: the heatmap’s dose track, the Dose & Time response plot’s lines per dose.'
  },
  {
    role: 'time',
    label: 'Time levels',
    hint: 'Time points in order: the heatmap’s time track, the Dose & Time response plot’s lines per time.'
  }
]
/** The palette a series of lines runs along (the Response plot's per-slice lines) when nothing
 *  else is set. */
export const DEFAULT_SERIES_PALETTE: PaletteRef = { id: 'viridis' }
/** The bubble plot's palette for −log₁₀ P/Q when the plot sets none (its Automatic). */
export const BUBBLE_SIG_PALETTE: PaletteRef = { id: 'Purples' }

/** Categorical palettes (discrete colours, cycled) for groups and conditions — from
 *  d3-scale-chromatic: 'tab10' is matplotlib's (= d3's category10), 'Set2' ColorBrewer's. */
export type CategoricalId = 'tab10' | 'Set2' | 'custom'
export const CATEGORICAL_SCHEMES: Record<CategoricalId, readonly string[]> = {
  tab10: schemeCategory10,
  Set2: schemeSet2,
  // the user's own (Settings → Customisation → Custom palettes), filled in by setCustomCategorical
  custom: []
}
export const DEFAULT_CATEGORICAL: CategoricalId = 'tab10'
/** The categorical palettes on offer: the built-in ones, and the custom one once defined. */
export const categoricalIds = (): CategoricalId[] =>
  CATEGORICAL_SCHEMES.custom.length ? ['tab10', 'Set2', 'custom'] : ['tab10', 'Set2']
export const isCategoricalId = (v: unknown): v is CategoricalId =>
  typeof v === 'string' && (categoricalIds() as string[]).includes(v)
/** The most colours a custom categorical palette holds. */
export const CUSTOM_CATEGORICAL_MAX = 20
/** Define (or, with none, drop) the custom categorical palette. */
export function setCustomCategorical(colors: readonly string[] | undefined): void {
  CATEGORICAL_SCHEMES.custom = colors?.length ? [...colors] : []
}

/**
 * The user's custom spectrum: 2–5 colours, evenly spaced from its low end to its high end, and
 * per neighbouring pair the point (0–1 along that stretch) where the blend is half-way — 0.5 a
 * plain blend, lower bringing the next colour in sooner, higher holding the first longer.
 */
export interface CustomSpectrum {
  colors: string[]
  mids: number[]
}
export const CUSTOM_SPECTRUM_MAX = 5
let customSpectrum: CustomSpectrum | null = null
/** Define (or, with none, drop) the custom spectrum. */
export function setCustomSpectrum(def: CustomSpectrum | undefined | null): void {
  customSpectrum = def && def.colors.length >= 2 ? def : null
}
export const hasCustomSpectrum = (): boolean => customSpectrum != null
/** A custom spectrum's colour at t ∈ [0, 1]: within its stretch, each pair blends by u^γ with γ
 *  set so the blend is half-way at that pair's midpoint. */
export function customSpectrumAt(def: CustomSpectrum, t: number): string {
  const n = def.colors.length
  const x = Math.max(0, Math.min(1, t)) * (n - 1)
  const k = Math.min(Math.floor(x), n - 2)
  const u = x - k
  const m = Math.max(0.02, Math.min(0.98, def.mids[k] ?? 0.5))
  const f = u <= 0 ? 0 : u >= 1 ? 1 : u ** (Math.log(0.5) / Math.log(m))
  const [a, b] = [hexRgb(def.colors[k]), hexRgb(def.colors[k + 1])]
  return toHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
}
/** A stored categorical palette id, else undefined (unset, or one no longer offered). */
export const toCategoricalId = (v: unknown): CategoricalId | undefined =>
  isCategoricalId(v) ? v : undefined

// matplotlib's coolwarm: its 33 points (0 → 1), from _coolwarm_data, as 8-bit hex.
const COOLWARM = [
  '#3b4cc0', '#445acc', '#4d68d7', '#5775e1', '#6282ea', '#6c8ef1', '#779af7', '#82a5fb',
  '#8db0fe', '#98b9ff', '#a3c2ff', '#aec9fd', '#b8d0f9', '#c2d5f4', '#ccd9ee', '#d5dbe6',
  '#dddddd', '#e5d8d1', '#ecd3c5', '#f1ccb9', '#f5c4ad', '#f7bba0', '#f7b194', '#f7a687',
  '#f49a7b', '#f18d6f', '#ec7f63', '#e57058', '#de604d', '#d55042', '#cb3e38', '#c0282f',
  '#b40426'
] // prettier-ignore

// The app's earlier fixed effect colours as a palette: down #4e79a7 (Tableau 10 blue), none
// #8a8f98 (the app's grey), up #e15759 (Tableau 10 red). A plain linear blend would leave a wide
// greyish band around the middle (the ends only reach full colour at the very edges), so each half
// leaves the grey by its distance from the centre to the power CLASSIC_EASE (< 1: the colours come
// in sooner; 0.5 left the grey too narrow, 1 — linear — too wide). Its samples at 0, ½ and 1 are still exactly those three.
const CLASSIC = ['#4e79a7', '#8a8f98', '#e15759']
const CLASSIC_EASE = 0.7

const hexRgb = (h: string): [number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16)
]
const toHex = ([r, g, b]: [number, number, number]): string =>
  '#' +
  [r, g, b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')

/** Linear interpolation through evenly spaced stops (matplotlib's for a listed segment map). */
function linearStops(stops: string[]): (t: number) => string {
  const rgb = stops.map(hexRgb)
  return (t) => {
    const x = Math.max(0, Math.min(1, t)) * (rgb.length - 1)
    const i = Math.min(Math.floor(x), rgb.length - 2)
    const f = x - i
    const [a, b] = [rgb[i], rgb[i + 1]]
    return toHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])
  }
}

/** d3's interpolators answer `rgb(r, g, b)` or hex; the app's colour fields take hex. */
function asHex(c: string): string {
  if (c.startsWith('#')) return c.length === 7 ? c : toHex(hexRgb(c))
  const m = c.match(/rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  return m ? toHex([+m[1], +m[2], +m[3]]) : c
}

const INTERPOLATORS: Record<PaletteId, (t: number) => string> = {
  viridis: interpolateViridis,
  cividis: interpolateCividis,
  inferno: interpolateInferno,
  Greys: interpolateGreys,
  Purples: interpolatePurples,
  Blues: interpolateBlues,
  Greens: interpolateGreens,
  Oranges: interpolateOranges,
  Reds: interpolateReds,
  YlOrBr: interpolateYlOrBr,
  YlGnBu: interpolateYlGnBu,
  RdBu: interpolateRdBu,
  PiYG: interpolatePiYG,
  PRGn: interpolatePRGn,
  BrBG: interpolateBrBG,
  PuOr: interpolatePuOr,
  coolwarm: linearStops(COOLWARM),
  classic: (t) => {
    const [down, none, up] = CLASSIC.map(hexRgb)
    const d = 2 * Math.max(0, Math.min(1, t)) - 1 // −1 (down) … 0 (none) … 1 (up)
    const end = d < 0 ? down : up
    const f = Math.abs(d) ** CLASSIC_EASE
    return toHex([0, 1, 2].map((k) => none[k] + (end[k] - none[k]) * f) as [number, number, number])
  },
  Spectral: interpolateSpectral,
  RdYlBu: interpolateRdYlBu,
  RdYlGn: interpolateRdYlGn,
  // undefined, a plot asking for it falls back to grey — toPaletteRef never hands it out then
  custom: (t) => (customSpectrum ? customSpectrumAt(customSpectrum, t) : interpolateGreys(t))
}

/** A known palette id, or undefined (a stored value from an older version, or garbage). */
export const isPaletteId = (v: unknown): v is PaletteId =>
  typeof v === 'string' && v in INTERPOLATORS && (v !== 'custom' || customSpectrum != null)

/** The palette's colour at t ∈ [0, 1] (reversed: at 1 − t), as hex. */
export function paletteAt(ref: PaletteRef, t: number): string {
  const x = Math.max(0, Math.min(1, t))
  return asHex(INTERPOLATORS[ref.id](ref.reverse ? 1 - x : x))
}

/** The palette as a Plotly colorscale: `n` evenly spaced stops, low → high. */
export function paletteScale(ref: PaletteRef, n = 21): [number, string][] {
  return Array.from({ length: n }, (_, k) => [k / (n - 1), paletteAt(ref, k / (n - 1))])
}

/** The palette from position `from` to `to` as a colorscale (0 → 1 along that stretch) — e.g. one
 *  half of a diverging palette, from its centre out. */
export function paletteRange(
  ref: PaletteRef,
  from: number,
  to: number,
  n = 11
): [number, string][] {
  return Array.from({ length: n }, (_, k) => {
    const f = k / (n - 1)
    return [f, paletteAt(ref, from + (to - from) * f)]
  })
}

/** The up / down / none colours sampled from a fold-change palette: down its low end, none its
 *  middle, up its high end. */
export function paletteEffectColors(ref: PaletteRef): { up: string; down: string; none: string } {
  return { down: paletteAt(ref, 0), none: paletteAt(ref, 0.5), up: paletteAt(ref, 1) }
}

/** Enrichment's two ramps (by significance: faint → strong): the palette's two halves, each from
 *  its centre out to its end — down's to the low end, up's to the high end. */
export function paletteHalves(ref: PaletteRef): {
  down: [number, string][]
  up: [number, string][]
} {
  return { down: paletteRange(ref, 0.5, 0), up: paletteRange(ref, 0.5, 1) }
}

/** Enrichment's two ramps (by significance: faint → strong), each a fade from a pale tint of its
 *  side's colour to the colour itself — the up / down colours its stems, bars and axis notes draw
 *  in — so even a faint dot reads as its side (a palette half from the centre would start every
 *  side at the same neutral). */
export function effectHalves(colors: { up: string; down: string }): {
  down: [number, string][]
  up: [number, string][]
} {
  const side = (color: string): [number, string][] => {
    const hex = asHex(color).toLowerCase()
    // a colour that isn't #rrggbb (a CSS name): no fade, the colour throughout
    if (!/^#[0-9a-f]{6}$/.test(hex))
      return [
        [0, color],
        [1, color]
      ]
    const rgb = hexRgb(hex)
    // toward white as it fades: 0 the palest (72% white, as a numeric condition's shade), 1 the colour
    return Array.from({ length: 11 }, (_, k): [number, string] => {
      const w = (1 - k / 10) * 0.72
      return [k / 10, toHex(rgb.map((c) => c + (255 - c) * w) as [number, number, number])]
    })
  }
  return { down: side(colors.down), up: side(colors.up) }
}

// The part of a palette a series of lines is drawn from: a sequential palette skips its pale low
// end and a uniform one its brightest end, so every line stays visible on a light panel; a
// diverging or spectrum palette uses its whole range.
const SERIES_SPAN: Record<PaletteKind, [number, number]> = {
  uniform: [0, 0.85],
  sequential: [0.3, 1],
  diverging: [0, 1],
  spectrum: [0, 1],
  custom: [0, 1]
}

/** Series i of n, in order along a palette (low → high; one series: mid-span). */
export function paletteSeries(ref: PaletteRef, i: number, n: number): string {
  const [lo, hi] = SERIES_SPAN[paletteKind(ref.id)]
  return paletteAt(ref, n > 1 ? lo + ((hi - lo) * i) / (n - 1) : (lo + hi) / 2)
}

// Palette names stored by earlier versions → the palette now standing for them (the Response
// plot's Plotly-named scales and line palettes). Names with no counterpart fall back.
const LEGACY: Record<string, PaletteId> = {
  Viridis: 'viridis',
  Cividis: 'cividis',
  YlGnBu: 'YlGnBu',
  RdBu: 'RdBu'
}
/** A stored palette value (current or legacy) as a PaletteRef, else undefined. */
export function toPaletteRef(v: unknown, reverse?: boolean): PaletteRef | undefined {
  if (v && typeof v === 'object' && isPaletteId((v as PaletteRef).id)) return v as PaletteRef
  if (isPaletteId(v)) return { id: v, reverse }
  if (typeof v === 'string' && LEGACY[v]) return { id: LEGACY[v], reverse }
  return undefined
}
