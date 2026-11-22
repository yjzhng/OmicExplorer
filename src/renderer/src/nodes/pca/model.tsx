import type { ReactNode } from 'react'
import { NumberInput } from '../kit/settings/controls'

/** A size box (px), as the DR's style rows (opacity is the app's OpacitySlider). */
export function styleBoxes(update: (patch: Record<string, unknown>) => void): {
  px: (field: string, value: number, title: string, min: number, max: number) => ReactNode
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
    )
  }
}
