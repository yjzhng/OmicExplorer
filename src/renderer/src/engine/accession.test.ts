/** Feature IDs → the proteins they name: isoforms fold into their entry, groups into members. */
import { describe, expect, it } from 'vitest'

import { canonicalAccession, groupMembers, matchKey, unionRecords, unionValues } from './accession'
import { standardize } from './ingest'

describe('canonicalAccession', () => {
  it('drops the isoform suffix of a UniProt accession', () => {
    expect(canonicalAccession('Q9ULV3-5')).toBe('Q9ULV3')
    expect(canonicalAccession('P55198-12')).toBe('P55198')
    // the 10-character accession form
    expect(canonicalAccession('A0A024RBG1-2')).toBe('A0A024RBG1')
  })

  it('leaves a canonical accession, a gene symbol and a decoy alone', () => {
    expect(canonicalAccession('Q9ULV3')).toBe('Q9ULV3')
    expect(canonicalAccession('NKX2-1')).toBe('NKX2-1')
    expect(canonicalAccession('REV__Q15147-5')).toBe('REV__Q15147-5')
    expect(canonicalAccession('g0001')).toBe('g0001')
  })
})

describe('groupMembers', () => {
  it('folds a group of isoforms into its one entry', () => {
    expect(groupMembers('Q6P1R3-3;Q6P1R3;Q6P1R3-2')).toEqual(['Q6P1R3'])
  })

  it('lists distinct proteins in order, unwrapped', () => {
    expect(groupMembers('sp|Q13547|HDAC1_HUMAN;sp|Q92769-2|HDAC2_HUMAN')).toEqual([
      'Q13547',
      'Q92769'
    ])
    expect(groupMembers(' P55198 ')).toEqual(['P55198'])
    expect(groupMembers('')).toEqual([])
  })

  it('keys a group alike however it was written', () => {
    expect(matchKey('sp|Q6P1R3-3|MSD2_HUMAN;sp|Q6P1R3|MSD2_HUMAN')).toBe(matchKey('Q6P1R3'))
  })
})

describe('union', () => {
  it('merges term lists without repeats', () => {
    expect(unionValues(['hsa04110 Cell cycle;hsa05200 Cancer', 'hsa04110 Cell cycle'])).toBe(
      'hsa04110 Cell cycle;hsa05200 Cancer'
    )
  })

  it('keeps both values when members disagree, and skips the empty', () => {
    expect(
      unionRecords([
        { CEG_NEG: 'essential', KEGG: 'A' },
        { CEG_NEG: 'non-essential', KEGG: '' },
        undefined
      ])
    ).toEqual({ CEG_NEG: 'essential;non-essential', KEGG: 'A' })
    expect(unionRecords([undefined, {}])).toBeUndefined()
  })

  it('keeps COG/KOG categories paired with their areas, KEGG pathways with their levels', () => {
    // One area per category, repeats included — the pairing is by position.
    const one = { COG_cat: 'J;K;L', COG_area: 'Info;Info;Info' }
    expect(unionRecords([one])).toEqual(one)
    expect(unionRecords([one, { COG_cat: 'K;C', COG_area: 'Info;Metabolism' }])).toEqual({
      COG_cat: 'J;K;L;C',
      COG_area: 'Info;Info;Info;Metabolism'
    })
    expect(
      unionRecords([
        {
          KEGG: 'Cell cycle;Apoptosis',
          KEGG_cat: 'Cellular Processes;Cellular Processes',
          KEGG_grp: 'Cell growth and death;Cell growth and death'
        },
        {
          KEGG: 'Apoptosis;Glycolysis',
          KEGG_cat: 'Cellular Processes;Metabolism',
          KEGG_grp: 'Cell growth and death;Carbohydrate metabolism'
        }
      ])
    ).toEqual({
      KEGG: 'Cell cycle;Apoptosis;Glycolysis',
      KEGG_cat: 'Cellular Processes;Cellular Processes;Metabolism',
      KEGG_grp: 'Cell growth and death;Cell growth and death;Carbohydrate metabolism'
    })
  })
})

