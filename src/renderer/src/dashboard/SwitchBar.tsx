/** A labelled row of pill tabs, styled to match FacetedPlot's context switch-tabs, for
 *  in-plot selectors that aren't facets — e.g. a dose-response's axis or a cluster's
 *  colour-by condition. Sits at the top of the plot body, below the tile header. */
import { type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'

export function SwitchBar({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}): ReactNode {
  return (
    <div style={styles.bars}>
      <div style={styles.bar} role="tablist" aria-label={label}>
        <span style={styles.barLabel}>{label}</span>
        {options.map((o) => {
          const on = o === value
          return (
            <button
              key={o}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(o)}
              style={{ ...styles.tab, ...(on ? styles.tabActive : null) }}
            >
              {o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  bars: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 6,
    columnGap: 20,
    padding: '6px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  bar: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  barLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  tab: {
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '2px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  tabActive: { background: UI.accent, color: UI.accentText, borderColor: UI.accent }
}
