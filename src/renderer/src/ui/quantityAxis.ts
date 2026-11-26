/**
 * Logged abundance shown as plain values (engine scale.ts LogDisplay 'plain'): the plots keep their
 * logged positions — the same shape, the same maths — and only relabel. An axis or colour bar gets
 * a tick per decade labelled with the value itself (0.01, 0.1, 1 — 10⁵, 10⁶); a hover gets the
 * value, not its log. One place for every abundance plot, so none of them knows about fractions.
 */
import type { ValueScale } from '../engine'
import { valueLine } from './condTooltip'

/** The plain value a position on `scale` stands for. */
export const plainOf = (v: number, scale: ValueScale): number =>
  scale === 'log10' ? 10 ** v : scale === 'log2' ? 2 ** v : v

const SUP: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹'
}
const sup = (n: number): string =>
  String(n)
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('')

/** A plain value as read: three significant figures, as a decimal from 0.0001 to 99,999, else
 *  m×10ⁿ (the same span the ticks read as decimals, so a tile and its colour bar agree). */
export function fmtPlain(x: number): string {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const a = Math.abs(x)
  if (a >= 1e-4 && a < 1e5)
    return a >= 1000 ? String(Math.round(x)) : String(Number(x.toPrecision(3)))
  const e = Math.floor(Math.log10(a))
  const m = Number((x / 10 ** e).toPrecision(3))
  return m === 1 ? `10${sup(e)}` : m === -1 ? `−10${sup(e)}` : `${m}×10${sup(e)}`
}

/** A decade's tick label: 0.0001 … 10000 as decimals, beyond as 10ⁿ. */
const decadeLabel = (k: number): string =>
  k >= -4 && k <= 4 ? (10 ** k).toFixed(Math.max(0, -k)) : `10${sup(k)}`

/** Plotly axis (or colour-bar) ticks for positions on a logged `scale` labelled as plain values.
 *  Given the positions' `range` (its ends, on `scale`), the ticks fit it: a decade each over two or
 *  more decades; 1, 2, 5 per decade over less; 1 – 9 under one — so a narrow axis (a gene's bars a
 *  few-fold apart) still has labels. Without one: every decade a plot could reach (Plotly shows
 *  those in view). Nothing for linear — its positions are its values. */
export function plainTicks(
  scale: ValueScale,
  range?: readonly [number, number] | null
): { tickmode: 'array'; tickvals: number[]; ticktext: string[] } | Record<string, never> {
  if (scale === 'linear') return {}
  // a position on `scale` ↔ its log₁₀
  const per = scale === 'log2' ? Math.log2(10) : 1
  const ok = !!range && Number.isFinite(range[0]) && Number.isFinite(range[1])
  const lo10 = ok ? Math.min(range![0], range![1]) / per : -15
  const hi10 = ok ? Math.max(range![0], range![1]) / per : 15
  const span = hi10 - lo10
  const mantissas = !ok || span >= 2 ? [1] : span >= 0.8 ? [1, 2, 5] : [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const tickvals: number[] = []
  const ticktext: string[] = []
  for (let k = Math.floor(lo10) - 1; k <= Math.ceil(hi10) + 1; k++)
    for (const m of mantissas) {
      const at = k + Math.log10(m)
      // in range (or every decade, without one), a little either side for the axis padding
      if (ok && (at < lo10 - 0.05 || at > hi10 + 0.05)) continue
      tickvals.push(at * per)
      ticktext.push(m === 1 ? decadeLabel(k) : fmtPlain(m * 10 ** k))
    }
  return { tickmode: 'array', tickvals, ticktext }
}

/** The range of finite positions among `values` (for plainTicks), or null when there are none. */
export function rangeOf(values: Iterable<number | null | undefined>): [number, number] | null {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values)
    if (v != null && Number.isFinite(v)) {
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  return lo <= hi ? [lo, hi] : null
}

/** A hover's value rows for a point whose abundances are shown plain — what its trace's
 *  `hovertext` carries, read by a template ending in `%{hovertext}` (Plotly can't exponentiate in
 *  a template). */
export const plainRows = (rows: Array<[string, number]>, scale: ValueScale): string =>
  rows.map(([name, v]) => valueLine(name, fmtQuantity(v, scale, true))).join('<br>')

/** A position on `scale` as a hover reads it: the plain value, or the log to `digits`. */
export const fmtQuantity = (v: number, scale: ValueScale, plain: boolean, digits = 3): string =>
  !Number.isFinite(v)
    ? '—'
    : plain && scale !== 'linear'
      ? fmtPlain(plainOf(v, scale))
      : v.toFixed(digits)
