/** Engine pool sizing from the logical core count. */
import { describe, expect, it } from 'vitest'

import { poolSizeFor } from './poolSize'

describe('poolSizeFor', () => {
  it.each([
    ['dual core with hyper-threading', 4, 0],
    ['6 logical', 6, 2],
    ['M1 / M2 / M3 (4P+4E)', 8, 3],
    ['M2 Pro (6P+4E)', 10, 4],
    ['Intel hybrid i5-1235U (2P+8E, 12 logical)', 12, 4],
    ['Ryzen 7 (8C/16T)', 16, 4],
    ['M2 Ultra (24 cores)', 24, 4],
    ['unknown (0)', 0, 0]
  ])('%s: %i logical → %i workers', (_name, logical, want) => {
    expect(poolSizeFor(logical)).toBe(want)
  })
})
