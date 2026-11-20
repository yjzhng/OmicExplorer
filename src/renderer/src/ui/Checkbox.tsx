/** The app's one labelled tickbox: the box, then its label; greyed and inert when disabled. */
import type { CSSProperties, ReactNode } from 'react'

import { FORM } from './formStyles'

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  title,
  style
}: {
  label: ReactNode
  checked: boolean
  onChange?: (v: boolean) => void
  disabled?: boolean
  title?: string
  style?: CSSProperties
}): ReactNode {
  return (
    <label
      style={{
        ...FORM.checkRow,
        ...(disabled ? { opacity: 0.45, cursor: 'default' } : null),
        ...style
      }}
      title={title}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        style={{ margin: 0 }}
      />
      <span>{label}</span>
    </label>
  )
}
