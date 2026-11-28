/**
 * The app's one number box. It always holds a number — or, `optional`, it may be left empty,
 * which means "unset" (an axis bound the plot picks itself, a cutoff that cuts nothing).
 *
 * The box keeps a draft while it's edited: it is CONTROLLED by a committed number, so without one
 * an emptied box (mid-edit, after deleting the last digit) would read as Number('') = 0 — which
 * callers clamp and write straight back, making the last digit undeletable. The draft keeps empty
 * or partial text ("-", "1e", "0.0") on screen and commits only parseable values; an optional box
 * left empty commits "unset" when it's left (blur or Enter — Escape leaves the value as it was).
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { FORM } from './formStyles'

interface Common {
  step?: number
  /** the arrow keys' step from a value, up (1) or down (−1), in place of the even `step` */
  ladder?: (v: number, dir: 1 | -1) => number
  /** where the arrow keys start from while an optional box is empty */
  ladderFrom?: number
  min?: number
  max?: number
  disabled?: boolean
  title?: string
  placeholder?: string
  style?: CSSProperties
}
type WholeProps = Common & { optional?: false; value: number; onChange: (v: number) => void }
type OptionalProps = Common & {
  optional: true
  value: number | null | undefined
  /** undefined = left empty (unset) */
  onChange: (v: number | undefined) => void
}

export function NumberInput(props: WholeProps | OptionalProps): ReactNode {
  const { step, ladder, ladderFrom, min, max, disabled, title, placeholder, style } = props
  const [draft, setDraft] = useState<string | null>(null)
  // Escape: leave without committing the empty draft.
  const cancelled = useRef(false)
  const value = props.value
  const commit = (v: number | undefined): void => {
    if (props.optional) props.onChange(v)
    else if (v !== undefined) props.onChange(v)
  }
  return (
    <input
      type="number"
      className="oe-num"
      // Numbers read right-aligned (digits line up against the unit / edge).
      style={{
        ...FORM.input,
        textAlign: 'right',
        ...(disabled ? { opacity: 0.5 } : null),
        ...style
      }}
      value={draft ?? (value == null ? '' : String(value))}
      step={step ?? (props.optional ? 'any' : 1)}
      min={min}
      max={max}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') return // empty mid-edit — keep the last committed value
        const v = Number(raw)
        if (Number.isFinite(v)) commit(v)
      }}
      onBlur={() => {
        if (props.optional && draft != null && draft.trim() === '' && !cancelled.current)
          commit(undefined)
        cancelled.current = false
        setDraft(null)
      }}
      onKeyDown={(e) => {
        const from = value ?? ladderFrom
        if (ladder && from != null && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          setDraft(null)
          commit(ladder(from, e.key === 'ArrowUp' ? 1 : -1))
        } else if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          cancelled.current = true
          setDraft(null)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
