/**
 * Joint description of a dose × time surface — the alternative to describing it slice by slice
 * (describeSurface's default). One model over every treated cell, on log₂ effects relative to the
 * cell's vehicle:
 *
 *   e(x, u) = top(u) · S(x; m(u), h)
 *   S      = 1 / (1 + 10^(−h·(x − m)))          the dose curve, from 0 (the vehicle) to 1
 *   top(u) = A / (1 + 10^(−k·(u − τ)))          the response size over time, from t₀ (τ ≥ t₀)
 *   m(u)   = m0 + m1·(u − ū)                    the midpoint (log₁₀ dose), drifting with time
 *
 * x = log₁₀ dose, u = log₁₀(t + offset) as in the surface fit. Six parameters, fitted to all the
 * cells at once, so a weak time point borrows from its neighbours; the price is the assumed smooth
 * change of top and midpoint with time. Bounded Levenberg–Marquardt from the best few of a grid of
 * starts (A solved by least squares for each).
 */
import { PEC50_DELTA, Y_LIMITS_LOG2 } from './curveFit'
import type { SplineCurve } from './splineFit'

export interface JointParams {
  A: number
  k: number
  tau: number
  m0: number
  m1: number
  h: number
}

type P = [number, number, number, number, number, number] // A, k, tau, m0, m1, h

const sig = (z: number): number =>
  z > 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))

function model(p: P, x: number, u: number, ubar: number): number {
  const [A, k, tau, m0, m1, h] = p
  return A * sig(k * Math.LN10 * (u - tau)) * sig(h * Math.LN10 * (x - (m0 + m1 * (u - ubar))))
}

function sse(p: P, xs: number[], us: number[], e: number[], ubar: number): number {
  let s = 0
  for (let i = 0; i < e.length; i++) s += (e[i] - model(p, xs[i], us[i], ubar)) ** 2
  return s
}

/** Solve the small dense system M·d = g (Gaussian elimination, partial pivoting); null if singular. */
function solve(M: number[][], g: number[]): number[] | null {
  const n = g.length
  const a = M.map((r, i) => [...r, g[i]])
  for (let c = 0; c < n; c++) {
    let piv = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r
    if (!(Math.abs(a[piv][c]) > 1e-300)) return null
    ;[a[c], a[piv]] = [a[piv], a[c]]
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c]
      for (let j = c; j <= n; j++) a[r][j] -= f * a[c][j]
    }
  }
  const d = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n]
    for (let j = r + 1; j < n; j++) s -= a[r][j] * d[j]
    d[r] = s / a[r][r]
  }
  return d
}

/** Bounded LM with a forward-difference Jacobian; steps are clamped into the box. */
function refine(
  p0: P,
  lo: P,
  hi: P,
  xs: number[],
  us: number[],
  e: number[],
  ubar: number
): { p: P; cost: number } {
  const clamp = (p: number[]): P => p.map((v, i) => Math.min(hi[i], Math.max(lo[i], v))) as P
  let p = clamp(p0)
  let cost = sse(p, xs, us, e, ubar)
  let lambda = 1e-3
  const n = e.length
  for (let iter = 0; iter < 200 && cost > 0; iter++) {
    const f0 = e.map((_, i) => model(p, xs[i], us[i], ubar))
    const J: number[][] = Array.from({ length: n }, () => new Array<number>(6).fill(0))
    for (let j = 0; j < 6; j++) {
      const dh = 1e-6 * Math.max(1, Math.abs(p[j]))
      const q = [...p] as P
      q[j] += dh
      for (let i = 0; i < n; i++) J[i][j] = (model(q, xs[i], us[i], ubar) - f0[i]) / dh
    }
    const JtJ = Array.from({ length: 6 }, (_, a) =>
      Array.from({ length: 6 }, (_, b) => J.reduce((s, r) => s + r[a] * r[b], 0))
    )
    const g = Array.from({ length: 6 }, (_, a) =>
      J.reduce((s, r, i) => s + r[a] * (e[i] - f0[i]), 0)
    )
    let improved = false
    while (lambda < 1e10) {
      const M = JtJ.map((r, a) => r.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)))
      const d = solve(M, g)
      if (d) {
        const q = clamp(p.map((v, j) => v + d[j]))
        const c = sse(q, xs, us, e, ubar)
        if (c < cost) {
          improved = cost - c > 1e-12 * cost + 1e-14
          p = q
          cost = c
          lambda = Math.max(lambda / 10, 1e-12)
          break
        }
      }
      lambda *= 10
    }
    if (!improved) break
  }
  return { p, cost }
}

