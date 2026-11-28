/**
 * The app's one labelled setting: a label (with an optional (i)) and its control. Settings panels,
 * dialogs and windows all use it; `layout` says how the two sit:
 *
 * - `row` (default) — the label in a fixed column on the left, the control filling the rest;
 * - `stack` — the label above, the control full width under it (a narrow modal's choices);
 * - `grid` — two cells of the caller's two-column grid (a selector dialog's rows).
 */
import type { ReactNode } from 'react'

import { FORM } from './formStyles'
import { InfoTip } from './InfoTip'

export function Field({
  label,
  top,
  aside,
  info,
  labelAside,
  labelWidth,
  layout = 'row',
  children
}: {
  label: string
  /** top-align the label (for a multi-line control, e.g. the effect-size rows; in a grid, level
   *  with the control's first line) */
  top?: boolean
  /** a small control right of the field (e.g. the quick-access toggle) */
  aside?: ReactNode
  /** what the setting does, as an (i) tip beside the label */
  info?: ReactNode
  /** a small control beside the label, in place of the (i) tip (e.g. one opening a window) */
  labelAside?: ReactNode
  /** the label column's width, px (row layout; default 90) */
  labelWidth?: number
  layout?: 'row' | 'stack' | 'grid'
  children: ReactNode
}): ReactNode {
  const name = (
    <>
      {label}
      {info != null && (
        <span style={FORM.fieldInfo}>
          <InfoTip label={`About ${label}`}>{info}</InfoTip>
        </span>
      )}
      {labelAside != null && <span style={FORM.fieldInfo}>{labelAside}</span>}
    </>
  )
  if (layout === 'grid')
    return (
      <>
        <span
          style={top ? { ...FORM.fieldGridLabel, ...FORM.fieldGridLabelTop } : FORM.fieldGridLabel}
        >
          {name}
        </span>
        <span style={FORM.fieldGridBody}>
          {children}
          {aside}
        </span>
      </>
    )
  if (layout === 'stack')
    return (
      <div style={FORM.fieldStack}>
        <div style={FORM.fieldStackLabel}>{name}</div>
        {children}
        {aside}
      </div>
    )
  return (
    <div style={{ ...FORM.field, ...(top ? { alignItems: 'flex-start' } : null) }}>
      <label
        style={{
          ...FORM.fieldLabel,
          ...(labelWidth ? { width: labelWidth, flex: `0 0 ${labelWidth}px` } : null),
          ...(top ? { paddingTop: 5 } : null)
        }}
      >
        {name}
      </label>
      {/* minWidth:0 lets a flex child (e.g. the raw-data Select) shrink and ellipsis-truncate a long
          filename instead of growing past the fixed-width panel and being clipped by its border. */}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {aside}
    </div>
  )
}
