/** A labelled row of pill tabs, styled to match FacetedPlot's context switch-tabs, for
 *  in-plot selectors that aren't facets — e.g. a dose-response's axis or a cluster's
 *  colour-by condition. Sits at the top of the plot body, below the tile header. */
import { type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'

export function SwitchBar({
  label,
  value,
  options,
  optionLabel,
  onChange
}: {
  label: string
  value: string
  options: readonly string[]
  /** display text for an option; defaults to the option itself (a condition key needs `condLabel`
   *  so a custom condition reads `genotype`, not `@genotype`) */
  optionLabel?: (o: string) => string
  onChange: (v: string) => void
}): ReactNode {
  return (
    <div style={styles.bars}>
      <div style={styles.bar}>
        <span style={styles.barLabel}>{label}</span>
        <ToggleSwitch
          size="sm"
          label={label}
          value={value}
          options={options.map((o) => ({ value: o, label: optionLabel ? optionLabel(o) : o }))}
          onChange={onChange}
        />
      </div>
    </div>
  )
}

/** A labelled on/off in the same strip as a SwitchBar (e.g. a table's Colour), so a row of them
 *  reads as one: same label, same padding and rule. */
export function SwitchBarToggle({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}): ReactNode {
  return (
    <div style={styles.bars}>
      <div style={styles.bar}>
        <span style={styles.barLabel}>{label}</span>
        <OnOffSwitch on={on} onChange={onChange} label={label} />
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
  }
}
