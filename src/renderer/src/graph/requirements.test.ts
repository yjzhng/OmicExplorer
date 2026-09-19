import { describe, expect, it } from 'vitest'

import { NODE_SPECS, plotEntriesFor } from './registry'
import { gatePlotEntries, UNWIRED, unmetRequirement, type UpstreamFacts } from './requirements'
import type { NodeResult } from './types'

const cmpResult = (ann: Record<string, Record<string, string>> = {}): NodeResult =>
  ({
    kind: 'compare',
    cmp: { rows: [], comparisons: [] },
    displayMap: {},
    annotationMap: ann
  }) as NodeResult

const facts = (over: Partial<UpstreamFacts>): UpstreamFacts => ({ ...UNWIRED, ...over })

describe('tile requirements', () => {
  it('unwired upstream rules nothing out', () => {
    for (const k of ['dr', 'tdr', 'bubble', 'enrich', 'string'] as const)
      expect(unmetRequirement(k, NODE_SPECS[k].defaultConfig(), UNWIRED)).toBeNull()
  })

  it('response plots need their axis; tdr needs both; bubble needs either', () => {
    const doseOnly = facts({ kind: 'compare', axes: { dose: true, time: false } })
    expect(unmetRequirement('dr', { axis: 'dose' }, doseOnly)).toBeNull()
    expect(unmetRequirement('dr', { axis: 'time' }, doseOnly)).toMatch(/time condition/)
    expect(unmetRequirement('tdr', {}, doseOnly)).toMatch(/both dose and time/)
    expect(unmetRequirement('bubble', { axis: 'time' }, doseOnly)).toBeNull()
    const none = facts({ kind: 'compare', axes: { dose: false, time: false } })
    expect(unmetRequirement('bubble', {}, none)).toMatch(/dose or time/)
  })

  it('kind mismatch is reported before data requirements', () => {
    expect(unmetRequirement('pca', {}, facts({ kind: 'compare', result: cmpResult() }))).toMatch(
      /Needs a Clean data upstream/
    )
  })

  it('annotation-based requirements are unknown (satisfied) until a result exists', () => {
    expect(unmetRequirement('enrich', { source: 'go' }, facts({ kind: 'compare' }))).toBeNull()
    expect(unmetRequirement('string', {}, facts({ kind: 'compare' }))).toBeNull()
    const noAnn = facts({ kind: 'compare', result: cmpResult({}) })
    expect(unmetRequirement('enrich', { source: 'go' }, noAnn)).toMatch(/No GO annotations/)
    expect(unmetRequirement('string', {}, noAnn)).toMatch(/No species/)
    // a manual species override satisfies STRING without annotations
    expect(unmetRequirement('string', { species: 9606 }, noAnn)).toBeNull()
    const withTaxon = facts({ kind: 'compare', result: cmpResult({ g1: { taxon: '9606' } }) })
    expect(unmetRequirement('string', {}, withTaxon)).toBeNull()
  })

  it('gatePlotEntries drops entries the upstream cannot back (dr fans out by axis)', () => {
    const entries = [
      ...plotEntriesFor('dr'),
      ...plotEntriesFor('tdr'),
      ...plotEntriesFor('volcano')
    ]
    const timeOnly = facts({ kind: 'compare', axes: { dose: false, time: true } })
    expect(gatePlotEntries(entries, timeOnly).map((e) => e.label)).toEqual([
      'Time-response',
      'Volcano'
    ])
    expect(gatePlotEntries(entries, UNWIRED)).toHaveLength(4)
  })
})
