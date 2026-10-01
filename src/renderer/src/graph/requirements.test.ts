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

  it('enrichment is met by any term set the genes carry, not only the saved one', () => {
    // GO (the default) never fetched, KEGG was: the plot falls back to KEGG, so it isn't blocked.
    const keggOnly = facts({
      kind: 'compare',
      result: cmpResult({ g1: { KEGG: 'Cell cycle' } })
    })
    expect(unmetRequirement('enrich', { source: 'go' }, keggOnly)).toBeNull()
    expect(unmetRequirement('enrich', {}, keggOnly)).toBeNull()
  })

  it('enrichment is enabled by any ONE term set on its own', () => {
    // One gene, one annotation column each — every source alone is enough.
    const single: Record<string, string> = {
      GO_BP: 'apoptotic process',
      GO_MF: 'kinase activity',
      GO_CC: 'nucleus',
      GO: 'DNA repair',
      KEGG: 'Cell cycle',
      Reactome: 'Apoptosis',
      MSigDB: 'HALLMARK_APOPTOSIS',
      COG_cat: 'Transcription'
    }
    for (const [col, term] of Object.entries(single)) {
      const u = facts({ kind: 'compare', result: cmpResult({ g1: { [col]: term } }) })
      for (const source of ['go', 'kegg', 'reactome', 'msigdb', 'cog', 'cog_group'])
        expect(unmetRequirement('enrich', { source }, u), `${col} with ${source} saved`).toBeNull()
    }
  })

  it('is not enabled by COG groups alone — that level is not offered', () => {
    const u = facts({ kind: 'compare', result: cmpResult({ g1: { COG: 'RecA' } }) })
    expect(unmetRequirement('enrich', { source: 'cog_group' }, u)).toMatch(
      /No enrichment annotations/
    )
  })

  it('annotation-based requirements are unknown (satisfied) until a result exists', () => {
    expect(unmetRequirement('enrich', { source: 'go' }, facts({ kind: 'compare' }))).toBeNull()
    expect(unmetRequirement('string', {}, facts({ kind: 'compare' }))).toBeNull()
    const noAnn = facts({ kind: 'compare', result: cmpResult({}) })
    expect(unmetRequirement('enrich', { source: 'go' }, noAnn)).toMatch(/No enrichment annotations/)
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
