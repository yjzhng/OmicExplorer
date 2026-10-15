/** Parity with CurveCurator's own unit tests (tests/unit/test_model_logistic.py,
 *  test_thresholding.py) — the expected values below are copied from there. */
import { describe, expect, it } from 'vitest'

import {
  applyCurveFdr,
  interpolationGrid,
  boundsFor,
  classifyCompareRow,
  curveCuratorFdr,
  curveGroupKey,
  curveCuratorBoundary,
  curveCuratorWall,
  curveSampleX,
  curveResidualPoints,
  curveMetrics,
  curveLackOfFit,
  curveResidualMad,
  curveDofs,
  fQuantile,
  relevanceScore,
  fitCurve,
  fitLogistic,
  fSurvival,
  logistic,
  startGuesses,
  type LogisticParams
} from './curveFit'
import { runCurveFit } from './direct'
import { DEFAULT_THRESHOLD, normalPpf, type ThresholdConfig } from './stats'
import type { StandardRow } from './types'

const at = (xs: number[], p: LogisticParams): number[] => xs.map((x) => logistic(x, p))

describe('logistic model', () => {
  const x = [-9, -8, -7, -6, -5]
  it('matches the core outputs', () => {
    const cases: Array<[LogisticParams, number[]]> = [
      [{ pec50: 7, slope: 1, front: 1, back: 0.1 }, [0.991, 0.918, 0.55, 0.182, 0.109]],
      [{ pec50: 5, slope: 1, front: 1, back: 0.1 }, [1.0, 0.999, 0.991, 0.918, 0.55]],
      [{ pec50: 7, slope: 0.5, front: 1, back: 0.1 }, [0.918, 0.784, 0.55, 0.316, 0.182]],
      [{ pec50: 7, slope: 1, front: 2, back: 0.1 }, [1.981, 1.827, 1.05, 0.273, 0.119]],
      [{ pec50: 7, slope: 1, front: 1, back: 10 }, [1.089, 1.818, 5.5, 9.182, 9.911]]
    ]
    for (const [p, want] of cases) at(x, p).forEach((y, i) => expect(y).toBeCloseTo(want[i], 3))
  })
  it('sits on the front plateau at the control (x = −∞)', () => {
    expect(logistic(-Infinity, { pec50: 7, slope: 1, front: 1.3, back: 0.2 })).toBe(1.3)
  })
})

describe('starting guesses', () => {
  const x = [-10, -9, -8, -7, -6, -5, -4]
  const y = x.map(() => 1)
  it('spaces the pEC50s as CurveCurator does', () => {
    const g = startGuesses(x, y, boundsFor(x))
    expect(g.map((v) => v[0])).toEqual([7.0, 10.5, 9.5, 8.5, 7.5, 6.5, 5.5, 4.5, 3.5])
  })
  it('picks the best guess (OLS)', () => {
    const best = (p: LogisticParams): number => {
      const ys = at(x, p)
      const b = boundsFor(x)
      let pick = 0
      let cost = Infinity
      for (const g of startGuesses(x, ys, b)) {
        const c = ys.reduce(
          (s, yy, i) =>
            s + (yy - logistic(x[i], { pec50: g[0], slope: g[1], front: g[2], back: g[3] })) ** 2,
          0
        )
        if (c <= cost) [pick, cost] = [g[0], c]
      }
      return pick
    }
    expect(best({ pec50: 7, slope: 1, front: 1, back: 0 })).toBe(7.5)
    expect(best({ pec50: 4, slope: 1, front: 1, back: 0 })).toBe(4.5)
    expect(best({ pec50: 8, slope: 1, front: 1, back: 1 })).toBe(3.5)
  })
})

describe('fitting', () => {
  it('recovers the parameters of an exact curve (atol 1e-4)', () => {
    const x = Array.from({ length: 20 }, (_, i) => -10 + (5 * i) / 19)
    const truth = { pec50: 7, slope: 1, front: 1, back: 0.1 }
    const p = fitLogistic(x, at(x, truth), x)
    expect(p.pec50).toBeCloseTo(7, 4)
    expect(p.slope).toBeCloseTo(1, 4)
    expect(p.front).toBeCloseTo(1, 4)
    expect(p.back).toBeCloseTo(0.1, 4)
  })
})

