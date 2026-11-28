import { describe, expect, it } from 'vitest'
import { moduleParts, termModules } from './enrichModules'

const t = (term: string, genes: string, pAdjust: number) => ({
  term,
  genes: genes.split(''),
  pAdjust
})

describe('termModules', () => {
  it('groups terms carried by the same genes, named after the most significant', () => {
    const m = termModules([
      t('ribosome', 'abcdef', 1e-6),
      t('translation', 'abcdeg', 1e-5),
      t('rRNA binding', 'abcd', 1e-4),
      t('flagellum', 'uvwxyz', 1e-3)
    ])
    expect(m.order).toEqual(['ribosome (3)'])
    expect(m.members.get('ribosome (3)')).toEqual(['ribosome', 'translation', 'rRNA binding'])
    // a term like no other is in no module
    expect(m.of.has('flagellum')).toBe(false)
  })

  it("a parent carried by its child's hits groups with it; a broad term holding a few hits does not", () => {
    const m = termModules([
      t('child', 'abcd', 1e-5),
      t('parent', 'abcde', 1e-4),
      t('cytosol', 'abcdefghijklmnopqrstuvwxyz', 1e-6),
      t('small', 'xy', 1e-3)
    ])
    expect(m.of.get('parent')).toBe('child (2)')
    // 'small' lies inside 'cytosol' but shares little of it: no hub
    expect(m.of.has('small')).toBe(false)
    expect(m.of.has('cytosol')).toBe(false)
  })

  it('keeps separate findings apart, ordered by their best term', () => {
    const m = termModules([
      t('A1', 'abcd', 1e-3),
      t('B1', 'wxyz', 1e-8),
      t('A2', 'abce', 1e-2),
      t('B2', 'wxyv', 1e-6)
    ])
    expect(m.order).toEqual(['B1 (2)', 'A1 (2)'])
  })

  it('pools a term found in both directions', () => {
    const m = termModules([t('X', 'ab', 1e-3), t('X', 'cd', 1e-4), t('Y', 'abcd', 1e-2)])
    expect(m.of.get('X')).toBe('X (2)')
    expect(m.of.get('Y')).toBe('X (2)')
  })

  it('average linkage: a group only takes a term close to it on average', () => {
    // A–B close (4/5); B–C at the cut (3/6) but A–C apart (2/6): C averages 5/12 with A+B
    const m = termModules([t('A', 'abcd', 1e-5), t('B', 'abcde', 1e-4), t('C', 'cdef', 1e-3)])
    expect(m.members.get('A (2)')).toEqual(['A', 'B'])
    expect(m.of.has('C')).toBe(false)
  })

  it("a module's name splits back into its term and size", () => {
    const m = termModules([t('cell (wall) part', 'abcd', 1e-5), t('B', 'abcde', 1e-4)])
    expect(moduleParts(m.order[0])).toEqual({ rep: 'cell (wall) part', size: 2 })
    expect(moduleParts('no size')).toBeNull()
  })
})
