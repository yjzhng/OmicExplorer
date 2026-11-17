/** A plot's shapes cut to the axes' drawn ranges, for an export. On screen Plotly clips a shape to
 *  the plot area, but the SVG it writes keeps the whole geometry under a clip-path — and a guide
 *  drawn far past the range (the volcano's run 20× its width, so a zoom out still reaches the
 *  edges) then sets the drawing's bounds: an editor pasting it (Illustrator) centres those bounds,
 *  and the visible plot lands far off its artboard. Cut to the ranges, the geometry is what shows.
 *
 *  Handled: line, rect and straight-segment path shapes (M / L only) along linear or log data
 *  axes; a paper- or domain-referenced side, a pixel-sized shape and any other path are left as
 *  they are. A shape wholly outside the ranges is dropped. Pure — no Plotly, no DOM. */

type Shape = Record<string, unknown>
/** An axis's drawn range, linear in its own space (a log axis's is log₁₀), and how to get there. */
interface AxisSpan {
  lo: number
  hi: number
  log: boolean
}
type Box = { x?: AxisSpan; y?: AxisSpan }

/** The drawn span of the data axis `ref` (`x`, `x2`, `y3`, …) in `fullLayout`, or undefined for a
 *  paper / domain reference, an unknown axis, or one that isn't linear or log. */
function spanOf(ref: unknown, letter: 'x' | 'y', fullLayout: Shape): AxisSpan | undefined {
  const r = typeof ref === 'string' && ref ? ref : letter
  if (!/^[xy]\d*$/.test(r)) return undefined
  const ax = fullLayout[`${letter}axis${r.slice(1)}`] as
    { range?: unknown[]; type?: string } | undefined
  const range = ax?.range
  if (!Array.isArray(range) || range.length !== 2) return undefined
  const [a, b] = range.map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
  const type = ax?.type ?? 'linear'
  if (type !== 'linear' && type !== 'log') return undefined
  return { lo: Math.min(a, b), hi: Math.max(a, b), log: type === 'log' }
}

const toSpace = (v: number, s: AxisSpan | undefined): number =>
  s?.log ? (v > 0 ? Math.log10(v) : -Infinity) : v
const fromSpace = (v: number, s: AxisSpan | undefined): number => (s?.log ? 10 ** v : v)

/** Segment p0 → p1 cut to the box (Liang–Barsky) in the axes' own space; null when it's outside.
 *  An unclipped side (no span) passes as it is. */
function clipSegment(
  p0: [number, number],
  p1: [number, number],
  box: Box
): [[number, number], [number, number]] | null {
  let t0 = 0
  let t1 = 1
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const edge = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  if (box.x && !(edge(-dx, p0[0] - box.x.lo) && edge(dx, box.x.hi - p0[0]))) return null
  if (box.y && !(edge(-dy, p0[1] - box.y.lo) && edge(dy, box.y.hi - p0[1]))) return null
  // an end cut at an edge lands on it exactly (not a rounding hair inside)
  const snap = (v: number, s: AxisSpan | undefined): number => {
    if (!s) return v
    const tol = (s.hi - s.lo) * 1e-9
    return Math.abs(v - s.lo) < tol ? s.lo : Math.abs(v - s.hi) < tol ? s.hi : v
  }
  const at = (t: number): [number, number] => [
    snap(p0[0] + t * dx, box.x),
    snap(p0[1] + t * dy, box.y)
  ]
  return [at(t0), at(t1)]
}

/** Whether a point (in the axes' own space) is inside the box. */
const inside = ([x, y]: [number, number], box: Box): boolean =>
  (!box.x || (x >= box.x.lo && x <= box.x.hi)) && (!box.y || (y >= box.y.lo && y <= box.y.hi))

/** A path of straight segments (M / L, absolute) cut to the box, as a path; '' when none of it is
 *  inside; null when it isn't such a path, or lies wholly inside (left as it is). */
