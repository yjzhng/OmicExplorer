import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, app: { getPath: () => '/tmp' } }))

import { ancestorsAmong, parseGoObo } from './goHierarchy'

const OBO = `format-version: 1.2
data-version: releases/2026-07-26

[Term]
id: GO:1
name: metabolic process
namespace: biological_process

[Term]
id: GO:2
name: carbohydrate metabolic process
namespace: biological_process
is_a: GO:1 ! metabolic process

[Term]
id: GO:3
name: glycolytic process
namespace: biological_process
is_a: GO:2 ! carbohydrate metabolic process
relationship: part_of GO:4 ! energy derivation
relationship: regulates GO:1 ! metabolic process

[Term]
id: GO:4
name: energy derivation
namespace: biological_process

[Term]
id: GO:5
name: obsolete thing
namespace: biological_process
is_obsolete: true
is_a: GO:1 ! metabolic process

[Typedef]
id: part_of
name: part of
`

describe('parseGoObo', () => {
  it('reads live terms and their is_a / part_of parents by name', () => {
    const h = parseGoObo(OBO)
    expect(h.version).toBe('releases/2026-07-26')
    expect(h.parents['glycolytic process']).toEqual([
      'carbohydrate metabolic process',
      'energy derivation'
    ])
    // regulates is not nesting; obsolete terms and typedefs are dropped
    expect(h.parents['obsolete thing']).toBeUndefined()
    expect(h.parents['part of']).toBeUndefined()
    expect(h.parents['metabolic process']).toEqual([])
  })
})

describe('ancestorsAmong', () => {
  it("gives each term's ancestors that are in the set, through any depth", () => {
    const h = parseGoObo(OBO)
    const a = ancestorsAmong(h, ['glycolytic process', 'metabolic process', 'unknown term'])
    expect(a['glycolytic process']).toEqual(['metabolic process'])
    expect(a['metabolic process']).toBeUndefined()
    expect(a['unknown term']).toBeUndefined()
  })
})