describe('recalibrated F', () => {
  it('has the optimized degrees of freedom', () => {
    const N = [
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30, 40, 50, 60, 70, 80, 100
    ]
    const dfd = [
      1.4047619, 2.275, 3.31100917, 4.24722222, 5.11149773, 5.94386228, 6.76175869, 7.57249035,
      8.37935884, 9.18398966, 9.98724577, 10.78961538, 11.59138985, 12.39275099, 13.19381669,
      13.99466594, 21.99819513, 29.99910702, 37.99946959, 45.9996492, 53.99975099, 61.99981416,
      77.99988521
    ]
    N.forEach((n, i) => {
      expect(curveDofs(n).dfn).toBe(5)
      expect(curveDofs(n).dfd).toBeCloseTo(dfd[i], 6)
    })
  })
  it('has the F quantiles behind the s0 tests', () => {
    // get_s0(fc_lim = 1, alpha, dfn = 5, dfd) = 1 / sqrt(F.ppf(1 − alpha')) — so these points sit
    // at the stated tail probabilities.
    const q = (s0: number): number => 1 / s0 ** 2
    expect(fSurvival(q(0.4858672572170374), 5, 10)).toBeCloseTo(0.025, 6) // two-sided α = 0.05
    expect(fSurvival(q(0.5483396884699329), 5, 10)).toBeCloseTo(0.05, 6) // one-sided
    expect(fSurvival(q(0.38145809519312646), 5, 10)).toBeCloseTo(0.005, 6)
    expect(fSurvival(q(0.6090252621538038), 5, 100)).toBeCloseTo(0.025, 6)
    // loc shifts the distribution: get_s0(…, loc = 1)
    expect(fSurvival(q(0.43701528619494895), 5, 10, 1)).toBeCloseTo(0.025, 6)
  })
})

describe('fitCurve', () => {
  const doses = [0, 1, 2, 3, 4] // log₁₀ dose 1 … 10000
  it('calls a clean sigmoid significant with its fold change', () => {
    const truth = { pec50: -2, slope: 1.5, front: 1, back: 0.25 }
    const fit = fitCurve(
      doses,
      at(doses, truth).map((y, i) => y * (1 + 0.01 * ((i % 2) * 2 - 1)))
    )!
    expect(fit.n).toBe(6)
    expect(fit.pVal).toBeLessThan(0.01)
    expect(fit.r2).toBeGreaterThan(0.95)
    expect(fit.log2FC).toBeLessThan(-1.5)
    expect(-fit.pec50).toBeCloseTo(2, 0) // EC50 ≈ 10² in dose units
  })
  it('leaves a flat, noisy response insignificant', () => {
    const fit = fitCurve(doses, [1.05, 0.96, 1.02, 0.97, 1.03])!
    expect(fit.pVal).toBeGreaterThan(0.05)
  })
  it('needs more than four points (control included)', () => {
    expect(fitCurve([0, 1, 2], [1, 0.8, 0.5])).toBeNull()
    expect(fitCurve([0, 1, 2, 3], [1, 0.8, NaN, 0.3])).toBeNull()
  })
})

describe('curveCuratorWall', () => {
  it('is where the relevance boundary turns finite, never inside the FC limit', () => {
    for (const n of [6, 8, 11])
      for (const alpha of [0.05, 0.01, 0.3]) {
        const w = curveCuratorWall(n, 0.45, alpha)
        expect(w).toBeGreaterThanOrEqual(0.45)
        expect(curveCuratorBoundary(w * 0.999, n, 0.45, alpha)).toBe(Infinity)
        expect(Number.isFinite(curveCuratorBoundary(w * 1.001, n, 0.45, alpha))).toBe(true)
      }
  })
  it('moves out when the cutoff is stricter than the α s0 was set at', () => {
    expect(curveCuratorWall(6, 0.45, 0.05, 3)).toBeGreaterThan(0.6)
  })
})

