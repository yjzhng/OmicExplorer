import { describe, expect, it } from 'vitest'
import { dominantTaxon, stringTaxon } from './requirements'

describe('stringTaxon', () => {
  it("is the organism STRING's ids carry, not UniProt's taxon (E. coli K-12: 83333 → 511145)", () => {
    const ann = {
      P00350: { taxon: '83333', stringId: '511145.b2029' },
      P0A6F5: { taxon: '83333', stringId: '511145.b4143' },
      Q00001: { taxon: '83333' }
    }
    expect(dominantTaxon(ann)).toBe(83333)
    expect(stringTaxon(ann)).toBe(511145)
  })

  it('falls back to the annotations’ taxon without STRING ids', () => {
    expect(stringTaxon({ P1: { taxon: '9606' } })).toBe(9606)
    expect(stringTaxon({})).toBe(0)
  })
})
