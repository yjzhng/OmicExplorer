/** A numeric condition's unit as the unit chip reads it, and the common separators. */
import {
  type CondUnits,
  DOSE_UNIT_SUGGESTIONS,
  TIME_UNIT_SUGGESTIONS
} from '../../../graph/config/units'
import type { Field } from './fields'

/** A numeric condition's unit, for a UnitChip: dose and time have one, every other field none. Any
 *  text is a unit; `options` are suggestions. */
export interface UnitSpec {
  value: string | undefined
  options: readonly string[]
  onChange: (u: string | undefined) => void
}
export function unitSpec(
  f: Field,
  units: CondUnits,
  onUnits: (u: CondUnits) => void,
  /** the custom conditions declared numeric: each takes a unit too (keyed `@name`) */
  numeric: readonly string[] = []
): UnitSpec | undefined {
  if (f === 'dose')
    return {
      value: units.dose,
      options: DOSE_UNIT_SUGGESTIONS,
      onChange: (u) => onUnits({ dose: u })
    }
  if (f === 'time')
    return {
      value: units.time,
      options: TIME_UNIT_SUGGESTIONS,
      onChange: (u) => onUnits({ time: u })
    }
  if (numeric.includes(f)) {
    const key = `@${f}` as const
    return {
      value: units[key],
      options: [...new Set([...DOSE_UNIT_SUGGESTIONS, ...TIME_UNIT_SUGGESTIONS, '°C'])],
      onChange: (u) => onUnits({ [key]: u })
    }
  }
  return undefined
}

/** The separators offered by name in the Conditions step's dropdown (then custom, which shows its
 *  text in quotes beside it). */
export const COMMON_SEPARATORS: Array<{ value: string; label: string }> = [
  { value: '_', label: 'underscore' },
  { value: '-', label: 'hyphen' },
  { value: ' ', label: 'space' }
]
