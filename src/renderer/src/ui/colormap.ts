/** Viridis value colour map, shared by every surface that paints a standardized value:
 *  the Heatmap tile, the Standardize data table, and the gene-bar plot. Keeping one source
 *  here means the same value maps to the same colour everywhere. */
import { type CSSProperties } from 'react'

import { EFFECT_COLOR } from './theme'

// Viridis colour stops (matplotlib), evenly spaced 0→1 — matches the Heatmap tile's 'Viridis'.
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [110, 206, 88],
  [181, 222, 43],
  [253, 231, 37]
]

export function viridis(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = VIRIDIS[i]
  const b = VIRIDIS[Math.min(i + 1, VIRIDIS.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// ColorBrewer "Reds" sequential stops, light → dark.
const REDS: [number, number, number][] = [
  [255, 245, 240],
  [254, 224, 210],
  [252, 187, 161],
  [252, 146, 114],
  [251, 106, 74],
  [239, 59, 44],
  [203, 24, 29],
  [165, 15, 21],
  [103, 0, 13]
]

/** Sequential Reds ramp (light→dark) at t∈[0,1]. */
export function reds(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (REDS.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = REDS[i]
  const b = REDS[Math.min(i + 1, REDS.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// ColorBrewer "Blues" sequential stops, light → dark.
const BLUES: [number, number, number][] = [
  [247, 251, 255],
  [222, 235, 247],
  [198, 219, 239],
  [158, 202, 225],
  [107, 174, 214],
  [66, 146, 198],
  [33, 113, 181],
  [8, 81, 156],
  [8, 48, 107]
]

/** Sequential Blues ramp (light→dark) at t∈[0,1]. */
export function blues(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (BLUES.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = BLUES[i]
  const b = BLUES[Math.min(i + 1, BLUES.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** `[r,g,b]` → `#rrggbb`. */
export function rgbHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

// ── HSL helpers (used by the cluster plot's complex-legend aesthetics) ─────────────

/** HSL (h∈[0,360), s,l∈[0,1]) → `#rrggbb`. */
export function hslHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    hh < 60
      ? [c, x, 0]
      : hh < 120
        ? [x, c, 0]
        : hh < 180
          ? [0, c, x]
          : hh < 240
            ? [0, x, c]
            : hh < 300
              ? [x, 0, c]
              : [c, 0, x]
  return rgbHex([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}

/** `#rrggbb` → HSL (h∈[0,360), s,l∈[0,1]). */
export function hexHsl(hex: string): [number, number, number] {
  const s0 = hex.replace('#', '')
  const r = parseInt(s0.slice(0, 2), 16) / 255
  const g = parseInt(s0.slice(2, 4), 16) / 255
  const b = parseInt(s0.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

/** A lighter→darker "shade" of a base colour: keeps its hue and saturation, and slides the
 *  lightness from light (t=0) to dark (t=1). Used to encode a quantitative condition (dose/time)
 *  within a qualitative colour group in the cluster plot's complex legend. */
export function shadeHex(baseHex: string, t: number): string {
  const [h, s] = hexHsl(baseHex)
  const tt = Math.max(0, Math.min(1, t))
  // 0.74 (light) → 0.30 (dark); keep saturation up so the hue stays legible at both ends.
  const l = 0.74 - 0.44 * tt
  return hslHex(h, Math.max(s, 0.55), l)
}

const rgb = ([r, g, b]: [number, number, number]): string => `rgb(${r | 0},${g | 0},${b | 0})`

export interface ValueRange {
  min: number
  max: number
  /** log10 position mapping (values look like raw intensity: all positive, ≥2 decades) */
  log: boolean
}

/** min/max over finite values; log10 scaling when the values look like raw intensity. */
export function valueRange(values: Iterable<number | null | undefined>): ValueRange {
  let min = Infinity
  let max = -Infinity
  for (const v of values)
    if (v != null && Number.isFinite(v)) {
      if (v < min) min = v
      if (v > max) max = v
    }
  return { min, max, log: min > 0 && max / min >= 100 }
}

/** Position a value in [0,1] along the (log-aware) range; null for missing/out-of-range. */
function pos({ min, max, log }: ValueRange, v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  const lo = log ? Math.log10(min) : min
  const hi = log ? Math.log10(max) : max
  if (!Number.isFinite(n) || hi <= lo) return null
  const p = log ? (n > 0 ? Math.log10(n) : lo) : n
  return (p - lo) / (hi - lo)
}

/** Viridis fill colour for a value over the range (missing → undefined). */
export function valueColor(range: ValueRange): (v: unknown) => string | undefined {
  return (v) => {
    const t = pos(range, v)
    return t == null ? undefined : rgb(viridis(t))
  }
}

/** Table-cell style: viridis background + luminance-chosen text colour (missing → no style). */
export function heatStyle(range: ValueRange): (v: unknown) => CSSProperties | undefined {
  return (v) => {
    const t = pos(range, v)
    if (t == null) return undefined
    const [r, g, b] = viridis(t)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return { background: `rgb(${r | 0},${g | 0},${b | 0})`, color: lum > 140 ? '#111' : '#fff' }
  }
}

// ── diverging effect palette (signed log2FC) ──────────────────────────────────────
// Shares the bubble plot's fold-change hues — down (blue) → up (red) — so the log₂FC
// heatmap, the comparison matrix table and the bubble plot read as one palette. The
// CENTRE differs by medium, though: a filled heatmap/table needs a light neutral at 0
// (grey fills the whole grid muddy and kills contrast), whereas the bubble keeps grey so
// a near-zero MARKER stays visible on the panel. `DIVERGE_SCALE` is the Plotly colorscale.
const DIVERGE_MID = '#eef0f3' // light neutral centre for filled surfaces (0 → recedes)
const DIVERGE_STOPS = [EFFECT_COLOR.down, DIVERGE_MID, EFFECT_COLOR.up].map(hexRgb)

/** Plotly diverging colorscale (down → light → up) for a signed, 0-centred value (use with
 *  `cmid: 0` / `zmid: 0`). Kept here so heatmap and table draw from one definition. */
export const DIVERGE_SCALE: [number, string][] = [
  [0, EFFECT_COLOR.down],
  [0.5, DIVERGE_MID],
  [1, EFFECT_COLOR.up]
]

function hexRgb(h: string): [number, number, number] {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

/** Interpolate the down→none→up scale at t∈[0,1] (0.5 = none). */
function diverge(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t))
  const [a, b, f] =
    x < 0.5
      ? [DIVERGE_STOPS[0], DIVERGE_STOPS[1], x / 0.5]
      : [DIVERGE_STOPS[1], DIVERGE_STOPS[2], (x - 0.5) / 0.5]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** A signed value → `rgb()` string on the diverging effect scale (down→none→up), symmetric about
 *  0 with ±absMax at the extremes. Same palette as the bubble/heatmap, for e.g. colouring a line. */
export function divergeColor(absMax: number): (v: number) => string {
  const m = absMax > 0 ? absMax : 1
  return (v) => {
    const [r, g, b] = diverge(0.5 + (0.5 * v) / m)
    return `rgb(${r | 0},${g | 0},${b | 0})`
  }
}

/** Table-cell style for a signed value on the diverging effect scale, symmetric about 0.
 *  `absMax` sets both extremes (±absMax → full blue / full red); beyond clamps. Missing → none. */
export function divergeStyle(absMax: number): (v: unknown) => CSSProperties | undefined {
  const m = absMax > 0 ? absMax : 1
  return (v) => {
    if (v == null || v === '') return undefined
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return undefined
    const t = 0.5 + (0.5 * n) / m // 0 → mid (none), +m → 1 (up/red), −m → 0 (down/blue)
    const [r, g, b] = diverge(t)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return { background: `rgb(${r | 0},${g | 0},${b | 0})`, color: lum > 140 ? '#111' : '#fff' }
  }
}
