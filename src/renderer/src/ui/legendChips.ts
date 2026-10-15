/** Clickable chip legends drawn inside a Plotly figure (as annotations, so copies and downloads
 *  carry them) — the enrichment plot's term-group legend and the STRING network's cluster legend:
 *  measuring text, shortening it to fit, and flowing chips into rows. */

/** Pixel width of `text` at `font` (e.g. 'bold 10px sans-serif'), via a memoised offscreen canvas —
 *  so legend slot widths match the rendered text instead of a char-count estimate. */
let measureCtx: CanvasRenderingContext2D | null = null
export function measureText(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6 // fallback if 2D context is unavailable
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/** Flow legend chips left to right into lines that fit `budget` px, first line on top. Each chip's
 *  slot is `width` px — sized by the caller for its widest (bold) text. (The plot hides Plotly's
 *  control bar, which would otherwise sit over the top line's right end.) */
export function flowChips(
  chips: { c: string; width: number }[],
  budget: number
): { at: { c: string; x: number; line: number }[]; lines: number } {
  const at: { c: string; x: number; line: number }[] = []
  let x = 0
  let line = 0
  for (const { c, width } of chips) {
    if (x > 0 && x + width > budget) {
      x = 0
      line++
    }
    at.push({ c, x, line })
    x += width
  }
  return { at, lines: at.length ? line + 1 : 0 }
}

/** `text` cut to fit `maxPx` at `font`, ending in "…" when cut (binary search on the length). */
export function fitText(text: string, maxPx: number, font: string): string {
  if (measureText(text, font) <= maxPx) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measureText(`${text.slice(0, mid).trimEnd()}…`, font) <= maxPx) lo = mid
    else hi = mid - 1
  }
  return `${text.slice(0, lo).trimEnd()}…`
}
