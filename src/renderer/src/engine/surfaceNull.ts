/**
 * The 4PL surface's adjusted F — CurveCurator's recalibrated F, in 2-D. The joint model
 * (surfaceJoint.ts) is non-linear and its parameters are undefined under a flat surface, so its F
 * against flat has no textbook null. Instead, per design (the treated cells' doses, times and
 * vehicle groups): simulate flat surfaces, fit the joint model to each, score them exactly as a
 * real surface is scored (the variance moderated toward the run's prior); a surface's p is its F's
 * tail in that null (fitNullTail: the sample, with a fitted tail beyond it).
 *
 * The null's noise has the structure of an effect: a cell mean minus its time's vehicle mean, so
 * each cell carries its own noise plus its vehicle group's, shared by every dose at that time (a
 * top varying with time can partly fit that). The variance is split evenly between the two
 * (vehicle and treatments alike replicated). F is scale-free, so the simulation runs at unit noise;
 * the moderation enters as the prior's share of the posterior variance — under the prior's own
 * model, s₀²/σ² ~ χ²(d0)/d0 — with κ, the null's mean residual variance per unit noise, setting
 * the units.
 */
import { rng } from './sam'
import type { JointBatch, JointFit } from './surfaceJoint'

export interface SurfaceDesign {
  treated: Array<{ dose: number; time: number; group: number }>
  /** vehicle groups (one per vehicle time; the treated cells' `group` indexes them) */
  nGroups: number
  timeOffset: number
}

/** A design's identity: its treated cells (dose, time, vehicle group) in order, and time offset. */
export function designKey(d: SurfaceDesign): string {
  return `${d.timeOffset}|${d.treated.map((t) => `${t.dose}:${t.time}:${t.group}`).join(',')}`
}

/** A standard normal and a χ²(k) draw (k > 0, any real) from a uniform source. */
function samplers(R: () => number): { normal: () => number; chi2: (k: number) => number } {
  const normal = (): number => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(2 * Math.PI * R())
  // Marsaglia–Tsang gamma(a, 1); a < 1 by the boost a → a + 1, × U^(1/a)
  const gamma = (a: number): number => {
    if (a < 1) return gamma(a + 1) * (1 - R()) ** (1 / a)
    const d = a - 1 / 3
    const c = 1 / Math.sqrt(9 * d)
    for (;;) {
      let x: number
      let v: number
      do {
        x = normal()
        v = 1 + c * x
      } while (v <= 0)
      v = v ** 3
      const u = 1 - R()
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v
    }
  }
  return { normal, chi2: (k) => 2 * gamma(k / 2) }
}

/** `m` flat surfaces on a design, at unit noise (seeded: the same design and seed, the same
 *  surfaces), ready to fit. */
export function nullSurfaces(d: SurfaceDesign, m: number, seed: number): JointBatch {
  const { normal } = samplers(rng(seed))
  const sd = Math.SQRT1_2
  const out: JointBatch = []
  for (let s = 0; s < m; s++) {
    const veh = Array.from({ length: d.nGroups }, () => sd * normal())
    out.push({
      cells: d.treated.map((t) => ({
        dose: t.dose,
        time: t.time,
        e: sd * normal() - veh[t.group]
      })),
      timeOffset: d.timeOffset
    })
  }
  return out
}

/** A surface's F against flat from its effects' RSS₀ (every effect 0) and joint-fit RSS₁, with its
 *  residual variance s² = RSS₁/(N − 6) moderated: post = (d0·s0² + d·s²)/(d0 + d). */
export function jointF(
  rss0: number,
  rss1: number,
  n: number,
  d0: number,
  s0sq: number
): {
  F: number
  df2: number
} {
  const d = n - 6
  const r1 = Math.min(rss0, rss1)
  const post =
    d0 === Infinity ? s0sq : d0 > 0 && Number.isFinite(s0sq) ? (d0 * s0sq + r1) / (d0 + d) : r1 / d
  return { F: post > 0 ? (rss0 - r1) / 6 / post : 0, df2: d0 === Infinity ? 1e6 : d0 + d }
}

/** The null F's of a design's simulated surfaces (nullSurfaces, then fitted), scored as a real
 *  surface under a run prior of d0 df: each surface's prior variance drawn as κ·χ²(d0)/d0. */
