/** A protein's description, for the gene and reference-protein pickers to list and search. */
import { describe, expect, it } from 'vitest'

import { proteinDescOf, proteinDescs } from './proteinDesc'

describe('proteinDescOf', () => {
  it("takes the import's proteinName, else a column named like a description", () => {
    expect(proteinDescOf({ proteinName: 'Histone deacetylase 1', product: 'x' })).toBe(
      'Histone deacetylase 1'
    )
    expect(proteinDescOf({ GO: 'a;b', Product: 'DNA gyrase subunit A' })).toBe(
      'DNA gyrase subunit A'
    )
    expect(proteinDescOf({ GO: 'a;b' })).toBeUndefined()
    expect(proteinDescOf(undefined)).toBeUndefined()
  })
  it('maps every protein that has one', () => {
    expect(proteinDescs({ P1: { protein_name: 'Kinase' }, P2: { GO: 'x' } })).toEqual({
      P1: 'Kinase'
    })
  })
})
