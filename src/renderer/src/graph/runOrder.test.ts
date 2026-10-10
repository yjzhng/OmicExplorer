import { describe, expect, it } from 'vitest'

import { downstreamOf, runOrder } from './runOrder'

const e = (pairs: string): { source: string; target: string }[] =>
  pairs.split(' ').map((p) => {
    const [source, target] = p.split('>')
    return { source, target }
  })

describe('runOrder (Run All runs branch by branch)', () => {
  it('finishes each branch before starting the next', () => {
    // load → clean → { plotsA, compare → plotsB }
    const ids = ['load', 'clean', 'plotsA', 'compare', 'plotsB']
    const edges = e('load>clean clean>plotsA clean>compare compare>plotsB')
    expect(runOrder(ids, edges)).toEqual(['load', 'clean', 'plotsA', 'compare', 'plotsB'])
  })

  it('runs a deep branch to its end before its sibling (not level by level)', () => {
    // clean → { cmpA → ctrA → plotA, cmpB → plotB }
    const ids = ['clean', 'cmpA', 'cmpB', 'ctrA', 'plotA', 'plotB']
    const edges = e('clean>cmpA clean>cmpB cmpA>ctrA ctrA>plotA cmpB>plotB')
    expect(runOrder(ids, edges)).toEqual(['clean', 'cmpA', 'ctrA', 'plotA', 'cmpB', 'plotB'])
  })

  it('a step with two inputs waits for both', () => {
    // a diamond: clean → { cmpA, cmpB } → contrast
    const ids = ['clean', 'cmpA', 'cmpB', 'contrast']
    const edges = e('clean>cmpA clean>cmpB cmpA>contrast cmpB>contrast')
    expect(runOrder(ids, edges)).toEqual(['clean', 'cmpA', 'cmpB', 'contrast'])
  })

  it('separate pipelines run one after the other, in node order', () => {
    const ids = ['loadA', 'loadB', 'cleanA', 'cleanB']
    const edges = e('loadA>cleanA loadB>cleanB')
    expect(runOrder(ids, edges)).toEqual(['loadA', 'cleanA', 'loadB', 'cleanB'])
  })
})

describe('downstreamOf', () => {
  it('collects every step below, not the step itself', () => {
    const edges = e('clean>cmpA clean>cmpB cmpA>plotA')
    expect([...downstreamOf('cmpA', edges)]).toEqual(['plotA'])
    expect(new Set(downstreamOf('clean', edges))).toEqual(new Set(['cmpA', 'cmpB', 'plotA']))
  })
})