describe('curveMetrics', () => {
  const doses = [0, 1, 2, 3, 4]
  const truth = { pec50: -2, slope: 1.5, front: 1, back: 0.25 }
  const ratios = at(doses, truth).map((y, i) => y * (1 + 0.02 * ((i % 2) * 2 - 1)))
  const fit = fitCurve(doses, ratios)!
  const { log2FC } = fit
  const cc: ThresholdConfig = {
    ...DEFAULT_THRESHOLD,
    type: 'curvecurator',
    statType: 'pP',
    fcLow: -0.45,
    fcHigh: 0.45,
    statMin: -Math.log10(0.05)
  }

  it('lists the fit as CurveCurator does, with EC50 = 10^−pEC50', () => {
    const m = curveMetrics(log2FC, fit, cc)
    expect(m.pEC50).toBe(fit.pec50)
    expect(m.EC50).toBeCloseTo(10 ** -fit.pec50, 10)
    expect(m.points).toBe(6)
    expect(m.F).toBe(fit.f)
    expect(m.relevance).toBeCloseTo(relevanceScore(log2FC, fit.f, fit.n, 0.45, 0.05), 10)
  })
  it('gives the RMSE of the residuals, kept or recomputed from the points', () => {
    const kept = curveMetrics(log2FC, fit, cc).RMSE!
    const older = { ...fit, rmse: undefined, x: doses, y: ratios }
    const fromPts = curveMetrics(log2FC, older, cc).RMSE!
    expect(kept).toBeGreaterThan(0)
    expect(fromPts).toBeCloseTo(kept, 6)
  })
  it('converts pEC50 to molar with the dose unit’s scale, EC50 staying in the dose’s units', () => {
    const m = curveMetrics(log2FC, fit, cc, 1e-9) // nM
    expect(m.pEC50).toBeCloseTo(fit.pec50 + 9, 10)
    expect(m.EC50).toBeCloseTo(10 ** -fit.pec50, 10)
    expect(m.pEC50).toBeCloseTo(-Math.log10(m.EC50! * 1e-9), 10)
  })
  it('has no relevance score outside CurveCurator’s threshold', () => {
    expect(curveMetrics(log2FC, fit, DEFAULT_THRESHOLD).relevance).toBeUndefined()
  })
})

describe('curveResidualMad', () => {
  const p = { pec50: -2, slope: 1, front: 1, back: 0.5 }
  const xs = [0, 1, 2]
  it('is the median |ratio − fit| per dose across curves, the control against the front', () => {
    const fit = xs.map((x) => logistic(x, p))
    const curves = [
      { ...p, x: xs, y: fit.map((y, i) => y + [0.1, 0, 0][i]) },
      { ...p, x: xs, y: fit.map((y, i) => y + [-0.3, 0.02, 0][i]) },
      { ...p, front: 1.1, x: xs, y: [0, 1, 2].map((x) => logistic(x, { ...p, front: 1.1 })) }
    ]
    const m = curveResidualMad(curves)
    expect(m.map((d) => d.x)).toEqual([null, 0, 1, 2])
    expect(m[0].mad).toBeCloseTo(0, 10) // |1 − front|: 0, 0, 0.1 → median 0
    expect(m[1].mad).toBeCloseTo(0.1, 10) // 0.1, 0.3, 0 → 0.1
    expect(m[2].mad).toBeCloseTo(0, 10)
    expect(m[1].n).toBe(3)
  })
  it('separates the samples at a dose by replicate, the control’s too', () => {
    const fit = logistic(0, p)
    // Replicate 2 is off by 0.2 on every curve; replicate 1 sits on the fit.
    const curve = {
      ...p,
      x: [0, 0],
      y: [fit, fit + 0.2],
      rep: [1, 2],
      cy: [0.9, 1.1],
      crep: [1, 2]
    }
    const m = curveResidualMad([curve, curve])
    expect(m.map((d) => [d.x, d.rep])).toEqual([
      [null, 1],
      [null, 2],
      [0, 1],
      [0, 2]
    ])
    expect(m[0].mad).toBeCloseTo(0.1, 10)
    expect(m[2].mad).toBeCloseTo(0, 10)
    expect(m[3].mad).toBeCloseTo(0.2, 10)
    // Signed: the control's replicate 1 sits low (0.9 vs front 1), replicate 2 high.
    expect(m[0].median).toBeCloseTo(-0.1, 10)
    expect(m[1].median).toBeCloseTo(0.1, 10)
  })
  it('gives the signed residuals’ quartiles', () => {
    const fit = logistic(0, p)
    const curves = [-0.2, -0.1, 0, 0.1, 0.4].map((d) => ({ ...p, x: [0], y: [fit + d] }))
    const d = curveResidualMad(curves).find((m) => m.x === 0)!
    expect(d.median).toBeCloseTo(0, 10)
    expect(d.q1).toBeCloseTo(-0.1, 10)
    expect(d.q3).toBeCloseTo(0.1, 10)
    expect(d.mad).toBeCloseTo(0.1, 10)
  })
  it('pools each dose’s replicates when asked, keeping each residual’s replicate', () => {
    const fit = logistic(0, p)
    const curve = {
      ...p,
      x: [0, 0],
      y: [fit, fit + 0.2],
      rep: [1, 2],
      cy: [0.9, 1.1],
      crep: [1, 2]
    }
    const m = curveResidualMad([curve], true)
    expect(m.map((d) => [d.x, d.rep, d.n])).toEqual([
      [null, null, 2],
      [0, null, 2]
    ])
    expect(m[1].reps).toEqual([1, 2])
    expect(m[1].median).toBeCloseTo(0.1, 10)
  })
  it('skips curves without their kept points', () => {
    expect(curveResidualMad([p])).toEqual([])
  })
})

