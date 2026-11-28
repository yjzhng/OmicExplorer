/**
 * A numeric condition's unit chip: the unit as typed, its SI spelling and the common separators.
 */
import { type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'
import { cssVars, PALETTES, UI } from '../../../ui/app/theme'
import { useUiTheme } from '../../../ui/app/useUiTheme'
import { useFloatingMenu } from './annotationFields'
import { styles } from './styles'
import type { UnitSpec } from './units'

/** What an unpicked unit's chip says — a prompt: the import won't go on until one is picked. */
const UNIT_PROMPT = 'unit'

/** A minimal chip naming a numeric condition's unit ("unit" until one is named — a.u. is one of
 *  the choices); a click opens a box to type any unit (Enter sets it) over a list of common ones. Its clicks stay its own, so it can
 *  sit inside another clickable chip. */
export function UnitChip({
  spec,
  color,
  prompt = UNIT_PROMPT
}: {
  spec: UnitSpec
  color?: string
  /** what it says until a unit is picked (default "unit"; the Set unit rows, after their
   *  "Select unit:" tip, show a dash) */
  prompt?: string
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const [open, setOpen] = useState(false)
  const { btnRef, menuRef, rect } = useFloatingMenu(open, setOpen)
  const pick = (u: string | undefined): void => {
    spec.onChange(u)
    setOpen(false)
  }
  return (
    <>
      <span
        ref={btnRef as React.RefObject<HTMLSpanElement | null>}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Unit of these values — click to change"
        // Borderless at rest; the border shows on hover (CSS :hover — app.css `.oe-unit-chip` — which
        // the browser keeps true, unlike tracked mouseenter/leave that a re-render or a portalled
        // menu could leave stuck) and in the field colour while open.
        className="oe-unit-chip"
        style={{
          ...styles.unitChip,
          ...(spec.value ? null : styles.unitChipUnset),
          // Always set, never dropped: React removes a dropped `borderColor` by clearing it, which
          // also wipes the shorthand's transparent colour — the border then fell back to the text
          // colour, an outline that stayed after a unit was picked.
          borderColor: open ? (color ?? UI.border) : 'transparent'
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        {spec.value ?? prompt}
      </span>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            // Portalled, but React still bubbles its events up the component tree — keep them from
            // reaching a host chip (a condition chip would otherwise arm on every pick).
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...cssVars(PALETTES[mode]),
              ...styles.dropdownMenu,
              ...styles.unitMenu,
              left: window.innerWidth - rect.right - rect.width,
              top: rect.top
            }}
          >
            <input
              autoFocus
              aria-label="unit"
              placeholder="type a unit"
              defaultValue={spec.value ?? ''}
              style={styles.unitInput}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const v = e.currentTarget.value.trim()
                pick(v || undefined)
              }}
            />
            {spec.options.map((u) => {
              const on = u === spec.value
              return (
                <button
                  key={u}
                  role="option"
                  aria-selected={on}
                  style={{ ...styles.unitItem, ...(on ? styles.unitItemOn : null) }}
                  onClick={() => pick(u)}
                >
                  {u}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
