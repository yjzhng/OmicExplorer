/** The Conditions stage's painter: pick a field, then click a sample name's tokens to tag them. */
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { UI } from '../../../ui/app/theme'
import { InfoTip } from '../../../ui/controls/InfoTip'
import type { ColorOf, Field } from './fields'
import { CONNECTOR_GAP, IconPaint } from './NamePainting'
import { connectorPath } from './geometry'
import { styles } from './styles'

/** The Set condition chip that marks the samplesheet column naming the samples (samplesheet mode),
 *  and its colour: a grey, as it's no condition. */
export const NAME_CHIP = '(sample name)'
export const NAME_CHIP_COLOR = '#8c8c8c'

/** Map conditions' painter: the Set condition chips — click one to arm it, again to put it down —
 *  over a table (`children`) the armed condition is painted onto, with a dashed connector in each
 *  condition's colour from its chip to where it's painted: the element marked
 *  `data-ruler-field={condition}` in the table (the ruler bar over a name's tokens, a samplesheet
 *  column's header). Redrawn as the table scrolls or the panel resizes. `nameChip` adds the
 *  samplesheet's Sample name chip, ahead of the conditions. */
export function ConditionPainter({
  activeFields,
  colorOf,
  armed,
  setArmed,
  applied,
  info,
  nameChip,
  children
}: {
  activeFields: Field[]
  colorOf: ColorOf
  armed: Field | null
  setArmed: (f: Field | null) => void
  /** whether a condition is painted anywhere yet (its chip is tinted) */
  applied: (f: Field) => boolean
  /** how painting works, in the (i) */
  info: ReactNode
  nameChip?: { on: boolean; applied: boolean; onClick: () => void }
  children: ReactNode
}): ReactNode {
  const tone = (f: Field): string => (f === NAME_CHIP ? NAME_CHIP_COLOR : colorOf(f))
  // The connectors from each Set condition chip to its painted region (in the ruler), measured
  // from the live layout (see connectorPath). A region scrolled out of the table's view sideways
  // gets no line.
  const mapRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef(new Map<Field, HTMLElement>())
  const [connectors, setConnectors] = useState<Array<{ field: Field; d: string; head: string }>>([])
  const drawConnectors = useCallback((): void => {
    const box = mapRef.current
    if (!box) return
    const at = box.getBoundingClientRect()
    const view = box.querySelector('.oe-tablescroll')?.getBoundingClientRect()
    const next: Array<{ field: Field; d: string; head: string }> = []
    for (const [field, chip] of chipRefs.current) {
      const bar = box.querySelector(`[data-ruler-field="${CSS.escape(field)}"]`)
      if (!bar) continue
      const c = chip.getBoundingClientRect()
      const b = bar.getBoundingClientRect()
      const x2 = b.left + b.width / 2
      if (view && (x2 < view.left || x2 > view.right)) continue
      const x1 = Math.round(c.left + c.width / 2 - at.left)
      // Starting a little below the chip, not touching it.
      const y1 = Math.round(c.bottom + CONNECTOR_GAP - at.top)
      const tx = Math.round(x2 - at.left)
      // The tip a small gap above the token's text in the first row: past the region's bottom by
      // the header's bottom padding (2) and border (1) and the row's top padding (3).
      const ty = Math.round(b.bottom + 6 - CONNECTOR_GAP - at.top)
      const { line, head } = connectorPath(x1, y1, tx, ty)
      next.push({ field, d: line, head })
    }
    setConnectors((prev) =>
      prev.length === next.length &&
      prev.every(
        (p, k) => p.d === next[k].d && p.head === next[k].head && p.field === next[k].field
      )
        ? prev
        : next
    )
  }, [])
  // After every render (chips, painted regions, columns can all move), and on resize.
  useLayoutEffect(drawConnectors)
  useLayoutEffect(() => {
    const box = mapRef.current
    if (!box) return
    const ro = new ResizeObserver(drawConnectors)
    ro.observe(box)
    return () => ro.disconnect()
  }, [drawConnectors])
  // The chips: the Sample name one first (samplesheet mode), then the conditions switched on.
  const chips = [
    ...(nameChip
      ? [
          {
            f: NAME_CHIP,
            ...nameChip,
            isApplied: nameChip.applied,
            title: 'The column naming each sample'
          }
        ]
      : []),
    ...activeFields.map((f) => ({
      f,
      on: armed === f,
      isApplied: applied(f),
      onClick: () => setArmed(armed === f ? null : f),
      title: applied(f) ? `${f} applied — click to re-tag` : `Tag ${f}`
    }))
  ]
  return (
    <div ref={mapRef} style={styles.mapArea} onScrollCapture={drawConnectors}>
      {/* Pinned under the title while the table scrolls; only the conditions switched on are
          offered. */}
      <div style={styles.chips}>
        <span style={styles.paintLabel}>
          <IconPaint />
          Set condition
          <InfoTip label="How to map conditions">{info}</InfoTip>
        </span>
        {chips.map(({ f, on, isApplied, onClick, title }) => {
          // An applied chip is tinted in its colour; the armed one is the SAME colour but stronger,
          // so the current pick stands out from the merely-applied ones.
          const col = tone(f)
          return (
            <button
              key={f}
              ref={(el) => {
                if (el) chipRefs.current.set(f, el)
                else chipRefs.current.delete(f)
              }}
              onClick={onClick}
              title={title}
              style={{
                ...styles.chip,
                background: on ? `${col}aa` : isApplied ? `${col}26` : 'transparent',
                color: UI.text,
                borderColor: on || isApplied ? col : UI.border
              }}
            >
              <span style={{ ...styles.chipDot, background: col }} />
              {f === NAME_CHIP ? 'sample name' : f}
            </button>
          )
        })}
        {activeFields.length === 0 && (
          <span style={styles.chipsLabel}>Switch on a condition on the left to map it.</span>
        )}
      </div>
      {children}
      <svg style={styles.connectors} aria-hidden>
        {connectors.map((c) => (
          <path
            key={c.field}
            d={c.d}
            fill="none"
            stroke={tone(c.field)}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {connectors.map((c) => (
          <path key={`${c.field}-head`} d={c.head} fill={tone(c.field)} />
        ))}
      </svg>
    </div>
  )
}
