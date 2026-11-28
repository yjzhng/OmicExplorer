/** Gene labels capped in length on plot axes / legends. */
import { describe, expect, it } from 'vitest'

import { LABEL_MAX, truncateLabel } from './plotAxes'

describe('truncateLabel', () => {
  it('leaves a short label alone', () => {
    expect(truncateLabel('TP53')).toBe('TP53')
    expect(truncateLabel('x'.repeat(LABEL_MAX))).toBe('x'.repeat(LABEL_MAX))
  })

  it('cuts a long one to the cap, ending in an ellipsis', () => {
    const out = truncateLabel('HDAC1/HDAC2/HDAC3/HDAC8/SIRT1')
    expect(out).toHaveLength(LABEL_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(truncateLabel('Cellular tumor antigen p53', 10)).toBe('Cellular…')
  })
})
