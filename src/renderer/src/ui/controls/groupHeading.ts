import type { CSSProperties } from 'react'

/** A group's heading in a dropdown list (SelectOption.group): small, uppercase, muted — as a switch
 *  bar's label — with a little space above all but the first. Shared by Select and the axis-title
 *  picker. */
export function groupHeading(z: number, color: string, gap: boolean): CSSProperties {
  return {
    fontSize: 9 * z,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color,
    padding: `${(gap ? 7 : 3) * z}px ${8 * z}px ${2 * z}px`,
    userSelect: 'none'
  }
}

/** A marked option's row tint (SelectOption.marked): a soft neutral wash — apart from the current
 *  pick's accent one. `muted` is the palette's muted text colour (hex). */
export const markedTint = (muted: string): string => `${muted}2e`
