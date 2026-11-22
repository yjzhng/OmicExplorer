/** The condition tracks' colours, shared by both heatmaps (Clean data's along its samples, the
 *  fold-change one's along its comparison columns). */
import { isNumericCond, type ConditionKey, type NumericConds } from '../../engine'
import { paletteSeries, type PaletteRef } from '../../ui/palettes'
import { CATEGORICAL } from '../../ui/theme'

/** The numeric conditions' track palettes — their levels in order along a palette role: time's
 *  (Greens by default), dose's (Blues) for dose and any declared numeric condition (app settings →
 *  palettes) — with the dataset's numeric conditions (`numeric`). */
export type LevelPalettes = { dose: PaletteRef; time: PaletteRef; numeric: NumericConds }
export const levelPalette = (c: ConditionKey, lp: LevelPalettes): PaletteRef | null =>
  isNumericCond(c, lp.numeric) ? (c === 'time' ? lp.time : lp.dose) : null
/** A categorical track's start along the categorical palette, per track: far enough along that the
 *  next track's first levels don't repeat this one's. */
const TRACK_ROTATE = 5

/** A track's distinct values → colour. Along a level palette (`ramp`, a numeric condition's) by
 *  sorted value, low → high (its pale end skipped — see paletteSeries); else cycling the categorical
 *  palette, each further categorical track (`catIndex`) starting TRACK_ROTATE colours on, so no two
 *  tracks read alike. Empty values are skipped. */
export function trackColours(
  values: Iterable<string>,
  ramp: PaletteRef | null,
  catIndex: number
): Map<string, string> {
  const vals = [...new Set([...values].filter((v) => v !== ''))]
  vals.sort((a, b) => (ramp ? Number(a) - Number(b) : a < b ? -1 : a > b ? 1 : 0))
  const map = new Map<string, string>()
  if (ramp) vals.forEach((v, i) => map.set(v, paletteSeries(ramp, i, vals.length)))
  else {
    const rot = catIndex * TRACK_ROTATE
    vals.forEach((v, i) => map.set(v, CATEGORICAL[(i + rot) % CATEGORICAL.length]))
  }
  return map
}
