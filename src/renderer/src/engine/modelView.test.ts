import { describe, expect, it } from 'vitest'

import { attachLazyRows, holderTable } from './lazyRows'
import { descPeakOf, hasResponseFits, withModelView } from './modelView'
import { RESPONSE_THRESHOLD, runResponseSurface } from './responseSurface'
import { rng } from './sam'
import { descValue } from './splineFit'
import { jointPredict } from './surfaceJoint'
import type { CompareResultRow, StandardRow } from './types'
import { encodeTable } from './wire'

const DOSES = [1, 3, 10, 30, 100, 300, 1000, 3000]
const normal = (r: () => number): number =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const row = (
  uniqID: string,
  cmpd: string,
  dose: number,
  time: number | null,
  rep: number,
  log2: number
): StandardRow => ({ uniqID, cell: '', cmpd, dose, time, rep, value: 2 ** log2 }) as StandardRow
const signedMax = (vs: number[]): number =>
  vs.reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0)

// 80 genes: the first 10 respond to A (a sigmoid rising by 1.5 log₂ around dose 30), the rest flat.
const r = rng(3)
const rows: StandardRow[] = []
for (let g = 0; g < 80; g++) {
  const a = 20 + 3 * r()
  for (let rep = 1; rep <= 3; rep++) {
    rows.push(row(`g${g}`, 'DMSO', 0, null, rep, a + 0.2 * normal(r)))
    for (const d of DOSES)
      rows.push(
        row(
          `g${g}`,
          'A',
          d,
          null,
          rep,
          a + (g < 10 ? 1.5 / (1 + (30 / d) ** 1.5) : 0) + 0.2 * normal(r)
        )
      )
  }
}
const oneAxis = runResponseSurface({
  rows,
  num: { cmpd: ['A'] },
  den: { cmpd: ['DMSO'] },
  match: [],
  activeConditions: ['cmpd', 'dose'],
  numericConditions: [],
  curveAxis: 'dose',
  threshold: RESPONSE_THRESHOLD
})
const result = (cmp: { rows: CompareResultRow[] }) => ({ kind: 'compare' as const, cmp })
/** the result as it was before descPeak was kept */
const older = (rs: CompareResultRow[]): CompareResultRow[] =>
  rs.map((x) => {
    if (!x.rs) return x
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { descPeak, ...rest } = x.rs
    return { ...x, rs: rest }
  })

describe('the descriptor’s peak', () => {
  it('is the description’s largest departure at the tested levels, kept with the fit', () => {
    const described = oneAxis.rows.filter((x) => x.rs?.desc)
    expect(described.length).toBeGreaterThan(0)
    for (const x of described) {
      const rs = x.rs!
      const want = signedMax(rs.x!.slice(1).map((v) => descValue(rs.desc!, v)))
      expect(rs.descPeak).toBeCloseTo(want, 12)
      expect(descPeakOf(rs)).toBeCloseTo(want, 12)
    }
    // an undescribed curve has none
    for (const x of oneAxis.rows.filter((x) => !x.rs?.desc)) expect(x.rs?.descPeak).toBeUndefined()
    // the responders: about the spline's peak (both +1.5 or so)
    for (const x of described.filter((x) => Number(x.uniqID.slice(1)) < 10))
      expect(Math.abs(x.rs!.descPeak! - x.log2FC!)).toBeLessThan(0.4)
  })

  it('on a surface, is its description’s largest departure over the treated cells', () => {
    const TIMES = [30, 120, 480, 1440]
    const rr = rng(5)
    const srows: StandardRow[] = []
    for (let g = 0; g < 16; g++) {
      const a = 20 + 3 * rr()
      for (let rep = 1; rep <= 3; rep++)
        for (const t of TIMES) {
          srows.push(row(`g${g}`, 'DMSO', 0, t, rep, a + 0.15 * normal(rr)))
          for (const d of [1, 10, 100, 1000, 3000]) {
            const eff = g < 4 ? (1.5 * (t / 1440)) / (1 + (30 / d) ** 1.5) : 0
            srows.push(row(`g${g}`, 'A', d, t, rep, a + eff + 0.15 * normal(rr)))
          }
        }
    }
    const res = runResponseSurface({
      rows: srows,
      num: { cmpd: ['A'], dose: ['1', '10', '100', '1000', '3000'] },
      den: { cmpd: ['DMSO'] },
      match: [],
      activeConditions: ['cmpd', 'dose', 'time'],
      numericConditions: [],
      curveAxis: 'surface',
      surfaceDescription: 'joint',
      describeAll: true,
      threshold: RESPONSE_THRESHOLD
    })
    // its joint model at each treated cell (jointPredict: the model's own reader, on the levels)
    for (const x of res.rows) {
      const rs = x.rs!
      const d = rs.surface!
      expect(d.joint).toBeDefined()
      const at = rs.cells!.map((c) =>
        jointPredict(d.joint!, d.jointUbar!, c.dose, c.time, rs.timeOffset!)
      )
      expect(rs.descPeak).toBeCloseTo(signedMax(at), 8)
    }
  })
})

describe('withModelView', () => {
  it('leaves the detector, and a result without response fits, as they are', () => {
    const res = result(oneAxis)
    expect(withModelView(res, 'detector')).toBe(res)
    const plain = result({ rows: [{ uniqID: 'g', log2FC: 1 } as CompareResultRow] })
    expect(hasResponseFits(plain.cmp)).toBe(false)
    expect(withModelView(plain, 'descriptor')).toBe(plain)
  })

  it('swaps in the descriptor’s peak, NA where undescribed — one copy per result', () => {
    const res = result(oneAxis)
    const d = withModelView(res, 'descriptor')
    expect(withModelView(res, 'descriptor')).toBe(d)
    d.cmp.rows.forEach((x, i) => {
      const src = oneAxis.rows[i]
      expect(x.log2FC).toBe(src.rs?.descPeak ?? null)
      // the call stays the detector's
      expect(x.pP).toBe(src.pP)
      expect(x.signf).toBe(src.signf)
    })
  })

  it('reads a columnar result off its columns, and computes the peak for one fitted before it was kept', () => {
    for (const src of [oneAxis.rows, older(oneAxis.rows)]) {
      const holder = { rows: [] as CompareResultRow[] }
      attachLazyRows(holder, encodeTable(src as never[], []))
      const d = withModelView(result(holder), 'descriptor')
      // still lazy, one column swapped
      expect(holderTable(d.cmp)).toBeDefined()
      d.cmp.rows.forEach((x, i) => {
        const want = oneAxis.rows[i].rs?.descPeak
        if (want == null) expect(x.log2FC).toBeNull()
        else expect(x.log2FC).toBeCloseTo(want, 12)
      })
    }
    // a plain-array result fitted before descPeak was kept
    const d = withModelView(result({ rows: older(oneAxis.rows) }), 'descriptor')
    d.cmp.rows.forEach((x, i) => {
      const want = oneAxis.rows[i].rs?.descPeak
      if (want == null) expect(x.log2FC).toBeNull()
      else expect(x.log2FC).toBeCloseTo(want, 12)
    })
  })
})
