import type { CSSProperties, ReactNode } from 'react'

import { HoverTip } from './InfoTip'
import { UI } from '../app/theme'
import { FORMULA_FNS, formulaTokens, type FormulaFn } from './formulaModel'

/** The gap around an operator: "+" wider, so the terms stand apart, and "×" (· ⊗) narrower, so
 *  an interaction holds together — "A×B  +  C×D". Copied text keeps its plain spaces. */
const GAP: Record<string, CSSProperties> = {
  '+': { letterSpacing: '0.35em' },
  '×': { letterSpacing: '-0.25em' },
  '·': { letterSpacing: '-0.25em' },
  '⊗': { letterSpacing: '-0.25em' }
}

/** The gap between a log scale and its variable ("log₁₀ dose"): a hair, so they read as one. */
const LOG_GAP: CSSProperties = { letterSpacing: '-0.4em' }

/** Text with its log scales typeset: the base a real subscript (the font's ₁₀ glyphs take a full
 *  monospace cell each, a gap inside the base) and the space after it a hair. */
function withLogs(text: string): ReactNode {
  const out: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(/log([₀-₉]+)?( ?)/g)) {
    out.push(text.slice(at, m.index), 'log')
    if (m[1])
      out.push(
        <sub key={`b${m.index}`} style={styles.base}>
          {[...m[1]].map((c) => c.charCodeAt(0) - 0x2080).join('')}
        </sub>
      )
    if (m[2])
      out.push(
        <span key={`s${m.index}`} style={LOG_GAP}>
          {' '}
        </span>
      )
    at = m.index + m[0].length
  }
  out.push(text.slice(at))
  return out
}

/**
 * A model formula ("log₂ abundance ~ cmpd + dose + cmpd × dose"), subtly coloured and spaced to
 * read at a glance: the variables by their term's kind — main effects one hue, two-way
 * interactions another, three-way a third — the functions, scales and operators muted, the
 * response plain; wide gaps between terms, narrow ones inside an interaction.
 */
export function Formula({
  text,
  vars,
  fns
}: {
  text: string
  vars: readonly string[]
  /** functions meaning something else here than in FORMULA_FNS (a surface's shapes) */
  fns?: Partial<Record<string, FormulaFn>>
}): ReactNode {
  const tokens = formulaTokens(text, vars)
  // a space token's operator: the one it sits beside
  const opBeside = (i: number): string | undefined =>
    [tokens[i - 1], tokens[i + 1]].find((t) => t?.kind === 'op' && GAP[t.text])?.text
  return (
    <>
      {tokens.map((t, i) => {
        const fn = t.kind === 'fn' ? (fns?.[t.text] ?? FORMULA_FNS[t.text]) : undefined
        if (fn)
          return (
            <HoverTip key={i} tip={<FnTip fn={fn} />} style={styles.fn}>
              {withLogs(t.text)}
            </HoverTip>
          )
        return (
          <span
            key={i}
            style={
              t.kind === 'var'
                ? { color: UI.term(t.order) }
                : t.kind === 'fn' || t.kind === 'op'
                  ? { color: UI.textMuted }
                  : t.kind === 'text' && /^ +$/.test(t.text)
                    ? tokens[i - 1]?.kind === 'fn' && tokens[i - 1].text.startsWith('log')
                      ? LOG_GAP
                      : GAP[opBeside(i) ?? '']
                    : undefined
            }
          >
            {t.kind === 'response' || t.kind === 'fn' ? withLogs(t.text) : t.text}
          </span>
        )
      })}
    </>
  )
}

function FnTip({ fn }: { fn: FormulaFn }): ReactNode {
  return (
    <>
      {fn.eq.map((l) => (
        <div key={l} style={styles.eq}>
          {l}
        </div>
      ))}
      <div style={fn.eq.length ? styles.note : undefined}>{fn.note}</div>
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  // a function with an equation behind it: muted like the rest, a dotted rule saying "hover me"
  fn: {
    display: 'inline',
    color: UI.textMuted,
    textDecoration: 'underline dotted',
    textUnderlineOffset: 3,
    cursor: 'help'
  },
  eq: { fontFamily: 'ui-monospace, monospace', color: UI.text },
  // a log's base: proportional digits, small, not raising the line
  base: { fontFamily: 'system-ui, sans-serif', fontSize: '0.72em', lineHeight: 0 },
  note: { marginTop: 6 }
}
