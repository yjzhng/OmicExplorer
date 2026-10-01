/** Territory outlines for the cluster plot: the region a condition's replicates occupy.
 *
 *  Two shapes, both closed rings in plot coordinates (first point repeated last, so Plotly can
 *  fill them):
 *
 *  - `hull` — the convex hull of the replicates. Says exactly "the measurements landed in here"
 *    and claims nothing beyond them, which is the honest reading when a condition has a handful
 *    of replicates.
 *  - `gaussian` — a covariance ellipse at ~95% (a normal model of the same points). Smoother and
 *    comparable between conditions, but it extrapolates: it draws area where nothing was measured,
 *    and assumes the spread is elliptical.
 *
 *  Kept apart from the view because it is geometry, not rendering, and worth testing directly.
 */
import { jacobiEigenSymmetric } from '../engine'

export type TerritoryShape = 'hull' | 'gaussian'

export interface Pt {
  x: number
  y: number
}

/** Mahalanobis radius for a 2-D ~95% region: √χ²(0.95, 2 df) = √5.991. */
const GAUSS_K = Math.sqrt(5.991464547107979)
/** Points on the drawn ellipse — enough that it reads as a curve at any plot size. */
const ELLIPSE_STEPS = 64
/** Coordinates closer than this count as the same point (guards degenerate hulls). */
const EPS = 1e-9

/** Distinct points, in input order. Replicates sitting exactly on top of each other would
 *  otherwise make a "polygon" with no area. */
function distinct(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = []
  for (const p of pts)
    if (!out.some((q) => Math.abs(q.x - p.x) < EPS && Math.abs(q.y - p.y) < EPS)) out.push(p)
  return out
}

/** Convex hull by Andrew's monotone chain — sort by (x, y), then build the lower and upper chains.
 *  Returns the hull vertices counter-clockwise, NOT closed (the caller closes it). */
export function convexHull(pts: readonly Pt[]): Pt[] {
  const P = distinct(pts).sort((a, b) => a.x - b.x || a.y - b.y)
  if (P.length < 3) return P
  // > 0 = counter-clockwise turn. Collinear points (== 0) are dropped, so the hull carries only
  // real corners.
  const cross = (o: Pt, a: Pt, b: Pt): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (src: Pt[]): Pt[] => {
    const h: Pt[] = []
    for (const p of src) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
      h.push(p)
    }
    return h
  }
  const lower = half(P)
  const upper = half([...P].reverse())
  // Each chain repeats the other's first point, so drop both endpoints of the upper chain.
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** The ~95% covariance ellipse of `pts`, as a ring of points. Null when there is too little to
 *  estimate a spread from (< 3 distinct points) or the points are exactly collinear — in both
 *  cases the "ellipse" collapses to a line, which would read as a region rather than none. */
export function gaussianEllipse(pts: readonly Pt[]): Pt[] | null {
  const P = distinct(pts)
  if (P.length < 3) return null
  const n = P.length
  const mx = P.reduce((s, p) => s + p.x, 0) / n
  const my = P.reduce((s, p) => s + p.y, 0) / n
  // Sample covariance (n-1), matching the SD convention used elsewhere in the app.
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of P) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  sxx /= n - 1
  syy /= n - 1
  sxy /= n - 1
  const { values, vectors } = jacobiEigenSymmetric([
    [sxx, sxy],
    [sxy, syy]
  ])
  // jacobiEigenSymmetric sorts descending, so axis 0 is the major one. A non-positive eigenvalue
  // means no spread in that direction (collinear points) — no area to draw.
  const [l0, l1] = values
  if (!(l0 > 0) || !(l1 > 0)) return null
  const r0 = GAUSS_K * Math.sqrt(l0)
  const r1 = GAUSS_K * Math.sqrt(l1)
  // Eigenvectors are COLUMNS of `vectors` (vectors[i][k] = component i of eigenvector k).
  const u = [vectors[0][0], vectors[1][0]]
  const v = [vectors[0][1], vectors[1][1]]
  const ring: Pt[] = []
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const t = (2 * Math.PI * i) / ELLIPSE_STEPS
    const a = r0 * Math.cos(t)
    const b = r1 * Math.sin(t)
    ring.push({ x: mx + a * u[0] + b * v[0], y: my + a * u[1] + b * v[1] })
  }
  return ring
}

/** The territory ring for one condition's replicates, closed (first point repeated last) and ready
 *  to fill, or null when there is nothing to bound at all.
 *
 *  A hull of exactly 2 distinct points comes back as the segment between them — geometrically what
 *  they bound, though it encloses no area. Whether a zero-area ring is worth drawing is the
 *  caller's call (the cluster view fills without a stroke, so it skips them). A single point, or
 *  replicates all landing together, gets no ring — the centroid marker already says it. */
export function territoryRing(pts: readonly Pt[], shape: TerritoryShape): Pt[] | null {
  const ring = shape === 'gaussian' ? gaussianEllipse(pts) : convexHull(pts)
  if (!ring || ring.length < 2) return null
  return [...ring, ring[0]]
}