/**
 * Fit the joint model to a fitted surface's treated cells (effects vs their vehicle). Returns the
 * parameters, the midpoint (log₁₀ dose) and top at each treated time, and the residual sum of
 * squares over the cells. Null for one-axis curves. `prefit` is a fit of these same cells already
 * made (the 4PL surface detector's), used as it is rather than fitted again.
 */
export function fitJointSurface(
  c: SplineCurve,
  interpolation = false,
  prefit?: JointFit
): {
  params: JointParams
  byTime: Array<{ time: number; x50: number; top: number }>
  rss: number
  /** ū, the mean log time m(u) is centred on (see jointPredict) */
  ubar: number
} | null {
  const s = c.surface
  if (!s) return null
  const nG = s.vehicle.length
  const fit =
    prefit ??
    fitJointCells(
      s.treated.map((r, i) => ({
        dose: r.dose,
        time: r.time,
        e: c.y[nG + i] - s.vehicle[r.group].mean
      })),
      s.timeOffset,
      interpolation
    )
  const times = [...new Set(s.treated.map((r) => r.time))].sort((a, b) => a - b)
  const { A, k, tau, m0, m1 } = fit.params
  return {
    params: fit.params,
    byTime: times.map((time) => {
      const u = Math.log10(time + s.timeOffset)
      return { time, x50: m0 + m1 * (u - fit.ubar), top: A * sig(k * Math.LN10 * (u - tau)) }
    }),
    rss: fit.rss,
    ubar: fit.ubar
  }
}

/** The joint model fitted to bare cells — each one's dose, time and log₂ effect vs its vehicle —
 *  with the time axis log₁₀(t + timeOffset). Returns the parameters, the residual sum of squares
 *  over the cells, and ū (the mean log time m(u) is centred on). With `interpolation`
 *  (CurveCurator's), the fit also sees a point at the centre of each square of the measured grid
 *  (gridInterpolation); the RSS is still over the real cells alone. */
export function fitJointCells(
  cells: Array<{ dose: number; time: number; e: number }>,
  timeOffset: number,
  interpolation = false
): { params: JointParams; rss: number; ubar: number } {
  const real = cells
  if (interpolation) cells = [...cells, ...gridInterpolation(cells, timeOffset)]
  const e = cells.map((c) => c.e)
  const xs = cells.map((c) => Math.log10(c.dose))
  const us = cells.map((c) => Math.log10(c.time + timeOffset))
  const u0 = Math.log10(timeOffset)
  const ubar = us.reduce((a, v) => a + v, 0) / us.length
  const xl = [...new Set(xs)].sort((a, b) => a - b)
  const ul = [...new Set(us)].sort((a, b) => a - b)
  const xmin = xl[0]
  const xmax = xl[xl.length - 1]
  const lo: P = [Y_LIMITS_LOG2[0], 0.01, u0, xmin - PEC50_DELTA, -2, 0.01]
  const hi: P = [Y_LIMITS_LOG2[1], 10, ul[ul.length - 1] + 1, xmax + PEC50_DELTA, 2, 10]
  const q = (a: number[], f: number): number =>
    a[Math.min(a.length - 1, Math.floor(f * (a.length - 1) + 0.5))]
  // a grid of starts — midpoint below / inside / above the doses, response arriving early to
  // late, shallow or steep — each with its A by least squares; the best three are refined
  const starts: Array<{ p: P; cost: number }> = []
  for (const m0 of [xmin - 1, q(xl, 0.25), q(xl, 0.5), q(xl, 0.75), xmax + 1])
    for (const tau of [u0 + 0.01, q(ul, 0.25), q(ul, 0.5), q(ul, 0.75)])
      for (const h of [1, 5]) {
        const p: P = [1, 2, tau, m0, 0, h]
        const sh = xs.map((x, i) => model(p, x, us[i], ubar))
        const ss = sh.reduce((a, v) => a + v * v, 0)
        p[0] = ss > 0 ? sh.reduce((a, v, i) => a + v * e[i], 0) / ss : 0
        starts.push({ p, cost: sse(p, xs, us, e, ubar) })
      }
  starts.sort((a, b) => a.cost - b.cost)
  let best = { p: starts[0].p, cost: Infinity }
  for (const st of starts.slice(0, 3)) {
    const r = refine(st.p, lo, hi, xs, us, e, ubar)
    if (r.cost < best.cost) best = r
  }
  const [A, k, tau, m0, m1, h] = best.p
  const rss =
    real === cells
      ? best.cost
      : sse(
          best.p,
          real.map((c) => Math.log10(c.dose)),
          real.map((c) => Math.log10(c.time + timeOffset)),
          real.map((c) => c.e),
          ubar
        )
  return { params: { A, k, tau, m0, m1, h }, rss, ubar }
}

