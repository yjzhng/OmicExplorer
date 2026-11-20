import type { ReactNode } from 'react'
import { UI } from '../../ui/theme'
import { NumberInput } from '../kit/settings/controls'

/** A size box (px) and an opacity box (%), as the DR's style rows. */
export function styleBoxes(update: (patch: Record<string, unknown>) => void): {
  px: (field: string, value: number, title: string, min: number, max: number) => ReactNode
  pct: (field: string, value: number, title: string) => ReactNode
} {
  return {
    px: (field, value, title, min, max) => (
      <div style={{ width: 52, flex: '0 0 auto' }}>
        <NumberInput
          value={value}
          step={field === 'arrowSize' ? 0.25 : 0.5}
          min={min}
          max={max}
          title={title}
          onChange={(v) => update({ [field]: Math.min(max, Math.max(min, Math.round(v * 4) / 4)) })}
        />
      </div>
    ),
    pct: (field, value, title) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, width: 64, flex: '0 0 auto' }}>
        <NumberInput
          value={Math.round(value * 100)}
          step={10}
          min={5}
          max={100}
          title={title}
          onChange={(v) => update({ [field]: Math.min(100, Math.max(5, Math.round(v))) / 100 })}
        />
        <span style={{ color: UI.textMuted, fontSize: 12 }}>%</span>
      </div>
    )
  }
}