describe('Clean data on protein groups', () => {
  const sheet = ['sample,cell,cmpd', 's1,WT,A', 's2,WT,B'].join('\n')
  const run = (data: string[], db: string[]) =>
    standardize({
      dataText: data.join('\n'),
      dataFilename: 'd_wide.csv',
      samplesheetText: sheet,
      dbText: db.join('\n'),
      logTransform: 'none'
    })

  it('keeps a group as ONE feature, labelled by all its genes, with its members’ union', () => {
    const group = 'Q13547;Q92769-2'
    const r = run(
      ['uniqID,s1,s2', `"${group}",10,20`],
      ['uniqID,gene,KEGG,CEG_NEG', 'Q13547,HDAC1,A;B,essential', 'Q92769,HDAC2,B;C,non-essential']
    )
    expect(new Set(r.rows.map((x) => x.uniqID))).toEqual(new Set([group]))
    expect(r.rows).toHaveLength(2) // one per sample, not one per member
    expect(r.displayMap[group]).toBe('HDAC1/HDAC2')
    expect(r.annotationMap[group]).toEqual({
      KEGG: 'A;B;C',
      CEG_NEG: 'essential;non-essential'
    })
  })

  it('matches the DB on canonical accessions, isoforms folded', () => {
    const r = run(
      ['UniProtID,s1,s2', 'Q9ULV3-5,1,2', 'Q6P1R3-3;Q6P1R3-2,3,4', 'Q13547;Q92769-2,5,6'],
      [
        'uniqID,UniProtID,gene',
        'g1,Q9ULV3,CIZ1',
        'g2,Q6P1R3,MSANTD2',
        'g3,Q13547,HDAC1',
        'g4,Q92769,HDAC2'
      ]
    )
    // A single protein — isoforms of one entry included — takes its DB uniqID; a group of two
    // proteins keeps its own ID and gathers both members' rows.
    expect(r.displayMap.g1).toBe('CIZ1')
    expect(r.displayMap.g2).toBe('MSANTD2')
    expect(r.displayMap['Q13547;Q92769-2']).toBe('HDAC1/HDAC2')
  })

  it('keeps two features that fold to one entry apart', () => {
    const r = run(
      ['UniProtID,s1,s2', 'Q9ULV3-5,1,2', 'Q9ULV3-2,3,4'],
      ['uniqID,UniProtID,gene', 'g1,Q9ULV3,CIZ1']
    )
    expect(new Set(r.rows.map((x) => x.uniqID))).toEqual(new Set(['Q9ULV3-5', 'Q9ULV3-2']))
  })

  it('labels exactly the measured features — not DB rows the data never had', () => {
    const r = run(
      ['UniProtID,s1,s2', 'P1,1,2', 'P9,3,4'],
      ['uniqID,UniProtID,gene', 'g1,P1,ONE', 'g2,P2,TWO']
    )
    expect(r.displayMap).toEqual({ g1: 'ONE', P9: 'P9' })
  })

  it('reads older and other-format column names as the new ones', () => {
    const r = run(
      ['UniProtID,s1,s2', 'P1,1,2', 'P2,3,4'],
      [
        'uniqID,UniProtID,cogCategory,cogArea,keggPathway',
        'g1,P1,Transcription,Info,Cell cycle',
        // the prokaryotic DB format's pathway column
        'g2,P2,,,'
      ]
    )
    expect(r.annotationMap.g1).toEqual({
      COG_cat: 'Transcription',
      COG_area: 'Info',
      KEGG: 'Cell cycle'
    })
    const prok = run(
      ['UniProtID,s1,s2', 'P1,1,2'],
      ['uniqID,UniProtID,KG_PW', 'g1,P1,Two-component system']
    )
    expect(prok.annotationMap.g1).toEqual({ KEGG: 'Two-component system' })
  })

  it('takes the KEGG pathway category from the data, paired by position', () => {
    const r = run(
      ['UniProtID,s1,s2', 'P1,1,2'],
      [
        'uniqID,UniProtID,KEGG,KEGG_cat,KEGG_grp',
        'g1,P1,Cell cycle;Glycolysis,Cellular Processes;Metabolism,Cell growth and death;Carbohydrate metabolism'
      ]
    )
    expect(r.keggCategories).toEqual({
      'Cell cycle': 'Cellular Processes',
      Glycolysis: 'Metabolism'
    })
  })
})
