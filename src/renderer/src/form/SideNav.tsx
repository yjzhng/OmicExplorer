/**
 * The left nav shared by both form-layout pages: the workflow's steps and the results' plots.
 *
 * One component rather than two so the two pages stay visually identical — they differ only in what
 * "active" means (the page you're on vs the section you've scrolled to), which is the caller's
 * business. Consecutive items sharing a `group` are headed once, so the heading marks a real run;
 * callers must therefore emit items already grouped.
 *
 * Selecting an item chips whatever it is wired to as its `input` or `output`, so the neighbourhood
 * of the step you're on is both visible and NAMED — which way a neighbour sits is the part a
 * highlight can't say. Nothing else about those rows changes: only the selection is filled.
 */
import { useState, type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'
import type { Wiring } from './outline'

export interface SideNavItem {
  /** stable identity, and what `onPick` reports */
  key: string
  label: string
  /** heading this item sits under; a change from the previous item starts a new heading. Omit it
   *  for a flat list — a single heading over every row says nothing. */
  group?: string
  /** hover text — the place to put whatever the truncated label drops */
  title?: string
  /** how this item is wired to the selected one; chipped after the label, absent when unrelated */
  relation?: Wiring
}

/** Row and heading heights, so the list keeps an even rhythm. */
const ROW = 26
const HEAD = 26

export function SideNav({
  items,
  activeKey,
  onPick,
  ariaLabel,
  heading,
  width
}: {
  items: SideNavItem[]
  activeKey: string | null
  onPick: (key: string) => void
  ariaLabel: string
  /** panel title, shown above the list. Distinct from an item's `group`: this names the column
   *  itself, so it stands whether or not the list has anything in it. */
  heading?: string
  /** set by the caller, which owns the splitter that resizes it */
  width: number
}): ReactNode {
  const rows = items.map((it, i) => ({
    it,
    newGroup: it.group !== undefined && (i === 0 || items[i - 1].group !== it.group)
  }))
  // Inline styles have no `:hover`, so the pointer's row is tracked here. One piece of state for
  // the list rather than one per row: only ever one row is under the pointer.
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <nav className="oe-scroll" style={{ ...styles.nav, width }} aria-label={ariaLabel}>
      {heading && <div style={styles.heading}>{heading}</div>}
      <div style={styles.items}>
        {rows.map(({ it, newGroup }, i) => {
          const on = it.key === activeKey
          return (
            <div key={it.key}>
              {newGroup && <div style={styles.group}>{it.group}</div>}
              <button
                onClick={() => onPick(it.key)}
                onMouseEnter={() => setHovered(it.key)}
                onMouseLeave={() => setHovered((h) => (h === it.key ? null : h))}
                aria-current={on ? 'true' : undefined}
                data-relation={!on ? it.relation : undefined}
                title={it.title ?? it.label}
                style={{
                  ...styles.item,
                  // Same three-step hierarchy as the step sections: resting, hovered, selected —
                  // hover staying below selected so the pointer never looks like it has chosen.
                  background: on ? UI.accent : hovered === it.key ? UI.panel : 'transparent',
                  color: on ? UI.accentText : UI.text
                }}
              >
                <span style={{ ...styles.index, opacity: on ? 0.85 : 0.5 }}>{i + 1}</span>
                <span style={styles.label}>{it.label}</span>
                {!on && it.relation && <span style={styles.chip}>{it.relation}</span>}
              </button>
            </div>
          )
        })}
      </div>
    </nav>
  )
}

const styles: Record<string, CSSProperties> = {
  nav: {
    flex: '0 0 auto',
    // The page has no global border-box, so without this the set width excludes the padding and
    // the column renders 16px wider than the splitter thinks it is.
    boxSizing: 'border-box',
    overflowY: 'auto',
    // No border: the Splitter beside it draws that line, and owns it as a drag handle.
    padding: '10px 8px',
    display: 'flex',
    flexDirection: 'column'
  },
  items: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  heading: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: UI.textMuted,
    padding: '2px 8px 8px'
  },
  group: {
    height: HEAD,
    display: 'flex',
    alignItems: 'flex-end',
    paddingBottom: 4,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: ROW,
    textAlign: 'left',
    padding: '0 8px',
    borderRadius: 6,
    border: '1px solid transparent',
    fontSize: 12,
    cursor: 'pointer'
  },
  index: { fontSize: 10, fontVariantNumeric: 'tabular-nums', flex: '0 0 auto' },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chip: {
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 8,
    border: `1px solid ${UI.border}`,
    color: UI.textMuted,
    flex: '0 0 auto'
  }
}
