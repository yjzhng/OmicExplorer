import { describe, expect, it } from 'vitest'
import { contrastSelect, type ContrastSelectInput } from './contrastSelect'
import type { CompareResultRow } from './types'
import { decodeValue, encodeTable, encodeValue } from './wire'

/** A request as the worker gets it: encoded by the client, decoded before the op runs. */
const roundTrip = <T>(payload: T): T => decodeValue(structuredClone(encodeValue(payload, []))) as T

let s = 3
const rnd = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
const rows: CompareResultRow[] = Array.from({ length: 1200 }, (_, i) => {
  const fc = (rnd() - 0.5) * 4
  return {
    uniqID: `g${i % 400}`,
    cell: 'c',
    cmpd: ['A', 'B', 'C'][Math.floor(i / 400)],
    dose: null,
    time: 60,
    cmp_cond: 'cmpd',
    comparison: 'x | ctl',
    mean1: null,
    mean2: null,
    sd1: null,
    sd2: null,
    log2FC: fc,
    fcSE: 0.2,
    pP: rnd() * 4,
    pQ: rnd() * 3,
    thrsh: '',
    signf: Math.abs(fc) > 1,
    effect: fc > 1 ? 'up' : fc < -1 ? 'down' : 'none'
  }
})
const input = (r: ContrastSelectInput['compares'][number]['rows']): ContrastSelectInput => ({
  stds: [],
  compares: [{ rows: r }],
  num: { cmpd: ['A'] },
  den: { cmpd: ['B'] },
  features: [
    { id: 'value', label: 'log₂FC' },
    { id: 'p', label: '−log₁₀ q' }
  ],
  tagOne: false,
  selCtx: { statType: 'pQ', doseScale: 1 },
  cutoffs: {},
  match: ['cell', 'time'],
  pair: { relationship: 'correlated' }
})

describe('contrastSelect', () => {
  it("a Compare's table, sent as the client sends it, contrasts as its rows do", () => {
    const direct = contrastSelect(input(rows))
    const sent = contrastSelect(roundTrip(input(encodeTable(rows, []))))
    expect('error' in direct).toBe(false)
    expect(sent).toEqual(direct)
  })
  it('stacks every feature, each row tagged', () => {
    const got = contrastSelect(input(rows))
    if ('error' in got) throw new Error(got.error)
    expect(new Set(got.rows.map((r) => r.featureId))).toEqual(new Set(['value', 'p']))
  })
  it('says when a side matches nothing', () => {
    expect(contrastSelect({ ...input(rows), den: { cmpd: ['Z'] } })).toEqual({
      error: 'One contrast side matched no rows — adjust the FC1/FC2 selections.'
    })
  })
})
