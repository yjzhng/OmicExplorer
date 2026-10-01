/** Term extraction per enrichment source: each source reads only its own annotation columns, the
 *  two-level sources (KEGG, COG) resolve to different term sets off the same genes, and a selector
 *  can tell which sources the data can actually be tested against. */
import { describe, expect, it } from 'vitest'

import {
  cogAreasOf,
  ENRICH_COLS,
  ENRICH_FALLBACK,
  ENRICH_GROUPS,
  ENRICH_SOURCE_LABEL,
  enrichSourcesPresent,
  enrichTermsOf,
  resolveEnrichSource,
  type EnrichSource
} from './plotData'

const SOURCES = Object.keys(ENRICH_COLS) as EnrichSource[]

const ann = {
  p1: {
    GO_BP: 'apoptotic process; DNA repair',
    keggPathway: 'p53 signaling pathway; Cell cycle',
    COG: 'Transcription factor p53',
    cogCategory: 'Replication, recombination and repair',
    msigdbSet: 'HALLMARK_P53_PATHWAY; HALLMARK_DNA_REPAIR',
    reactomePathway: 'Activation of PUMA and translocation to mitochondria'
  },
  p2: { proteinName: 'Uncharacterized protein' }
}
// KEGG's BRITE top level, the term set behind `kegg_category`.
const cats = { 'p53 signaling pathway': 'Cellular Processes', 'Cell cycle': 'Cellular Processes' }

