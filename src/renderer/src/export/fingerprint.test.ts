/** The temp export's content fingerprint: stable across reopening, sensitive to the numbers. */
import { describe, expect, it } from 'vitest'

import { fingerprintOf } from './fingerprint'

const result = (signf: boolean) =>
  ({
    kind: 'compare',
    cmp: {
      rows: [
        {
          uniqID: 'g1',
          cmpd: 'X',
          dose: 1,
          time: null,
          comparison: 'X | DMSO',
          mean1: 2,
          mean2: 1,
          sd1: 0.1,
          sd2: 0.1,
          log2FC: 1,
          pP: 0.01,
          pQ: 0.02,
          thrsh: '',
          signf,
          effect: signf ? 'up' : 'none'
        }
      ],
      comparisons: ['X | DMSO']
    },
    annotationMap: { g1: { KEGG: 'Cell cycle' } },
    displayMap: { g1: 'G1' },
    keggCategories: {}
  }) as unknown as Parameters<typeof fingerprintOf>[0]

describe('fingerprintOf', () => {
  it('is the same for equal content in different objects (a reopened project)', () => {
    expect(fingerprintOf(result(true))).toBe(fingerprintOf(result(true)))
  })

  it('changes when a significance call does (a dragged threshold)', () => {
    expect(fingerprintOf(result(true))).not.toBe(fingerprintOf(result(false)))
  })
})
