/** A model formula's pieces, apart from how ui/Formula draws them. */

/** What a formula's function stands for, shown on hover over its name: the equation, line by
 *  line, and a note on its terms. */
export interface FormulaFn {
  eq: string[]
  note: string
}

/** The functions as the engine fits them (engine/curveFit.ts, splineFit.ts, compareModel's
 *  groups); a formula whose function means something else there (a surface's 0 → 1 shapes) passes
 *  its own. */
export const FORMULA_FNS: Record<string, FormulaFn> = {
  '4PL': {
    eq: ['f(x) = (front − back) / (1 + 10^(h·(x + pEC₅₀))) + back'],
    note: 'Four-parameter log-logistic: front and back the plateaus at low and high x, pEC₅₀ = −log₁₀ EC₅₀ the midpoint, h the slope.'
  },
  'log-logistic': {
    eq: ['f(x) = (front − back) / (1 + 10^(h·(x + pEC₅₀))) + back'],
    note: 'Four-parameter log-logistic: front and back the plateaus at low and high x, pEC₅₀ = −log₁₀ EC₅₀ the midpoint, h the slope.'
  },
  spline: {
    eq: ['f(x) = β₀ + Σₖ βₖ·Nₖ(x)'],
    note: 'Natural cubic spline: Nₖ its basis, its df set by the number of treated levels — any gentle shape, not a zig-zag. Tested against a flat line, f(x) = β₀.'
  },
  'spline surface': {
    eq: ['f(a, b) = Σⱼ Σₖ βⱼₖ·Nⱼ(a)·Nₖ(b)'],
    note: 'Tensor-product natural cubic spline over the two axes. Tested against a flat surface.'
  },
  linear: {
    eq: ['f(x) = β₀ + β₁·x'],
    note: 'A straight line (the spline with one df).'
  },
  constant: { eq: ['f(x) = β₀'], note: 'No change along this axis.' },
  group: {
    eq: ['y = μ + τ_g + ε'],
    note: 'One effect per group g — each combination of the compared conditions’ values — off the overall mean μ; the t-test compares a test group’s mean with its control’s.'
  },
  μ: {
    eq: [],
    note: 'The constant: the overall level that every term’s effect is measured from.'
  }
}

/** A surface's per-axis shapes (engine/surfaceJoint.ts): each from 0 at its baseline to 1, scaled
 *  by the response's size A. */
export const SURFACE_FNS: Record<string, FormulaFn> = {
  '4PL': {
    eq: ['S(x) = 1 / (1 + 10^(−h·(x − m)))'],
    note: 'From 0 at the baseline to 1: m the midpoint, h the slope. A, in front, is the response’s size.'
  },
  linear: {
    eq: ['L(x) = (x − x₀) / (x₁ − x₀)'],
    note: '0 at the baseline x₀, 1 at the last level x₁.'
  },
  constant: { eq: ['C(x) = 1'], note: 'No change along this axis.' }
}

/** The dose × time preset's joint 4PL (engine/surfaceJoint.ts): a dose curve whose size rises
 *  over time and whose midpoint drifts with it. */
export const DOSE_TIME_4PL: Record<string, FormulaFn> = {
  '4PL': {
    eq: [
      'e(x, u) = top(u) · S(x; m(u), h)',
      'S(x) = 1 / (1 + 10^(−h·(x − m)))',
      'top(u) = A / (1 + 10^(−k·(u − τ)))',
      'm(u) = m₀ + m₁·(u − ū)'
    ],
    note: 'x = log₁₀ dose, u = log time. S, the dose curve, runs 0 → 1 (vehicle → full response); its size top(u) rises from t₀ to A; its midpoint m drifts with time.'
  }
}

/** One piece of a formula and how it reads: the response, a variable (with its term's order: 1 a
 *  main effect, 2 a two-way interaction, …), a function or scale (4PL, spline, log₁₀), an
 *  operator, or plain text. */
export type FormulaToken =
  | { kind: 'response' | 'fn' | 'op' | 'text'; text: string }
  | { kind: 'var'; text: string; order: number }

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A formula's text as tokens. `vars` are the variables as written in it; the response is
 *  everything before " ~ ". A term is what lies between top-level "+"; its order is one more than
 *  its top-level "×" (inside brackets — group(cmpd × dose) — a × doesn't count). */
export function formulaTokens(text: string, vars: readonly string[]): FormulaToken[] {
  const out: FormulaToken[] = []
  const tilde = text.indexOf(' ~ ')
  let rest = text
  if (tilde >= 0) {
    out.push({ kind: 'response', text: text.slice(0, tilde) })
    out.push({ kind: 'op', text: ' ~ ' })
    rest = text.slice(tilde + 3)
  }
  const names = vars.filter(Boolean)
  const byLength = [...new Set(names)].sort((a, b) => b.length - a.length)
  const parts = [
    // a variable, whole words only
    ...(byLength.length ? [`(?<![\\w])(?:${byLength.map(escape).join('|')})(?![\\w])`] : []),
    // a function name before its bracket ("spline surface" one name), or a log scale before its
    // variable, or the constant μ
    '(?:spline )?[A-Za-z0-9₀-₉-]+(?=\\()|log[₀-₉]*(?= )|μ(?![\\w])',
    // operators and brackets
    '[+×·⊗(),]'
  ]
  const re = new RegExp(parts.map((p) => `(${p})`).join('|'), 'g')
  let at = 0
  for (const m of rest.matchAll(re)) {
    if (m.index > at) out.push({ kind: 'text', text: rest.slice(at, m.index) })
    const [t] = m
    if (byLength.length && m[1] !== undefined) out.push({ kind: 'var', text: t, order: 1 })
    else if (m[byLength.length ? 2 : 1] !== undefined) out.push({ kind: 'fn', text: t })
    else out.push({ kind: 'op', text: t })
    at = m.index + t.length
  }
  if (at < rest.length) out.push({ kind: 'text', text: rest.slice(at) })
  // each term's order, onto its variables
  let depth = 0
  let term: FormulaToken[] = []
  const close = (): void => {
    const order = 1 + term.filter((t) => t.kind === 'op' && t.text === '×').length
    for (const t of term) if (t.kind === 'var') t.order = order
    term = []
  }
  for (const t of out) {
    if (t.kind === 'op' && t.text === '(') depth++
    else if (t.kind === 'op' && t.text === ')') depth--
    else if (depth === 0 && t.kind === 'op' && t.text === '+') {
      close()
      continue
    }
    if (depth === 0 || t.kind === 'var') term.push(t)
  }
  close()
  return out
}
