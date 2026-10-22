/**
 * buildFcHeatmapSteps: buildFcHeatmap with its clusterings handed out (the dashboard answers them
 * from the UI worker lane). Answered with clusterRowTree — on rows passed the way the worker gets
 * them (one flat Float64Array, each row a view onto it) and the result through the wire format —
 * it must give exactly buildFcHeatmap's heatmap.
 */
import { describe, expect, it } from 'vitest'

import { clusterRowTree, type ClusterOrderOptions } from './cluster'
import { buildFcHeatmap, buildFcHeatmapSteps, type FcHeatmapOptions } from './plotData'
import type { CompareResultRow } from './types'
import { decodeValue, encodeValue } from './wire'

function row(
  uniqID: string,
  comparison: string,
  dose: number,
  log2FC: number | null,
  signf: boolean
): CompareResultRow {
  return {
    uniqID,
    cmpd: comparison.split(' | ')[0],
    dose,
    time: null,
    cmp_cond: 'cmpd',
    comparison,
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC,
    pP: null,
    pQ: null,
    thrsh: '',
    signf,
    effect: 'none'
  }
}

/** 90 genes × 3 compounds × 3 doses: repeated profiles (ties), a few missing cells, an outlier. */
function synthetic(): CompareResultRow[] {
  const out: CompareResultRow[] = []
  const cmpds = ['drugA | DMSO', 'drugB | DMSO', 'drugC | DMSO']
  for (let g = 0; g < 90; g++)
    for (let c = 0; c < cmpds.length; c++)
      for (const dose of [1, 10, 100]) {
        const k = g % 7 // seven repeated profiles → exact ties
        let v: number | null = ((k - 3) * (c + 1) * Math.log10(dose * 10)) / 4
        if ((g * 31 + c * 7 + dose) % 23 === 0) v = null
        if (g === 5 && c === 1 && dose === 100) v = 40
        out.push(row(`g${g}`, cmpds[c], dose, v, Math.abs(v ?? 0) > 1))
      }
  return out
}

/** The worker's way: rows as views onto one flat buffer, the tree back through the wire. */
function viaWorker(m: number[][], opts: ClusterOrderOptions): ReturnType<typeof clusterRowTree> {
  const w = m[0]?.length ?? 0
  const flat = structuredClone(new Float64Array(m.flatMap((r) => r)))
  const rows: Float64Array[] = []
  for (let i = 0; i + w <= flat.length && w > 0; i += w) rows.push(flat.subarray(i, i + w))
  const transfer: Transferable[] = []
  const res = clusterRowTree(rows as unknown as number[][], structuredClone(opts))
  return decodeValue(structuredClone(encodeValue(res, transfer))) as ReturnType<
    typeof clusterRowTree
  >
}

describe('buildFcHeatmapSteps', () => {
  const rows = synthetic()
  const cases: FcHeatmapOptions[] = [
    { differentialOnly: true },
    { differentialOnly: true, maxGenes: 40, linkage: 'complete', leafOrder: 'optimal' },
    { focus: ['g3', 'g10', 'g17', 'g4', 'g99', 'g5'], leafOrder: 'optimal' },
    { displayMap: { g1: 'One' } }
  ]
  for (const opts of cases)
    it(`answered off-thread equals buildFcHeatmap (${JSON.stringify(opts)})`, () => {
      const want = buildFcHeatmap(rows, opts)
      const gen = buildFcHeatmapSteps(rows, opts)
      let jobs = 0
      let r = gen.next()
      while (!r.done) {
        jobs++
        r = gen.next(viaWorker(r.value.rows, r.value.opts))
      }
      expect(jobs).toBe(2) // the columns, then the genes
      expect(r.value).toStrictEqual(want)
      expect(JSON.stringify(r.value)).toBe(JSON.stringify(want))
      expect(want.rowTree?.length).toBeGreaterThan(0)
      expect(want.colTree?.length).toBeGreaterThan(0)
    })
})
