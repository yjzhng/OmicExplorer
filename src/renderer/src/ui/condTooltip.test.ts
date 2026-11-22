import { describe, expect, it } from 'vitest'

import { tooltip, TOOLTIP_WIDTH, wrapTooltip } from './condTooltip'

describe('tooltip width', () => {
  it('wraps a long title at word breaks, every line within the width', () => {
    const title = 'regulation of transcription by RNA polymerase II in response to cellular stress'
    const lines = wrapTooltip(title).split('<br>')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((l) => l.length <= TOOLTIP_WIDTH)).toBe(true)
    expect(lines.join(' ')).toBe(title)
    expect(tooltip({ title }, '#999')).toBe(`<b>${wrapTooltip(title)}</b>`)
  })
  it('cuts one over-long word, and leaves short text, markup and placeholders alone', () => {
    expect(wrapTooltip('A'.repeat(60))).toBe(`${'A'.repeat(TOOLTIP_WIDTH - 1)}…`)
    expect(wrapTooltip('MAPK1')).toBe('MAPK1')
    const tpl = `%{text} ${'x '.repeat(40)}`
    expect(wrapTooltip(tpl)).toBe(tpl)
  })
})
