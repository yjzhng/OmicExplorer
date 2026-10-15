/** Results tabs are per plot group: named after the group, else the step it reads from, with
 *  `_1`, `_2` … where several would read the same. */
import { describe, expect, it } from 'vitest'

import { deriveTabs, tabTitles } from './groups'
import type { GraphNode, NodeKind } from './types'

const step = (id: string, kind: NodeKind, name?: string): GraphNode => ({
  id,
  type: 'step',
  position: { x: 0, y: 0 },
  data: {
    kind,
    config: (kind === 'plotGroup' ? { children: [] } : {}) as never,
    status: 'idle',
    ...(name ? { name } : null)
  }
})
const edge = (s: string, t: string) => ({ id: `${s}-${t}`, source: s, target: t })

describe('results tabs', () => {
  const nodes = [
    step('std', 'standardize'),
    step('cmp', 'compare'),
    step('g1', 'plotGroup'),
    step('g2', 'plotGroup'),
    step('g3', 'plotGroup'),
    step('cmp2', 'compare', 'Drug A')
  ]
  const edges = [
    edge('std', 'cmp'),
    edge('cmp', 'g1'),
    edge('cmp', 'g2'),
    edge('std', 'g3'),
    edge('std', 'cmp2')
  ]
  it('has one tab per plot group, rooted at the step it reads from', () => {
    const tabs = deriveTabs(nodes, edges)
    expect(tabs.map((t) => [t.id, t.rootId])).toEqual([
      ['g3', 'std'],
      ['g1', 'cmp'],
      ['g2', 'cmp']
    ])
    // a step without plots has none
    expect(tabs.some((t) => t.rootId === 'cmp2')).toBe(false)
  })
  it('names a tab after its step, numbering repeats', () => {
    const titles = tabTitles(deriveTabs(nodes, edges), nodes)
    expect(titles.get('g3')).toBe('Clean data')
    expect(titles.get('g1')).toBe('Compare_1')
    expect(titles.get('g2')).toBe('Compare_2')
  })
  it('a renamed group keeps its name; the rest re-number', () => {
    const renamed = nodes.map((n) => (n.id === 'g2' ? step('g2', 'plotGroup', 'Volcanos') : n))
    const titles = tabTitles(deriveTabs(renamed, edges), renamed)
    expect(titles.get('g1')).toBe('Compare')
    expect(titles.get('g2')).toBe('Volcanos')
  })
  it('two groups given the same name are numbered too', () => {
    const same = nodes.map((n) =>
      n.id === 'g1' || n.id === 'g2' ? step(n.id, 'plotGroup', 'QC') : n
    )
    const titles = tabTitles(deriveTabs(same, edges), same)
    expect([titles.get('g1'), titles.get('g2')]).toEqual(['QC_1', 'QC_2'])
  })
})
