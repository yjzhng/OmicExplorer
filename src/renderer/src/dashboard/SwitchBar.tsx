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
        {/* Fused pill, matching the main-nav Workflow/Results switch: a rounded track whose
            active segment is a rounded chip (accent fill). */}
        <div style={styles.pill}>
          {options.map((o) => {
            const on = o === value
            return (
              <button
                key={o}
                role="tab"
                aria-selected={on}
                onClick={() => onChange(o)}
                style={{
                  ...styles.tab,
                  background: on ? UI.accent : 'transparent',
                  color: on ? UI.accentText : UI.text
                }}
              >
                {o}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  bars: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 4,
    columnGap: 14,
    padding: '3px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  bar: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  barLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  pill: {
    display: 'inline-flex',
    gap: 2,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: 2,
    background: UI.panel,
    flex: '0 0 auto'
  },
  tab: {
    border: 'none',
    borderRadius: 999,
    padding: '2px 11px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  }
}