describe('enrichment sources', () => {
  it('every source has annotation columns and a label', () => {
    for (const s of SOURCES) {
      expect(ENRICH_COLS[s].length).toBeGreaterThan(0)
      expect(ENRICH_SOURCE_LABEL[s]).toBeTruthy()
    }
    expect(SOURCES).toEqual(Object.keys(ENRICH_SOURCE_LABEL))
  })

  it('reads only its own columns, splitting on ; and |', () => {
    expect(enrichTermsOf(ann, 'go', 'p1')).toEqual(['apoptotic process', 'DNA repair'])
    expect(enrichTermsOf(ann, 'kegg', 'p1')).toEqual(['p53 signaling pathway', 'Cell cycle'])
    expect(enrichTermsOf(ann, 'cog', 'p1')).toEqual(['Replication, recombination and repair'])
    expect(enrichTermsOf(ann, 'cog_group', 'p1')).toEqual(['Transcription factor p53'])
    expect(enrichTermsOf(ann, 'msigdb', 'p1')).toEqual([
      'HALLMARK_P53_PATHWAY',
      'HALLMARK_DNA_REPAIR'
    ])
    expect(enrichTermsOf(ann, 'reactome', 'p1')).toEqual([
      'Activation of PUMA and translocation to mitochondria'
    ])
  })

  it('a gene with no terms for a source yields none, and an unknown gene yields none', () => {
    for (const s of SOURCES) {
      expect(enrichTermsOf(ann, s, 'p2', cats)).toEqual([])
      expect(enrichTermsOf(ann, s, 'missing', cats)).toEqual([])
    }
  })

  describe('the two-level sources', () => {
    it('KEGG rolls its pathways up to distinct BRITE categories', () => {
      // Two pathways, one category — the level genuinely changes the term set, it isn't a relabel.
      expect(enrichTermsOf(ann, 'kegg', 'p1', cats)).toHaveLength(2)
      expect(enrichTermsOf(ann, 'kegg_category', 'p1', cats)).toEqual(['Cellular Processes'])
    })

    it('KEGG categories need the map — the column alone carries no category', () => {
      expect(enrichTermsOf(ann, 'kegg_category', 'p1')).toEqual([])
      expect(enrichTermsOf(ann, 'kegg_category', 'p1', {})).toEqual([])
    })

    it('a pathway with no known category is dropped rather than passed through', () => {
      const partial = { 'p53 signaling pathway': 'Cellular Processes' }
      expect(enrichTermsOf(ann, 'kegg_category', 'p1', partial)).toEqual(['Cellular Processes'])
    })

    it('COG group and COG category read different columns', () => {
      expect(ENRICH_COLS.cog).toEqual(['cogCategory'])
      expect(ENRICH_COLS.cog_group).toEqual(['COG'])
      expect(enrichTermsOf(ann, 'cog', 'p1')).not.toEqual(enrichTermsOf(ann, 'cog_group', 'p1'))
    })
  })

  describe('enrichSourcesPresent', () => {
    it('lists only the sources the genes carry terms for, in fallback order', () => {
      expect(enrichSourcesPresent(ann, cats)).toEqual(ENRICH_FALLBACK)
      expect(enrichSourcesPresent({ p2: ann.p2 }, cats)).toEqual([])
      expect(enrichSourcesPresent({}, cats)).toEqual([])
    })

    it('omits a level the data cannot support, keeping the other', () => {
      // KEGG pathways present but no BRITE map → the pathway level is testable, the category isn't.
      expect(enrichSourcesPresent({ p1: { keggPathway: 'Cell cycle' } })).toEqual(['kegg'])
      // Only a category column → the group level has nothing.
      expect(enrichSourcesPresent({ p1: { cogCategory: 'Transcription' } })).toEqual(['cog'])
      // COG group isn't offered at all (too fine): a group column alone yields nothing.
      expect(enrichSourcesPresent({ p1: { COG: 'RecA' } })).toEqual([])
    })

    it('finds a source carried by any gene, not just the first', () => {
      const spread = { a: { GO_BP: 'x' }, b: {}, c: { reactomePathway: 'y' } }
      expect(enrichSourcesPresent(spread)).toEqual(['go', 'reactome'])
    })
  })

  describe('fallback', () => {
    it('falls back through every offered source, each once — not COG group or KEGG category', () => {
      // Those two stay readable by the engine but aren't term sets the user picks: COG group is too
      // fine, and a KEGG category groups KEGG pathways rather than being terms of its own.
      const offered = SOURCES.filter((s) => s !== 'cog_group' && s !== 'kegg_category')
      expect([...ENRICH_FALLBACK].sort()).toEqual([...offered].sort())
    })

    it('presents the offered sources under Function and Pathway, each exactly once', () => {
      const grouped = ENRICH_GROUPS.flatMap((g) => g.sources)
      expect([...grouped].sort()).toEqual([...ENRICH_FALLBACK].sort())
      expect(new Set(grouped).size).toBe(grouped.length)
    })

    it('keeps the saved source whenever the genes carry it', () => {
      expect(resolveEnrichSource('reactome', ['go', 'reactome'])).toBe('reactome')
      expect(resolveEnrichSource('cog', ENRICH_FALLBACK)).toBe('cog')
    })

    it('moves a plot saved on COG group to an offered source', () => {
      // COG group is never present now, so a tile that saved it shows the next set it can.
      expect(resolveEnrichSource('cog_group', ['cog', 'go'])).toBe('go')
    })

    it('otherwise takes the first present source in fallback order', () => {
      // No GO (the default) fetched: KEGG pathways before Reactome, whatever order they're given in.
      expect(resolveEnrichSource('go', ['reactome', 'kegg'])).toBe('kegg')
      expect(resolveEnrichSource(undefined, ['cog_group', 'cog'])).toBe('cog')
    })

    it('has nothing to fall back to when the genes carry no terms', () => {
      expect(resolveEnrichSource('go', [])).toBeNull()
    })
  })

  describe('COG areas', () => {
    it('pairs each category with the area written beside it, in the same order', () => {
      const data = {
        a: {
          cogCategory:
            'Transcription; Posttranslational modification, protein turnover, chaperones',
          cogArea: 'Information storage and processing; Cellular processes and signaling'
        },
        b: { cogCategory: 'Function unknown', cogArea: 'Poorly characterized' }
      }
      expect(cogAreasOf(data)).toEqual({
        Transcription: 'Information storage and processing',
        'Posttranslational modification, protein turnover, chaperones':
          'Cellular processes and signaling',
        'Function unknown': 'Poorly characterized'
      })
    })

    it('has nothing for data fetched before the area column existed', () => {
      expect(cogAreasOf({ a: { cogCategory: 'Transcription' } })).toEqual({})
    })
  })
})
