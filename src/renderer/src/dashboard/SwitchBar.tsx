/** A labelled row of pill tabs, styled to match FacetedPlot's context switch-tabs, for
 *  in-plot selectors that aren't facets — e.g. a dose-response's axis or a cluster's
 *  colour-by condition. Sits at the top of the plot body, below the tile header. */
import { type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'
import { ChoiceSwitch } from '../ui/ChoiceSwitch'
import { OnOffSwitch } from '../ui/ToggleSwitch'

export function SwitchBar({
  label,
  value,
  options,
  optionLabel,
  onChange,
  inline,
  optionDisabled
}: {
  label: string
  value: string
  options: readonly string[]
  /** display text for an option; defaults to the option itself (a condition key needs `condLabel`
   *  so a custom condition reads `genotype`, not `@genotype`) */
  optionLabel?: (o: string) => string
  onChange: (v: string) => void
  /** inside another row (e.g. the gene switcher's): no strip of its own — no padding, no rule */
  inline?: boolean
  /** an option that can't be picked (greyed): the reason, shown as its tooltip; else undefined */
  optionDisabled?: (o: string) => string | undefined
}): ReactNode {
  return (
    <div
      className={inline ? undefined : 'oe-switch-strip'}
      style={inline ? styles.inline : styles.bars}
    >
      <div style={styles.bar}>
        <span style={styles.barLabel}>{label}</span>
        {/* Pills, or a searchable dropdown past PILL_CAP options (e.g. many condition levels). */}
        <ChoiceSwitch
          size="sm"
          label={label}
          value={value}
          options={options.map((o) => {
            const why = optionDisabled?.(o)
            return {
              value: o,
              label: optionLabel ? optionLabel(o) : o,
              ...(why ? { disabled: true, title: why } : null)
            }
          })}
          onChange={onChange}
        />
      </div>
    </div>
  )
}

/** Several inline SwitchBars in one strip: side by side while the tile is wide enough, wrapping
 *  onto the next line (not cropped) when it isn't — as the facet bars do. */
export function SwitchStrip({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="oe-switch-strip" style={styles.bars}>
      {children}
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
    <div className="oe-switch-strip" style={styles.bars}>
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
    flex: '0 0 auto'
  },
  inline: { display: 'flex', alignItems: 'center', flex: '0 0 auto' },
  bar: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  barLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  }
}
