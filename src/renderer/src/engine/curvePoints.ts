/**
 * A curve fit's measured points, rebuilt from the Clean data it ran on — for results whose rows
 * don't carry them (fitted before they were kept). The same ratios the fit was made on: every
 * numerator sample of the gene above dose 0 (carrying the row's compared value and context), each
 * over the mean of its control samples — those at the comparison's reference value(s) (the label
 * after "|"), matched on the same context — and the control samples' own ratios.
 */
import { condValue } from './compare'
import type { CompareResultRow, StandardRow } from './types'

type Preset = 'cell' | 'cmpd' | 'dose' | 'time'

export interface CurvePoints {
  /** log₁₀ dose of each treated point, its ratio to the control mean, and its replicate */
  x: number[]
  y: number[]
  rep: Array<number | null>
  /** the control samples' ratios to their mean, and their replicates */
  cy: number[]
  crep: Array<number | null>
}

/** One curve row's points from its gene's Clean data rows (`geneStd`); null when its control
 *  can't be found there. */
export function curvePointsFromStd(
  r: CompareResultRow,
  geneStd: StandardRow[],
  axis: 'dose' | 'time'
): CurvePoints | null {
  if (!geneStd.length) return null
  const dims = r.cmp_cond.split(':') as Preset[]
  const den = (r.comparison.split(' | ')[1] ?? '').split(' · ')
  if (den.length !== dims.length) return null
  // Context the row carries beyond the compared conditions and the curve's own axis.
  const context = (['cell', 'cmpd', 'dose', 'time'] as const).filter(
    (c) => c !== axis && !dims.includes(c) && r[c] != null && r[c] !== ''
  )
  const inContext = (s: StandardRow): boolean =>
    context.every((c) => String(condValue(s, c) ?? '') === String(r[c])) &&
    Object.entries(r.extra ?? {}).every(([k, v]) => v === '' || s.extra?.[k] === v)
  const ctrl = geneStd.filter(
    (s) =>
      s.value != null &&
      s.value > 0 &&
      dims.every((c, i) => String(condValue(s, c) ?? '') === den[i]) &&
      inContext(s)
  )
  if (!ctrl.length) return null
  const base = ctrl.reduce((a, s) => a + (s.value as number), 0) / ctrl.length
  const out: CurvePoints = {
    x: [],
    y: [],
    rep: [],
    cy: ctrl.map((s) => (s.value as number) / base),
    crep: ctrl.map((s) => s.rep ?? null)
  }
  for (const s of geneStd) {
    const dose = Number(condValue(s, axis))
    if (
      s.value == null ||
      !(dose > 0) ||
      !dims.every((c) => c === axis || String(condValue(s, c) ?? '') === String(r[c] ?? '')) ||
      !inContext(s)
    )
      continue
    out.x.push(Math.log10(dose))
    out.y.push(s.value / base)
    out.rep.push(s.rep ?? null)
  }
  return out
}

/** Clean data rows grouped by gene, for looking many genes up. */
export function stdByGene(std: StandardRow[]): Map<string, StandardRow[]> {
  const by = new Map<string, StandardRow[]>()
  for (const s of std) {
    let list = by.get(s.uniqID)
    if (!list) by.set(s.uniqID, (list = []))
    list.push(s)
  }
  return by
}

/** Whether a Clean data row is one of the numerator samples behind a comparison row: it carries
 *  every condition value the comparison row does (its compared value, level and context). */
function sameSample(s: StandardRow, r: CompareResultRow): boolean {
  for (const c of ['cell', 'cmpd', 'dose', 'time'] as const) {
    const want = r[c]
    if (want == null || want === '') continue
    if (String(condValue(s, c) ?? '') !== String(want)) return false
  }
  for (const [k, v] of Object.entries(r.extra ?? {}))
    if (v !== '' && s.extra?.[k] !== v) return false
  return true
}

/** A t-test row's replicates: the numerator's samples at its level (every condition the row
 *  carries), each over the control's mean — log₂, on its fold change's scale. Empty without a
 *  control mean (a curve fit's row, or no data). */
export function replicateLog2FCs(r: CompareResultRow, geneStd: StandardRow[]): number[] {
  if (!(r.mean2 != null && r.mean2 > 0)) return []
  const base = Math.log2(r.mean2)
  const out: number[] = []
  for (const s of geneStd)
    if (s.value != null && s.value > 0 && sameSample(s, r)) out.push(Math.log2(s.value) - base)
  return out
}