export function nullF(batch: JointBatch, fits: JointFit[], d0: number, seed: number): number[] {
  const { chi2 } = samplers(rng(seed ^ 0x5bd1e995))
  const rs = batch.map((b, i) => ({
    rss0: b.cells.reduce((a, c) => a + c.e * c.e, 0),
    rss1: fits[i].rss,
    n: b.cells.length
  }))
  const kappa = rs.reduce((a, r) => a + Math.min(r.rss0, r.rss1) / (r.n - 6), 0) / rs.length
  return rs.map(
    (r) =>
      jointF(
        r.rss0,
        r.rss1,
        r.n,
        d0,
        d0 === Infinity ? kappa : d0 > 0 ? (kappa * chi2(d0)) / d0 : NaN
      ).F
  )
}

/**
 * A null distribution from its simulated sample: the sample itself up to its 90th percentile, and
 * above it a generalized Pareto tail fitted to the exceedances (maximum likelihood), so p can go
 * below 1/sample size. Benchmarked against 20 000 held-out null surfaces (8 × 8 and 5 × 5 designs,
 * 4000 simulated): p < 0.1% / 0.01% realised ≈ 0.10–0.12% / 0.016% — where a shifted or scaled F
 * fitted to the same sample was ~20× conservative (its tail too light) and an exponential tail ~2×
 * liberal.
 */
export interface NullTail {
  /** the simulated null F's, ascending */
  sorted: number[]
  /** the tail threshold (the sample's 90th percentile) and the share above it */
  u: number
  share: number
  /** the generalized Pareto tail's shape and scale */
  xi: number
  sigma: number
}

export function fitNullTail(sample: number[], q = 0.9): NullTail {
  const sorted = [...sample].sort((a, b) => a - b)
  const u = sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const z = sorted.filter((v) => v > u).map((v) => v - u)
  const share = z.length / sorted.length
  const mean = z.reduce((a, v) => a + v, 0) / Math.max(1, z.length)
  // −log likelihood over (ξ, log σ)
  const cost = ([xi, ls]: number[]): number => {
    const sg = Math.exp(ls)
    let c = z.length * ls
    if (Math.abs(xi) < 1e-9) for (const v of z) c += v / sg
    else
      for (const v of z) {
        const t = 1 + (xi * v) / sg
        if (!(t > 0)) return Infinity
        c += (1 + 1 / xi) * Math.log(t)
      }
    return c
  }
  const [xi, ls] = nelderMead(cost, [0.1, Math.log(mean || 1)], [0.1, 0.2])
  return { sorted, u, share, xi, sigma: Math.exp(ls) }
}

/** P(F ≥ f) under a fitted null. */
export function nullSurvival(f: number, t: NullTail): number {
  if (!Number.isFinite(f)) return f > 0 ? 0 : 1
  if (f > t.u) {
    const z = f - t.u
    const g =
      Math.abs(t.xi) < 1e-9
        ? Math.exp(-z / t.sigma)
        : Math.max(0, 1 + (t.xi * z) / t.sigma) ** (-1 / t.xi)
    return t.share * g
  }
  // empirical: the share of the sample at or above f
  const a = t.sorted
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (a[m] < f) lo = m + 1
    else hi = m
  }
  return (a.length - lo) / a.length
}

/** Nelder–Mead minimisation from x0 with initial steps `step` (small, smooth problems). */
function nelderMead(f: (x: number[]) => number, x0: number[], step: number[]): number[] {
  const n = x0.length
  let pts = [x0, ...step.map((h, j) => x0.map((v, k) => (k === j ? v + h : v)))].map((x) => ({
    x,
    c: f(x)
  }))
  for (let it = 0; it < 400; it++) {
    pts.sort((a, b) => a.c - b.c)
    const best = pts[0]
    const worst = pts[n]
    if (Math.abs(worst.c - best.c) < 1e-10 * (1 + Math.abs(best.c))) break
    const cen = x0.map((_, k) => pts.slice(0, n).reduce((a, p) => a + p.x[k], 0) / n)
    const at = (t: number): { x: number[]; c: number } => {
      const x = cen.map((c, k) => c + t * (worst.x[k] - c))
      return { x, c: f(x) }
    }
    const r = at(-1)
    if (r.c < best.c) {
      const e = at(-2)
      pts[n] = e.c < r.c ? e : r
    } else if (r.c < pts[n - 1].c) pts[n] = r
    else {
      const k = at(r.c < worst.c ? -0.5 : 0.5)
      if (k.c < Math.min(r.c, worst.c)) pts[n] = k
      else
        pts = pts.map((p, i) => {
          if (i === 0) return p
          const x = p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]))
          return { x, c: f(x) }
        })
    }
  }
  pts.sort((a, b) => a.c - b.c)
  return pts[0].x
}
