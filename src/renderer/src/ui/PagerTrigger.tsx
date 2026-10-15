/** The one-of-many pickers' shared trigger: ‹ [n/m name ▾] › — bare step arrows around a bordered
 *  button naming the current item, which opens the picker's own dropdown. Each picker keeps its
 *  own list (gene rows with descriptions, greyed condition levels, …) and chooses its variant:
 *  the "n/m" position readout, in subtitle style, is shown only when `pos` is given. */
import { type CSSProperties, type ReactNode, type RefObject } from 'react'

import { Chevron } from './Chevron'
import { UI } from './theme'

export function PagerTrigger({
  name,
  pos,
  open,
  onToggle,
  btnRef,
  onStep,
  canStep,
  noun,
  title,
  fontSize = 12
}: {
  /** the current item's text */
  name: ReactNode
  /** the position readout ("3/12": `index` –1 = not in the set, "–/12"), muted before the name;
   *  omit for no counter */
  pos?: { index: number; total: number }
  open: boolean
  onToggle: () => void
  btnRef: RefObject<HTMLButtonElement | null>
  /** step by ±1 (the picker wraps and skips what it can't pick) */
  onStep: (d: -1 | 1) => void
  /** more than one pickable item — the arrows are live */
  canStep: boolean
  /** what an item is, for the arrows' tooltips ("gene" → "Previous gene") */
  noun: string
  /** the button's tooltip */
  title: string
  fontSize?: number
}): ReactNode {
  const arrow = (d: -1 | 1): ReactNode => {
    const t = `${d < 0 ? 'Previous' : 'Next'} ${noun}`
    return (
      <button
        onClick={() => onStep(d)}
        disabled={!canStep}
        title={t}
        aria-label={t}
        style={{
          ...styles.arrow,
          opacity: canStep ? 1 : 0.35,
          cursor: canStep ? 'pointer' : 'default'
        }}
      >
        <Chevron deg={d < 0 ? 180 : 0} size={11} color={UI.text} />
      </button>
    )
  }
  return (
    <span style={styles.root}>
      {arrow(-1)}
      <button
        ref={btnRef}
        onClick={onToggle}
        title={title}
        aria-label={noun}
        aria-expanded={open}
        style={{ ...styles.btn, fontSize, borderColor: open ? UI.accent : UI.border }}
      >
        {pos && (
          <span style={styles.pos}>{`${pos.index >= 0 ? pos.index + 1 : '–'}/${pos.total}`}</span>
        )}
        <span style={styles.name}>{name}</span>
        <Chevron deg={open ? -90 : 90} />
      </button>
      {arrow(1)}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'inline-flex', alignItems: 'center', gap: 2, minWidth: 0, flex: '0 1 auto' },
  // A bare chevron (no chip).
  arrow: {
    background: 'transparent',
    border: 'none',
    width: 16,
    height: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    padding: 0
  },
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    maxWidth: 240,
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: '2px 10px',
    cursor: 'pointer'
  },
  // Subtitle style: smaller, regular weight, muted — the name stays the thing read.
  pos: {
    fontSize: '0.85em',
    fontWeight: 400,
    color: UI.textMuted,
    flex: '0 0 auto',
    fontVariantNumeric: 'tabular-nums'
  },
  name: {
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  }
}
