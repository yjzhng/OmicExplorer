/** A text input whose find matches are highlighted, by a mirror of its text lying over it. */
import {
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useRef
} from 'react'
import { styles } from './styles'
import type { MarkRange } from './findRanges'

/** A text input whose `marks` ranges are highlighted like a find match. An input can't style part
 *  of its text, so a mirror of it — the same text, transparent, in the input's own computed font
 *  and padding, scrolled with it — lies over it, with a translucent highlight behind each range. */
export function MatchInput({
  marks,
  wrapStyle,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  marks: MarkRange[] | null
  wrapStyle?: CSSProperties
}): ReactNode {
  const inRef = useRef<HTMLInputElement>(null)
  const mirRef = useRef<HTMLSpanElement>(null)
  const sync = (): void => {
    const inp = inRef.current
    const mir = mirRef.current
    if (inp && mir) mir.scrollLeft = inp.scrollLeft
  }
  useLayoutEffect(() => {
    const inp = inRef.current
    const mir = mirRef.current
    if (!inp || !mir) return
    const cs = getComputedStyle(inp)
    mir.style.font = cs.font
    mir.style.letterSpacing = cs.letterSpacing
    mir.style.padding = cs.padding
    mir.style.borderWidth = cs.borderWidth
    mir.scrollLeft = inp.scrollLeft
  })
  const text = String(props.value ?? '')
  const pieces: ReactNode[] = []
  if (marks) {
    let at = 0
    marks.forEach(([a, b], k) => {
      if (a > at) pieces.push(text.slice(at, a))
      pieces.push(
        <mark key={k} style={styles.matchMark}>
          {text.slice(a, b)}
        </mark>
      )
      at = b
    })
    if (at < text.length) pieces.push(text.slice(at))
  }
  return (
    <span style={{ ...styles.matchWrap, ...wrapStyle }}>
      <input ref={inRef} {...props} onScroll={sync} onSelect={sync} />
      {marks && (
        <span ref={mirRef} aria-hidden style={styles.matchMirror}>
          {pieces}
        </span>
      )}
    </span>
  )
}