function clipPath(d: string, box: Box): string | null {
  const toks = d.trim().match(/[MLml]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
  if (!toks || /[^MLml\d\s,.eE+-]/.test(d)) return null
  const subpaths: Array<Array<[number, number]>> = []
  let cmd = ''
  for (let i = 0; i < toks.length;) {
    const t = toks[i]
    if (/[MLml]/.test(t)) {
      if (t === 'm' || t === 'l') return null // relative: not ours to cut
      cmd = t
      i++
      continue
    }
    const x = Number(t)
    const y = Number(toks[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (cmd === 'M' || !subpaths.length) subpaths.push([])
    subpaths[subpaths.length - 1].push([toSpace(x, box.x), toSpace(y, box.y)])
    // after an M, more pairs are line-tos
    cmd = 'L'
    i += 2
  }
  if (subpaths.every((sp) => sp.every((q) => inside(q, box)))) return null
  const out: string[] = []
  const pt = ([x, y]: [number, number]): string => `${fromSpace(x, box.x)},${fromSpace(y, box.y)}`
  for (const sp of subpaths) {
    let open = false
    let last: [number, number] | null = null
    for (let k = 1; k < sp.length; k++) {
      const seg = clipSegment(sp[k - 1], sp[k], box)
      if (!seg) {
        open = false
        continue
      }
      const [a, b] = seg
      const joined =
        open && last && Math.abs(last[0] - a[0]) < 1e-12 && Math.abs(last[1] - a[1]) < 1e-12
      out.push(joined ? `L${pt(b)}` : `M${pt(a)}L${pt(b)}`)
      open = true
      last = b
    }
  }
  return out.join('')
}

/** One shape cut to the ranges: as it is (nothing to cut, or not ours), cut, or null (outside). */
function clipShape(s: Shape, fullLayout: Shape): Shape | null {
  if (s.xsizemode === 'pixel' || s.ysizemode === 'pixel') return s
  const box: Box = {
    x: spanOf(s.xref, 'x', fullLayout),
    y: spanOf(s.yref, 'y', fullLayout)
  }
  if (!box.x && !box.y) return s
  const type = s.type ?? (s.path ? 'path' : 'line')
  if (type === 'path') {
    if (typeof s.path !== 'string') return s
    const d = clipPath(s.path, box)
    if (d == null) return s
    return d ? { ...s, path: d } : null
  }
  const num = (k: string): number | null => {
    const v = Number(s[k])
    return Number.isFinite(v) ? v : null
  }
  const [x0, x1, y0, y1] = ['x0', 'x1', 'y0', 'y1'].map(num)
  if (x0 == null || x1 == null || y0 == null || y1 == null) return s
  const a: [number, number] = [toSpace(x0, box.x), toSpace(y0, box.y)]
  const b: [number, number] = [toSpace(x1, box.x), toSpace(y1, box.y)]
  if (inside(a, box) && inside(b, box)) return s
  if (type === 'line') {
    const seg = clipSegment(a, b, box)
    if (!seg) return null
    const [[cx0, cy0], [cx1, cy1]] = seg
    return {
      ...s,
      x0: fromSpace(cx0, box.x),
      y0: fromSpace(cy0, box.y),
      x1: fromSpace(cx1, box.x),
      y1: fromSpace(cy1, box.y)
    }
  }
  if (type === 'rect') {
    const clamp = (v: number, sp: AxisSpan | undefined): number =>
      sp ? Math.min(sp.hi, Math.max(sp.lo, v)) : v
    const out = {
      ...s,
      x0: fromSpace(clamp(a[0], box.x), box.x),
      x1: fromSpace(clamp(b[0], box.x), box.x),
      y0: fromSpace(clamp(a[1], box.y), box.y),
      y1: fromSpace(clamp(b[1], box.y), box.y)
    }
    return out.x0 === out.x1 || out.y0 === out.y1 ? null : out
  }
  return s
}

/** `shapes` cut to the drawn ranges in `fullLayout` (see the module note) — the same array when
 *  nothing needed cutting, so a caller can tell. */
export function clipShapesToRanges(shapes: unknown, fullLayout: Shape | undefined): unknown {
  if (!Array.isArray(shapes) || !fullLayout) return shapes
  let changed = false
  const out: Shape[] = []
  for (const s of shapes as Shape[]) {
    const c = s && typeof s === 'object' ? clipShape(s, fullLayout) : s
    if (c !== s) changed = true
    if (c) out.push(c)
  }
  return changed ? out : shapes
}