describe('runCurveFit layouts', () => {
  // Two drugs, 5 doses each, one gene responding to A only; controls either as a DMSO compound or
  // as each drug's own dose 0.
  const doses = [1, 10, 100, 1000, 10000]
  const resp = (cmpd: string, d: number): number =>
    cmpd === 'A' ? 100 * logistic(Math.log10(d), { pec50: -2, slope: 1, front: 1, back: 0.3 }) : 100
  const treated = (g: string): StandardRow[] =>
    ['A', 'B'].flatMap((c) =>
      doses.map((d, i) => row(g, c, d, resp(c, d) * (g === 'flat' ? 1 + 0.02 * (i % 2) : 1)))
    )
  const row = (uniqID: string, cmpd: string, dose: number, value: number): StandardRow =>
    ({ uniqID, cmpd, dose, time: null, value }) as unknown as StandardRow
  const genes = ['g1', 'flat']

  it('fits each drug against its own dose 0 as it does against a DMSO compound', () => {
    const viaDmso = runCurveFit({
      rows: genes.flatMap((g) => [...treated(g), row(g, 'DMSO', 0, 100)]),
      num: { cmpd: ['A', 'B'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose'],
      curveAxis: 'dose'
    })
    const viaDose0 = runCurveFit({
      rows: genes.flatMap((g) => [...treated(g), row(g, 'A', 0, 100), row(g, 'B', 0, 100)]),
      num: { dose: doses.map(String) },
      den: { dose: ['0'] },
      match: ['cmpd'],
      activeConditions: ['cmpd', 'dose'],
      curveAxis: 'dose'
    })
    expect(viaDose0.comparisons).toEqual(['dose curve | 0'])
    expect(viaDose0.rows).toHaveLength(4) // 2 genes × 2 drugs, one curve each
    for (const r of viaDose0.rows) {
      expect(r.dose).toBeNull()
      const twin = viaDmso.rows.find((x) => x.uniqID === r.uniqID && x.cmpd === r.cmpd)!
      expect(r.log2FC).toBeCloseTo(twin.log2FC!, 6)
      expect(r.pP).toBeCloseTo(twin.pP!, 6)
    }
    const g1A = viaDose0.rows.find((r) => r.uniqID === 'g1' && r.cmpd === 'A')!
    expect(g1A.log2FC!).toBeLessThan(-1)
    // Every curve gets its final model, under the default (non-CurveCurator) threshold too: the
    // responder's 4PL rejects flat; a drug the gene doesn't respond to stays M0.
    for (const r of viaDose0.rows) expect(r.model).toBeDefined()
    expect(g1A.model).toBe('4PL')
    expect(viaDose0.rows.find((r) => r.uniqID === 'g1' && r.cmpd === 'B')!.model).toBe('M0')
  })

  it('matches each drug to its own dose 0 when the drugs are pinned alike on both sides', () => {
    // The Curve fit dialog's "each compound against its own control level": the compounds pinned
    // on both sides, nothing in `match`. B sits 4× higher than A throughout, its control too — a
    // control pooled over both drugs would put B's curve at ratio 1.6 and A's at 0.4.
    const rows = genes.flatMap((g) => [
      ...treated(g).map((r) => (r.cmpd === 'B' ? { ...r, value: (r.value as number) * 4 } : r)),
      row(g, 'A', 0, 100),
      row(g, 'B', 0, 400),
      row(g, 'C', 0, 5) // another drug's control, outside the comparison
    ])
    const res = runCurveFit({
      rows,
      num: { cmpd: ['A', 'B'], dose: doses.map(String) },
      den: { cmpd: ['A', 'B'], dose: ['0'] },
      match: [],
      activeConditions: ['cmpd', 'dose'],
      curveAxis: 'dose'
    })
    expect(res.rows).toHaveLength(4)
    for (const r of res.rows) {
      expect(r.curve!.cy).toHaveLength(1) // its own control sample only
      expect(r.curve!.cy![0]).toBeCloseTo(1, 9)
    }
    const flatB = res.rows.find((r) => r.uniqID === 'flat' && r.cmpd === 'B')!
    for (const y of flatB.curve!.y!) expect(y).toBeGreaterThan(0.95)
    for (const y of flatB.curve!.y!) expect(y).toBeLessThan(1.1)
  })

  it('skips a drug with no dose 0 of its own instead of borrowing another drug’s', () => {
    const rows = genes.flatMap((g) => [...treated(g), row(g, 'A', 0, 100)])
    const res = runCurveFit({
      rows,
      num: { cmpd: ['A', 'B'], dose: doses.map(String) },
      den: { cmpd: ['A', 'B'], dose: ['0'] },
      match: [],
      activeConditions: ['cmpd', 'dose'],
      curveAxis: 'dose'
    })
    expect(new Set(res.rows.map((r) => r.cmpd))).toEqual(new Set(['A']))
  })
})

describe('CurveCurator relevance score', () => {
  it('has the F quantiles behind get_s0', () => {
    // get_s0(fc_lim = 1, …) = 1/√F.ppf(…): one-sided α 0.05, two-sided 0.05 with loc = 1.
    expect(fQuantile(0.95, 5, 10)).toBeCloseTo(1 / 0.5483396884699329 ** 2, 6)
    expect(fQuantile(0.975, 5, 10, 1)).toBeCloseTo(1 / 0.43701528619494895 ** 2, 6)
  })
  it('puts a curve on the drawn boundary exactly at the cutoff', () => {
    const n = 6
    const { dfn, dfd } = curveDofs(n)
    for (const fc of [0.6, 1, 2, -1.5]) {
      const p = 10 ** -curveCuratorBoundary(Math.abs(fc), n, 0.45, 0.05)
      const f = fQuantile(1 - p, dfn, dfd, 0.12) // the F with that p
      expect(relevanceScore(fc, f, n, 0.45, 0.05)).toBeCloseTo(-Math.log10(0.05), 5)
    }
  })
  it('draws the boundary at another relevance cutoff through a curve with that score', () => {
    const n = 8
    const { dfn, dfd } = curveDofs(n)
    const f = fQuantile(1 - 1e-4, dfn, dfd, 0.12)
    const score = relevanceScore(1.2, f, n, 0.45, 0.05)
    const y = curveCuratorBoundary(1.2, n, 0.45, 0.05, score)
    expect(y).toBeCloseTo(-Math.log10(fSurvival(f, dfn, dfd, 0.12)), 5)
  })

  it('flattens to α far out, and walls off small fold changes', () => {
    expect(curveCuratorBoundary(1e6, 6, 0.45, 0.05)).toBeCloseTo(-Math.log10(0.05), 4)
    expect(curveCuratorBoundary(0.4, 6, 0.45, 0.05)).toBe(Infinity)
    const t = {
      ...DEFAULT_THRESHOLD,
      type: 'curvecurator' as const,
      fcHigh: 0.45,
      fcLow: -0.45,
      statMin: -Math.log10(0.05)
    }
    const huge = { f: 1e6, n: 6 }
    expect(classifyCompareRow({ log2FC: 0.4, pP: 10, pQ: 10, curve: huge }, t).signf).toBe(false)
    expect(classifyCompareRow({ log2FC: -2, pP: 10, pQ: 10, curve: huge }, t)).toEqual({
      signf: true,
      effect: 'down',
      model: '4PL' // its F-test (p = 1e−10) rejects flat
    })
    // No curve (not a curve fit): never called under this boundary.
    expect(classifyCompareRow({ log2FC: 3, pP: 10, pQ: 10 }, t).signf).toBe(false)
  })
})

describe('CurveCurator target–decoy FDR', () => {
  const t = (over: Partial<ThresholdConfig> = {}): ThresholdConfig => ({
    ...DEFAULT_THRESHOLD,
    type: 'curvecurator',
    statType: 'pP',
    statMin: -Math.log10(0.05),
    fcHigh: 0.45,
    fcLow: -0.45,
    ...over
  })

  it('computes q as (decoys + 1)/(targets + 1) down the ranking, monotone, decoys first on ties', () => {
    // Scores rise with F at a fixed large fold change; two targets above every decoy, one tied.
    const at = (f: number): { f: number; log2FC: number; n: number } => ({ f, log2FC: 2, n: 8 })
    const targets = [at(400), at(300), at(50), at(1)]
    const decoys = [at(50), at(2), at(1.5), at(1.2)]
    const { q } = curveCuratorFdr(
      targets,
      decoys,
      0.45,
      0.45,
      0.05,
      targets.map(() => false)
    )
    // Ranked: T400 T300 D50 T50 D2 D1.5 D1.2 T1 → raw q (d+1)/(t+1): 1/2, 1/3, 2/3, 2/4, 3/4, 4/4, 5/4, 5/5
    expect(q[0]).toBeCloseTo(1 / 3, 10) // monotone: the min of everything below
    expect(q[1]).toBeCloseTo(1 / 3, 10)
    expect(q[2]).toBeCloseTo(1 / 2, 10) // the decoy tied at 50 ranks first
    expect(q[3]).toBeCloseTo(1, 10)
  })

  it('gives planted curves small q and estimates the calls’ FDR honestly', () => {
    // 300 genes × 2 drugs on 8 doses, one control: drug A moves the first 40 genes.
    let seed = 99
    const z = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const u = (seed + 1) / 2147483649
      seed = (seed * 1103515245 + 12345) % 2147483648
      return Math.sqrt(-2 * Math.log(u)) * Math.cos((2 * Math.PI * (seed + 1)) / 2147483649)
    }
    const doses = [1, 3, 10, 30, 100, 300, 1000, 3000]
    const rows: StandardRow[] = []
    const add = (uniqID: string, cmpd: string, dose: number, value: number): void => {
      rows.push({ uniqID, cmpd, dose, time: null, value } as unknown as StandardRow)
    }
    for (let g = 0; g < 300; g++) {
      add(`g${g}`, 'DMSO', 0, 100 * (1 + 0.08 * z()))
      for (const cmpd of ['A', 'B'])
        for (const d of doses) {
          const effect =
            cmpd === 'A' && g < 40
              ? logistic(Math.log10(d), { pec50: -1.5, slope: 1.5, front: 1, back: 0.2 })
              : 1
          add(`g${g}`, cmpd, d, 100 * effect * (1 + 0.08 * z()))
        }
    }
    const res = runCurveFit({
      rows,
      num: { cmpd: ['A', 'B'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose'],
      curveAxis: 'dose',
      threshold: t()
    })
    expect(Object.keys(res.decoys ?? {})).toHaveLength(2) // one decoy set per drug
    const A = res.rows.filter((r) => r.cmpd === 'A')
    const planted = A.filter((r) => Number(r.uniqID.slice(1)) < 40)
    expect(planted.filter((r) => (r.curve?.q ?? 1) < 0.05).length).toBeGreaterThanOrEqual(36)
    const called = res.rows.filter((r) => r.signf)
    const falseCalls = called.filter((r) => r.cmpd === 'B' || Number(r.uniqID.slice(1)) >= 40)
    expect(res.curveFdr).toBeGreaterThan(0)
    expect(res.curveFdr).toBeLessThan(0.3)
    // The estimate is in the right range of what actually happened (a loose check: few calls).
    expect(Math.abs(falseCalls.length / called.length - res.curveFdr!)).toBeLessThan(0.15)

    // Called by a target FDR instead: every call within it, and the reported FDR too.
    const byFdr = t({ ccCallBy: 'fdr', ccQMin: -Math.log10(0.05) })
    const fdrRun = applyCurveFdr(res.rows, res.decoys, byFdr)
    const fdrCalls = fdrRun.rows.filter((r) => classifyCompareRow(r, byFdr).signf)
    expect(fdrCalls.length).toBeGreaterThan(30)
    for (const r of fdrCalls) expect(r.curve!.q!).toBeLessThanOrEqual(0.05)
    expect(fdrRun.fdr!).toBeLessThanOrEqual(0.05)
    // …and its α settles where the score's hyperbola walls off at the fold-change limit, through
    // the lowest call.
    const aA = fdrRun.alphas![curveGroupKey(fdrCalls[0])]
    expect(aA).toBeGreaterThan(0)
    const lowest = Math.min(
      ...fdrCalls
        .filter((r) => r.cmpd === 'A')
        .map((r) => relevanceScore(r.log2FC!, r.curve!.f, r.curve!.n, 0.45, aA))
    )
    expect(lowest).toBeCloseTo(-Math.log10(aA), 3)
    expect(curveCuratorBoundary(0.44, 9, 0.45, aA)).toBe(Infinity)
    expect(Number.isFinite(curveCuratorBoundary(0.6, 9, 0.45, aA))).toBe(true)

    // Re-thresholding re-derives q and the FDR from the kept decoys, without re-fitting.
    const strict = applyCurveFdr(
      res.rows.map((r) => ({ ...r, ...classifyCompareRow(r, t({ fcHigh: 1, fcLow: -1 })) })),
      res.decoys,
      t({ fcHigh: 1, fcLow: -1 })
    )
    expect(strict.fdr).toBeDefined()
    expect(strict.rows.some((r, i) => r.curve?.q !== res.rows[i].curve?.q)).toBe(true)
  })
})

describe('curveSampleX', () => {
  const f = (lx: number, p: Parameters<typeof logistic>[1]): number => Math.log2(logistic(lx, p))
  /** the largest gap between the curve and its drawn polyline, checked finely */
  const worstChordError = (xs: number[], p: Parameters<typeof logistic>[1]): number => {
    let worst = 0
    for (let i = 1; i < xs.length; i++)
      for (let k = 1; k < 10; k++) {
        const t = k / 10
        const lx = xs[i - 1] + (xs[i] - xs[i - 1]) * t
        const chord = f(xs[i - 1], p) * (1 - t) + f(xs[i], p) * t
        worst = Math.max(worst, Math.abs(f(lx, p) - chord))
      }
    return worst
  }

  it('adds points at a steep turn — even one centred between two even samples', () => {
    // 25 even samples over [−9, −5] are 1/6 decade apart; centre the turn on a gap's midpoint.
    const p = { pec50: 7 - 1 / 12, slope: 20, front: 1, back: 0.1, xMin: -9, xMax: -5 }
    const xs = curveSampleX(p, 25)
    expect(xs.length).toBeGreaterThan(25)
    expect(xs[0]).toBe(-9)
    expect(xs[xs.length - 1]).toBe(-5)
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true)
    expect(worstChordError(xs, p)).toBeLessThan(0.05)
  })

  it('keeps a flat curve at its even samples', () => {
    const p = { pec50: 7, slope: 1, front: 1, back: 1, xMin: -9, xMax: -5 }
    expect(curveSampleX(p, 25)).toHaveLength(25)
  })
})

describe('curveResidualPoints', () => {
  it('gives each residual its fitted value and the curve-standardised residual', () => {
    const p = { pec50: 7, slope: 1, front: 1, back: 0.5 }
    const x = [-9, -8, -7, -6, -5, -9, -8]
    const noise = [0.02, -0.01, 0.03, -0.02, 0.01, -0.03, 0.02]
    const y = x.map((lx, i) => logistic(lx, p) + noise[i])
    const pts = curveResidualPoints([{ ...p, x, y, cy: [1.01, 0.99], id: 'g' }])
    expect(pts).toHaveLength(9)
    // the control samples sit against the front plateau
    expect(pts[0]).toMatchObject({ x: null, fitted: 1, id: 'g' })
    expect(pts[0].residual).toBeCloseTo(0.01)
    // a treated point: fitted on the curve, residual = the noise
    expect(pts[2].fitted).toBeCloseTo(logistic(-9, p))
    expect(pts[2].residual).toBeCloseTo(0.02)
    // standardised over √(SS / (n − 4)) of the 7 dosed points
    const dosed = pts.filter((q) => q.x != null)
    const sd = Math.sqrt(dosed.reduce((s, q) => s + q.residual ** 2, 0) / (7 - 4))
    expect(pts[2].std).toBeCloseTo(0.02 / sd)
  })

  it('leaves out a curve of four dosed points (an exact fit, residuals all 0)', () => {
    const p = { pec50: 7, slope: 1, front: 1, back: 0.5 }
    const x = [-9, -8, -7, -6]
    expect(curveResidualPoints([{ ...p, x, y: x.map((lx) => logistic(lx, p)) }])).toHaveLength(0)
  })
})

describe('normalPpf', () => {
  it('inverts the standard normal', () => {
    expect(normalPpf(0.5)).toBeCloseTo(0, 6)
    expect(normalPpf(0.975)).toBeCloseTo(1.959964, 5)
    expect(normalPpf(0.025)).toBeCloseTo(-1.959964, 5)
    expect(normalPpf(0)).toBe(-Infinity)
    expect(Number.isNaN(normalPpf(1.5))).toBe(true)
  })
})

describe('CurveCurator interpolation', () => {
  it('builds the grid: one midpoint in every gap, whatever its width', () => {
    const doses = [3, 10, 30, 100, 300, 1000, 3000, 30000].map((d) => Math.log10(d * 1e-9))
    const g = interpolationGrid(doses)
    expect(g).toHaveLength(15)
    // the 3 → 30 µM decade gets one point, as every half-log gap does
    expect(g[g.length - 2]).toBeCloseTo((doses[6] + doses[7]) / 2)
  })
  it('tests on the real points only, whatever the grid', () => {
    const x = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4]
    const y = [1, 0.98, 0.9, 0.7, 0.4, 0.25, 0.2, 0.18]
    const plain = fitCurve(x, y)!
    const interp = fitCurve(x, y, interpolationGrid(x))!
    expect(interp.n).toBe(plain.n)
    expect(interp.f).toBeGreaterThan(0)
    expect(Math.abs(interp.pec50 - plain.pec50)).toBeLessThan(0.3)
  })
})

describe('lack-of-fit test', () => {
  const p: LogisticParams = { pec50: 7, slope: 1, front: 1, back: 0.4 }
  const doses = [-9, -8.5, -8, -7.5, -7, -6.5, -6, -5.5]
  // Three replicates at each dose, spread ±0.02 about `at(x)`.
  const reps = (at: (x: number) => number): { x: number[]; y: number[] } => {
    const x: number[] = []
    const y: number[] = []
    for (const d of doses)
      for (const e of [-0.02, 0, 0.02]) {
        x.push(d)
        y.push(at(d) + e)
      }
    return { x, y }
  }

  it('splits the residual into pure error and lack of fit, against F(c − 4, n − c)', () => {
    // Dose means off the curve by a known amount: SS_lof and SS_pe by hand.
    const off = [0.05, -0.05, 0.05, -0.05, 0.05, -0.05, 0.05, -0.05]
    const { x, y } = reps((d) => logistic(d, p) + off[doses.indexOf(d)])
    const lof = curveLackOfFit(x, y, p)!
    const ssPe = doses.length * 2 * 0.02 ** 2
    const ssLof = 3 * off.reduce((s, o) => s + o * o, 0)
    // 8 doses + the control = 9 groups; 24 points + the control = 25.
    expect(lof.f).toBeCloseTo(ssLof / (9 - 4) / (ssPe / (25 - 9)), 6)
    expect(lof.p).toBeCloseTo(fSurvival(lof.f, 5, 16), 10)
  })

  it('passes a curve the 4PL describes, and flags one it can’t', () => {
    const fits = reps((d) => logistic(d, p))
    const fitted = fitCurve(fits.x, fits.y)!
    expect(fitted.lofP).toBeGreaterThan(0.05)
    // A bump at the middle doses: no 4PL follows it.
    const bump = reps((d) => (d === -7.5 || d === -7 ? 0.6 : 1))
    const bumped = fitCurve(bump.x, bump.y)!
    expect(bumped.lofP).toBeLessThan(0.001)
  })

  it('has no test without replicates, or with 4 or fewer doses', () => {
    expect(
      curveLackOfFit(
        doses,
        doses.map((d) => logistic(d, p)),
        p
      )
    ).toBeUndefined()
    const few = reps((d) => logistic(d, p))
    const keep = few.x.map((d) => d <= -8)
    const x = few.x.filter((_, i) => keep[i])
    const y = few.y.filter((_, i) => keep[i])
    // 3 doses + the control = 4 groups: no degrees of freedom left for lack of fit.
    expect(curveLackOfFit(x, y, p)).toBeUndefined()
  })

  it('is given to older fits from their kept points', () => {
    const { x, y } = reps((d) => logistic(d, p))
    const fit = fitCurve(x, y)!
    const { lofF, lofP, ...older } = fit
    const m = curveMetrics(fit.log2FC, { ...older, x, y }, undefined)
    expect(m.F_lof).toBeCloseTo(lofF!, 9)
    expect(m.pP_lof).toBeCloseTo(-Math.log10(lofP!), 9)
  })
})
