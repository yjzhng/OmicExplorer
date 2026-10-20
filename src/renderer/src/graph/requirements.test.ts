import { describe, expect, it } from 'vitest'

import {
  entryKey,
  NODE_SPECS,
  plotEntriesFor,
  plotLabel,
  seriesAxes,
  tileEntryKey
} from './registry'
import {
  entriesFor,
  factsOf,
  gatePlotEntries,
  UNWIRED,
  unmetRequirement,
  type UpstreamFacts
} from './requirements'
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
    const doseOnly = facts({ kind: 'compare', axes: ['dose'] })
    expect(unmetRequirement('dr', { axis: 'dose' }, doseOnly)).toBeNull()
    expect(unmetRequirement('dr', { axis: 'time' }, doseOnly)).toMatch(/time condition/)
    expect(unmetRequirement('tdr', {}, doseOnly)).toMatch(/both dose and time/)
    expect(unmetRequirement('bubble', { axis: 'time' }, doseOnly)).toBeNull()
    // the default (dose) axis on time-only data: the plot draws by time, so it's offered
    const timeOnly = facts({ kind: 'compare', axes: ['time'] })
    expect(unmetRequirement('bubble', NODE_SPECS.bubble.defaultConfig(), timeOnly)).toBeNull()
    expect(seriesAxes('dose', ['time'], undefined)).toEqual({ axes: ['time'], axis: 'time' })
    // a numeric custom condition alone is the axis too
    const tempOnly = facts({ kind: 'compare', axes: ['@temp'] })
    expect(unmetRequirement('bubble', NODE_SPECS.bubble.defaultConfig(), tempOnly)).toBeNull()
    expect(seriesAxes('dose', ['@temp'], undefined)).toEqual({ axes: ['@temp'], axis: '@temp' })
    expect(seriesAxes('time', ['dose', 'time'], undefined)).toEqual({
      axes: ['dose', 'time'],
      axis: 'time'
    })
    const none = facts({ kind: 'compare', axes: [] })
    expect(unmetRequirement('bubble', {}, none)).toMatch(/numeric condition/)
    // a numeric custom condition is an axis like dose and time, alone or in a pair
    const withTemp = facts({ kind: 'compare', axes: ['dose', '@temp'] })
    expect(unmetRequirement('dr', { axis: '@temp' }, withTemp)).toBeNull()
    expect(unmetRequirement('tdr', { pair: ['dose', '@temp'] }, withTemp)).toBeNull()
    expect(unmetRequirement('tdr', { pair: ['time', '@temp'] }, withTemp)).toMatch(
      /both time and temp/
    )
  })

  it('a Curve fit feeds curve plots, not per-dose or group-mean ones', () => {
    const curve = facts({ kind: 'curveFit', curve: true })
    for (const k of [
      'volcano',
      'heatmap',
      'dr',
      'potency',
      'metrics',
      'curveMad',
      'enrich',
      'string',
      'table'
    ] as const)
      expect(unmetRequirement(k, NODE_SPECS[k].defaultConfig(), curve)).toBeNull()
    for (const k of ['ma', 'scatter', 'bubble', 'tdr'] as const)
      expect(unmetRequirement(k, NODE_SPECS[k].defaultConfig(), curve)).toMatch(/Needs a/)
    // Potency and the residual plots are a curve fit's only.
    for (const k of ['potency', 'metrics', 'curveMad'] as const)
      expect(unmetRequirement(k, {}, facts({ kind: 'compare' }))).toMatch(/Curve fit/)
    // A Contrast's scatter (FC1 vs FC2) is unaffected.
    expect(unmetRequirement('scatter', {}, facts({ kind: 'contrast', curve: false }))).toBeNull()
  })

  it('reads a curve-fit result as a Curve fit upstream (the results panel)', () => {
    const curveRes = {
      kind: 'compare',
      cmp: { rows: [{ uniqID: 'g1', curve: { axis: 'dose' } }], comparisons: [] },
      displayMap: {},
      annotationMap: {}
    } as unknown as NodeResult
    expect(factsOf(curveRes).kind).toBe('curveFit')
    expect(unmetRequirement('potency', {}, factsOf(curveRes))).toBeNull()
    expect(factsOf(cmpResult()).kind).toBe('compare')
  })

  it('the response surface method: surfaces go to the Response plot, residuals stay CurveCurator’s', () => {
    const spline = facts({ kind: 'curveFit', curve: true, detection: 'spline' })
    const surf = facts({ kind: 'curveFit', curve: true, detection: 'spline', surface: true })
    const cc = facts({ kind: 'curveFit', curve: true, detection: '4pl' })
    expect(unmetRequirement('curveMad', {}, spline)).toMatch(/CurveCurator method/)
    expect(unmetRequirement('curveMad', {}, cc)).toBeNull()
    expect(unmetRequirement('response', {}, surf)).toBeNull()
    expect(unmetRequirement('response', {}, spline)).toMatch(/dose × time/)
    expect(unmetRequirement('response', {}, cc)).toMatch(/dose × time/)
    expect(unmetRequirement('dr', { axis: 'dose' }, surf)).toMatch(/Dose & Time response plot/)
    // a 4PL surface (CurveCurator in 2-D): a surface too — the Response plot, no residual plots
    const surf4 = facts({ kind: 'curveFit', curve: true, detection: '4pl', surface: true })
    expect(unmetRequirement('response', {}, surf4)).toBeNull()
    expect(unmetRequirement('curveMad', {}, surf4)).toMatch(/CurveCurator method/)
    expect(unmetRequirement('potency', {}, surf)).toBeNull()
    // the Response plot takes a Curve fit only
    expect(unmetRequirement('response', {}, facts({ kind: 'compare' }))).toMatch(/Curve fit/)
  })

  it('reads a response surface result’s method from its rows (the results panel)', () => {
    const res = (axis: string): NodeResult =>
      ({
        kind: 'compare',
        cmp: { rows: [{ uniqID: 'g1', rs: { axis } }], comparisons: [] },
        displayMap: {},
        annotationMap: {}
      }) as unknown as NodeResult
    expect(factsOf(res('surface'))).toMatchObject({
      kind: 'curveFit',
      detection: 'spline',
      surface: true
    })
    expect(factsOf(res('dose'))).toMatchObject({ detection: 'spline', surface: false })
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
    const timeOnly = facts({ kind: 'compare', axes: ['time'] })
    expect(gatePlotEntries(entries, timeOnly).map((e) => e.label)).toEqual([
      'Time response',
      'Volcano'
    ])
    expect(gatePlotEntries(entries, UNWIRED)).toHaveLength(4)
  })

  it('a Curve fit offers the Response plot of its own axis (its rows hold no level of it)', () => {
    // a dose curve fit at each time: its rows carry the time as context, never a dose
    const fit = facts({ kind: 'curveFit', curve: true, axes: ['time'], curveAxis: 'dose' })
    const offered = gatePlotEntries(entriesFor('dr', fit), fit).map((e) => e.label)
    expect(offered).toEqual(['Dose response'])
    expect(unmetRequirement('dr', { axis: 'time' }, fit)).toMatch(/runs over dose/)
    // a time curve fit likewise
    const tfit = facts({ kind: 'curveFit', curve: true, axes: ['dose'], curveAxis: 'time' })
    expect(gatePlotEntries(entriesFor('dr', tfit), tfit).map((e) => e.label)).toEqual([
      'Time response'
    ])
  })

  it('fans the Response plots out over every numeric condition and every pair of them', () => {
    const axes = ['dose', 'time', '@temp'] as const
    expect(plotEntriesFor('dr', axes).map((e) => e.label)).toEqual([
      'Dose response',
      'Time response',
      'Temp response'
    ])
    const pairs = plotEntriesFor('tdr', axes)
    expect(pairs.map((e) => e.label)).toEqual([
      'Dose & Time response',
      'Dose & Temp response',
      'Time & Temp response'
    ])
    expect(pairs.map((e) => e.override?.pair)).toEqual([
      ['dose', 'time'],
      ['dose', '@temp'],
      ['time', '@temp']
    ])
    // each entry its own key, so each can be added (and checked) alongside the others
    const keys = [...plotEntriesFor('dr', axes), ...pairs].map(entryKey)
    expect(new Set(keys).size).toBe(keys.length)
    // a tile from before pairs (no pair) is the dose × time entry
    expect(tileEntryKey('tdr', {})).toBe(entryKey(pairs[0]))
    expect(tileEntryKey('dr', { axis: '@temp' })).toBe(entryKey(plotEntriesFor('dr', axes)[2]))
    // and is named for its conditions
    expect(plotLabel('tdr', {})).toBe('Dose & Time response')
    expect(plotLabel('tdr', { pair: ['time', '@temp'] })).toBe('Time & Temp response')
    expect(plotLabel('dr', { axis: '@temp' })).toBe('Temp response')
  })
})
