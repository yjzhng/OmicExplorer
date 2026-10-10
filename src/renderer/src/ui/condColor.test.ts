import { describe, expect, it } from 'vitest'

import { conditionColorer } from './condColor'
import { CATEGORICAL } from './theme'

type M = { cell: string; dose: number | null }
const items: M[] = [
  { cell: 'WT', dose: 1 },
  { cell: 'WT', dose: 10 },
  { cell: 'KO', dose: 1 },
  { cell: 'KO', dose: 10 }
]
const opts = { base: '#6ea8fe', missing: '#888888' }

describe('conditionColorer', () => {
  it('colours by the categorical condition, one palette colour per level', () => {
    const c = conditionColorer(items, (m) => m, 'cell', undefined, opts)
    expect(c.on).toBe(true)
    expect(items.map(c.fill)).toEqual([
      CATEGORICAL[0],
      CATEGORICAL[0],
      CATEGORICAL[1],
      CATEGORICAL[1]
    ])
    expect(c.cats.map((k) => k.value)).toEqual(['WT', 'KO'])
  })

  it('shades the base by dose alone: low pale, high the base itself', () => {
    const c = conditionColorer(items, (m) => m, undefined, 'dose', opts)
    expect(c.fill(items[1])).toBe('rgb(110,168,254)')
    expect(c.fill(items[0])).not.toBe(c.fill(items[1]))
    expect(c.primary(items[0])).toBe(opts.base)
  })

  it('is off when the items carry neither condition', () => {
    const c = conditionColorer([{ cell: '', dose: null }], (m) => m, 'cell', 'dose', opts)
    expect(c.on).toBe(false)
  })
})
