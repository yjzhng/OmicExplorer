/** Layout helpers for the name painting: the connectors' paths and the horizontal scroller. */
import { ARROW_LEN } from './NamePainting'

/** A Map conditions connector from a chip's bottom (x1, y1) to a token (x2, y2): one smooth
 *  S-curve, tangent to vertical at both ends, with its arrowhead drawn as the last stretch of it —
 *  the dashed line stops an arrowhead's length short, and the head spans from there to the tip, so
 *  it leans with the curve over its length (a marker would take only the end's vertical tangent). */
export function connectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { line: string; head: string } {
  const k = (y2 - y1) * 0.6
  type P = [number, number]
  const p0: P = [x1, y1]
  const p1: P = [x1, y1 + k]
  const p2: P = [x2, y2 - k]
  const p3: P = [x2, y2]
  const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  // De Casteljau at t: the point on the curve, and the control points of its first part.
  const split = (t: number): { at: P; c1: P; c2: P } => {
    const a = lerp(p0, p1, t)
    const b = lerp(p1, p2, t)
    const c = lerp(p2, p3, t)
    const d = lerp(a, b, t)
    const e = lerp(b, c, t)
    return { at: lerp(d, e, t), c1: a, c2: d }
  }
  // The point an arrowhead's length back from the tip (the distance falls as t → 1).
  let lo = 0
  let hi = 1
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2
    const [px, py] = split(mid).at
    if (Math.hypot(x2 - px, y2 - py) > ARROW_LEN) lo = mid
    else hi = mid
  }
  const { at: base, c1, c2 } = split(lo)
  const f = (n: number): string => String(Math.round(n * 10) / 10)
  const line = `M${f(x1)} ${f(y1)}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(base[0])} ${f(base[1])}`
  // The head: tip at the token, its base across the curve at `base`.
  const len = Math.hypot(x2 - base[0], y2 - base[1]) || 1
  const ux = (x2 - base[0]) / len
  const uy = (y2 - base[1]) / len
  const w = ARROW_LEN * 0.45
  const head =
    `M${f(x2)} ${f(y2)}` +
    `L${f(base[0] - uy * w)} ${f(base[1] + ux * w)}` +
    `L${f(base[0] + uy * w)} ${f(base[1] - ux * w)}Z`
  return { line, head }
}

/** The nearest ancestor that scrolls horizontally (a header's table viewport). */
export function scrollParentX(el: HTMLElement | null | undefined): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX
    if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return p
  }
  return null
}
