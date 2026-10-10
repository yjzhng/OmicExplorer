import { describe, expect, it } from 'vitest'

import { exportPath, sanitize } from './paths'

describe('exportPath', () => {
  it('subfolder: nests by analysis folder; selected-only variants under a selected subfolder', () => {
    expect(exportPath('Amk_H2O2', 'Volcano_grp_c1', 'subfolder', 'png', false)).toBe(
      'Amk_H2O2/Volcano_grp_c1.png'
    )
    expect(exportPath('Amk_H2O2', 'Volcano_grp_c1', 'subfolder', 'png', true)).toBe(
      'Amk_H2O2/selected/Volcano_grp_c1.png'
    )
  })

  it('flat: joins with double underscore; selected-only variants under a top-level selected folder', () => {
    expect(exportPath('Amk_H2O2', 'Comparison_cmp-6', 'flat', 'csv', false)).toBe(
      'Amk_H2O2__Comparison_cmp-6.csv'
    )
    expect(exportPath('Amk_H2O2', 'Volcano_grp_c1', 'flat', 'pdf', true)).toBe(
      'selected/Amk_H2O2__Volcano_grp_c1.pdf'
    )
  })
})

describe('sanitize', () => {
  it('strips unsafe chars and trims separators', () => {
    expect(sanitize('Drug A / Veh (2.5 µM)')).toBe('Drug_A_Veh_2.5_M')
    expect(sanitize('')).toBe('item')
  })
})
