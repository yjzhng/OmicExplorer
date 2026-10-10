/** The line chevron used for expand / fold toggles (the gene selector's nav button, its menu's
 *  tree, form-mode group headers). Points right at 0°; rotate with `deg`. */
import type { ReactNode } from 'react'

import { UI } from './theme'

export function Chevron({
  deg,
  size = 11,
  color = UI.textMuted
}: {
  deg: number
  size?: number
  color?: string
}): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ flex: '0 0 auto', color, transform: `rotate(${deg}deg)` }}
    >
      <polyline
        points="3.5,1.5 7,5 3.5,8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
