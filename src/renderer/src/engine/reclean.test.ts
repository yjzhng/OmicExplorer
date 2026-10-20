import { describe, expect, it } from 'vitest'

import { canConnect } from '../graph/registry'
import { recleanStandardized } from './ingest'
import type { StandardizeResult, StandardRow } from './types'

/** A Clean data result: genes g0…g9 in 4 samples (reps 1–4, cmpd A), sample 2 loaded 2×; g9
 *  measured in one sample only. */
function cleanResult(): StandardizeResult {
  const rows: StandardRow[] = []
  for (let g = 0; g < 10; g++)
    for (const rep of [1, 2, 3, 4])
      rows.push({
        uniqID: `g${g}`,
        cell: '',
        cmpd: 'A',
        dose: null,
        time: null,
        rep,
        value: g === 9 && rep > 1 ? null : 100 * (g + 1) * (rep === 2 ? 2 : 1)
      })
  const names = Object.fromEntries(Array.from({ length: 10 }, (_, g) => [`g${g}`, `G${g}`]))
  return {
    rows,
    displayMap: names,
    annotationMap: { g0: { GO: 'x' }, g9: { GO: 'y' } },
    keggCategories: {},
    activeConditions: ['cmpd'],
    compounds: ['A'],
    cleanup: { droppedGenes: 0, sampleCount: 4, minSamplePct: 0 },
    normalization: {
      reference: 'all',
      used: 'all',
      sharedGenes: 9,
      samples: 4,
      maxFold: 1
    },
    scale: 'log10',
    inputScale: 'linear'
  } as unknown as StandardizeResult
}

describe('Clean data on Clean data', () => {
  it('may follow another Clean data', () => {
    expect(canConnect('standardize', 'standardize')).toBe(true)
  })

  it('runs its own clean-up, normalisation and imputation on the table it is given', () => {
    const prev = cleanResult()
    const out = recleanStandardized({
      std: prev,
      minSamplePct: 50,
      normalize: { reference: 'protein', protein: 'g0' }
    })
    // clean-up: g9 (1 of 4 samples) goes — from the rows and the name / annotation maps
    expect(out.cleanup).toMatchObject({ droppedGenes: 1, sampleCount: 4, minSamplePct: 50 })
    expect(out.rows.some((r) => r.uniqID === 'g9')).toBe(false)
    expect(out.displayMap.g9).toBeUndefined()
    expect(out.annotationMap).toEqual({ g0: { GO: 'x' } })
    // normalisation on g0: sample 2's 2× loading removed
    const g1 = out.rows.filter((r) => r.uniqID === 'g1').map((r) => r.value!)
    expect(g1[1]).toBeCloseTo(g1[0], 6)
    expect(out.normalization).toMatchObject({ used: 'protein', protein: 'g0', samples: 4 })
    // the import's settlement carries over; the summaries are this step's
    expect(out.activeConditions).toEqual(['cmpd'])
    expect(out.inputScale).toBe('linear')
    expect(out.imputation).toBeUndefined()
    // the input itself is untouched
    expect(prev.rows.some((r) => r.uniqID === 'g9')).toBe(true)
  })

  it('without normalisation, drops the input’s normalisation summary', () => {
    const out = recleanStandardized({ std: cleanResult() })
    expect(out.normalization).toBeUndefined()
    expect(out.cleanup.droppedGenes).toBe(0)
    expect(out.rows).toHaveLength(40)
  })
})