/** CurveCurator's interpolation points for a surface's cells, at the centre of each square of
 *  the measured grid: midway between neighbouring doses (log₁₀ dose) and neighbouring times
 *  (log₁₀(t + offset)), its value read off the bilinear surface through the square's four corners
 *  — at the centre, their mean (replicates at a corner averaged first). A square with a corner
 *  unmeasured gets none. Inside the squares, never on the grid's lines. */
function gridInterpolation(
  cells: Array<{ dose: number; time: number; e: number }>,
  timeOffset: number
): Array<{ dose: number; time: number; e: number }> {
  const lt = (t: number): number => Math.log10(t + timeOffset)
  const sums = new Map<string, { s: number; n: number }>()
  for (const c of cells) {
    if (!Number.isFinite(c.e)) continue
    const k = `${c.dose}|${c.time}`
    const a = sums.get(k)
    if (a) {
      a.s += c.e
      a.n++
    } else sums.set(k, { s: c.e, n: 1 })
  }
  const at = (dose: number, time: number): number | undefined => {
    const a = sums.get(`${dose}|${time}`)
    return a ? a.s / a.n : undefined
  }
  const doses = [...new Set(cells.map((c) => c.dose))].sort((a, b) => a - b)
  const times = [...new Set(cells.map((c) => c.time))].sort((a, b) => a - b)
  const out: Array<{ dose: number; time: number; e: number }> = []
  for (let i = 0; i + 1 < doses.length; i++)
    for (let j = 0; j + 1 < times.length; j++) {
      const corners = [
        at(doses[i], times[j]),
        at(doses[i + 1], times[j]),
        at(doses[i], times[j + 1]),
        at(doses[i + 1], times[j + 1])
      ]
      if (corners.some((v) => v === undefined)) continue
      out.push({
        dose: 10 ** ((Math.log10(doses[i]) + Math.log10(doses[i + 1])) / 2),
        time: 10 ** ((lt(times[j]) + lt(times[j + 1])) / 2) - timeOffset,
        e: (corners as number[]).reduce((a, v) => a + v, 0) / 4
      })
    }
  return out
}

/** The joint model's value at a dose and time (fitJointCells' parameters and ū). */
export function jointPredict(
  p: JointParams,
  ubar: number,
  dose: number,
  time: number,
  timeOffset: number
): number {
  return model(
    [p.A, p.k, p.tau, p.m0, p.m1, p.h],
    Math.log10(dose),
    Math.log10(time + timeOffset),
    ubar
  )
}

/** A batch of joint fits to hand out (to the worker pool, or fitted in place). */
export type JointBatch = Array<{
  cells: Array<{ dose: number; time: number; e: number }>
  timeOffset: number
  /** CurveCurator's interpolation in the fit (see fitJointCells) */
  interpolation?: boolean
}>
export type JointFit = ReturnType<typeof fitJointCells>
/** Fit a batch here, one surface after another. */
export const fitJointBatch = (batch: JointBatch): JointFit[] =>
  batch.map((j) => fitJointCells(j.cells, j.timeOffset, j.interpolation))
