import { isNumericCond, metaValue, type ConditionKey, type NumericConds } from '../engine'
import { CATEGORICAL } from './theme'

/** A hex colour lightened toward white: `t` = 1 is the colour itself, 0 the palest shade — how a
 *  numeric condition (dose, time) shades its marks, low → light, high → dark. */
export function shade(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const k = (1 - Math.max(0, Math.min(1, t))) * 0.72
  const mix = (c: number): number => Math.round(c + (255 - c) * k)
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`
}

type Meta = { extra?: Record<string, string> }

/** A colouring by condition (its colour conditions and fade) as conditionColorer's arguments: the
 *  colour conditions — every combination of their values its own palette colour — and the fade.
 *  A single numeric colour condition with no fade is a ramp of the base colour (as a fade alone). */
export function colorerArgs(
  coloring: { picks: ConditionKey[]; fade: ConditionKey | null } | null | undefined,
  numeric: NumericConds
): { colorCats: ConditionKey[]; colorNum: ConditionKey | undefined } {
  if (!coloring) return { colorCats: [], colorNum: undefined }
  const { picks, fade } = coloring
  if (!fade && picks.length === 1 && isNumericCond(picks[0], numeric))
    return { colorCats: [], colorNum: picks[0] }
  return { colorCats: picks, colorNum: fade ?? undefined }
}

/**
 * Colour by condition, shared by the bar plots (gene bar, QC): the colour conditions pick the
 * colour — every combination of their values ("HeLa · DMSO") its own colour of the categorical
 * palette, in the palette's order — and a numeric one (dose, time) the shade, light = low → dark =
 * high. A condition the items don't carry is left out; with none left, `on` is false and the caller
 * colours its own way.
 */
export function conditionColorer<T>(
  items: T[],
  metaOf: (item: T) => Meta | undefined,
  colorCats: readonly ConditionKey[],
  colorNum: ConditionKey | undefined,
  opts: {
    /** the colour a dose/time shades when no categorical condition colours (must be hex) */
    base: string
    /** the colour of an item missing the categorical condition */
    missing: string
    /** the categorical palette its levels cycle (default: the global one, theme.CATEGORICAL) */
    palette?: readonly string[]
  }
): {
  on: boolean
  /** an item's colour: its group colour, shaded by its dose/time */
  fill: (item: T) => string
  /** an item's GROUP colour — its fill without the dose/time shade */
  primary: (item: T) => string
  /** an item's colour combination ("HeLa · DMSO"; '' when it carries none) — its legend entry */
  catOf: (item: T) => string
  /** legend swatches: each categorical value's colour, then each numeric value's shade (of the
   *  base when it's the only condition, else of a neutral grey — the shade is what it adds) */
  cats: Array<{ value: string; color: string }>
  nums: Array<{ value: string; color: string }>
} {
  const valueOf = (item: T, c: ConditionKey | undefined): string => {
    const m = metaOf(item)
    const v = m && c ? metaValue(m, c) : null
    return v == null ? '' : String(v)
  }
  const catOf = (item: T): string =>
    colorCats
      .map((c) => valueOf(item, c))
      .filter((v) => v !== '')
      .join(' · ')
  const catLevels = colorCats.length ? [...new Set(items.map(catOf))].filter((v) => v !== '') : []
  const numLevels = colorNum
    ? [...new Set(items.map((i) => valueOf(i, colorNum)))]
        .filter((v) => v !== '')
        .sort((a, b) => Number(a) - Number(b))
    : []
  const cat = catLevels.length > 0
  const num = numLevels.length > 0
  const pal = opts.palette ?? CATEGORICAL
  const catColor = new Map(catLevels.map((v, i) => [v, pal[i % pal.length]]))
  // Low → palest, high → the full colour; a single level is the full colour.
  const shadeT = (v: string): number =>
    numLevels.length > 1 ? numLevels.indexOf(v) / (numLevels.length - 1) : 1
  const primary = (item: T): string =>
    cat ? (catColor.get(catOf(item)) ?? opts.missing) : opts.base
  const fill = (item: T): string => {
    const g = primary(item)
    return num ? shade(g.startsWith('#') ? g : opts.base, shadeT(valueOf(item, colorNum))) : g
  }
  return {
    on: cat || num,
    fill,
    primary,
    catOf,
    cats: catLevels.map((v) => ({ value: v, color: catColor.get(v)! })),
    nums: numLevels.map((v) => ({ value: v, color: shade(cat ? '#808080' : opts.base, shadeT(v)) }))
  }
}
