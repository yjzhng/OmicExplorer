import { describe, expect, it } from 'vitest'

import { buildFolderMap, exportPath, sanitize } from './paths'

describe('buildFolderMap', () => {
  it('keeps unique labels clean and disambiguates colliding ones by root id', () => {
    // Two distinct analyses both labelled "clpP | WT" must not share a folder.
    const m = buildFolderMap([
      { rootId: 'compare-6', analysis: 'Amk | H2O2' },
      { rootId: 'step-7', analysis: 'clpP | WT' },
      { rootId: 'step-48', analysis: 'clpP | WT' }
    ])
    expect(m.get('compare-6')).toBe('Amk_H2O2')
    expect(m.get('step-7')).toBe('clpP_WT_step-7')
    expect(m.get('step-48')).toBe('clpP_WT_step-48')
    // the two colliding folders are now distinct
    expect(m.get('step-7')).not.toBe(m.get('step-48'))
  })

  it('collapses repeated entries for the same root', () => {
    const m = buildFolderMap([
      { rootId: 'r1', analysis: 'A' },
      { rootId: 'r1', analysis: 'A' }
    ])
    expect(m.get('r1')).toBe('A')
  })
})

describe('exportPath', () => {
  it('subfolder: nests by analysis folder; GOI variants under a GOI subfolder', () => {
    expect(exportPath('Amk_H2O2', 'Volcano_grp_c1', 'subfolder', 'png', false)).toBe(
      'Amk_H2O2/Volcano_grp_c1.png'
    )
    expect(exportPath('Amk_H2O2', 'Volcano_grp_c1', 'subfolder', 'png', true)).toBe(
      'Amk_H2O2/GOI/Volcano_grp_c1.png'
    )
  })

  it('flat: joins with double underscore; GOI variants under a top-level GOI folder', () => {
    expect(exportPath('Amk_H2O2', 'Comparison_cmp-6', 'flat', 'csv', false)).toBe(
      'Amk_H2O2__Comparison_cmp-6.csv'
    )
    expect(exportPath('Amk_H2O2', 'Volcano_grp_c1', 'flat', 'pdf', true)).toBe(
      'GOI/Amk_H2O2__Volcano_grp_c1.pdf'
    )
  })
})

describe('sanitize', () => {
  it('strips unsafe chars and trims separators', () => {
    expect(sanitize('Drug A / Veh (2.5 µM)')).toBe('Drug_A_Veh_2.5_M')
    expect(sanitize('')).toBe('item')
  })
})
