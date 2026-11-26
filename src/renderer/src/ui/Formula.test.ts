import { describe, expect, it } from 'vitest'

import { formulaTokens } from './formulaModel'

const read = (text: string, vars: string[]): string =>
  formulaTokens(text, vars)
    .map((t) =>
      t.kind === 'var'
        ? `[${t.text}#${t.order}]`
        : t.kind === 'text'
          ? t.text
          : `<${t.kind}:${t.text}>`
    )
    .join('')

describe('formulaTokens', () => {
  it('colours each variable by its term: main effect, two-way, three-way', () => {
    expect(
      read('y ~ cell + cmpd + time + cell × cmpd + cell × cmpd × time', ['cell', 'cmpd', 'time'])
    ).toBe(
      '<response:y><op: ~ >[cell#1] <op:+> [cmpd#1] <op:+> [time#1] <op:+> [cell#2] <op:×> [cmpd#2] <op:+> [cell#3] <op:×> [cmpd#3] <op:×> [time#3]'
    )
  })
  it('counts no × inside brackets: a grouping is one term', () => {
    expect(read('y ~ group(cmpd × dose)', ['cmpd', 'dose'])).toBe(
      '<response:y><op: ~ ><fn:group><op:(>[cmpd#1] <op:×> [dose#1]<op:)>'
    )
  })
  it('mutes functions and log scales, and matches whole words only', () => {
    expect(read('log₂ ratio ~ 4PL(log₁₀ dose) · spline(time)', ['dose', 'time'])).toBe(
      '<response:log₂ ratio><op: ~ ><fn:4PL><op:(><fn:log₁₀> [dose#1]<op:)> <op:·> <fn:spline><op:(>[time#1]<op:)>'
    )
    expect(read('y ~ doses', ['dose'])).toBe('<response:y><op: ~ >doses')
  })
  it('prefers the longer of two overlapping variables', () => {
    expect(read('y ~ cell line + cell', ['cell', 'cell line'])).toBe(
      '<response:y><op: ~ >[cell line#1] <op:+> [cell#1]'
    )
  })
})

describe('formula functions', () => {
  it('reads "spline surface" as one function name', () => {
    expect(read('y ~ spline surface(log₁₀ dose, log time)', ['dose', 'time'])).toBe(
      '<response:y><op: ~ ><fn:spline surface><op:(><fn:log₁₀> [dose#1]<op:,> <fn:log> [time#1]<op:)>'
    )
  })
})

describe('the constant', () => {
  it('reads μ as its own term, a function with an explanation', () => {
    expect(read('y ~ μ + cmpd + cmpd × dose', ['cmpd', 'dose'])).toBe(
      '<response:y><op: ~ ><fn:μ> <op:+> [cmpd#1] <op:+> [cmpd#2] <op:×> [dose#2]'
    )
  })
})
