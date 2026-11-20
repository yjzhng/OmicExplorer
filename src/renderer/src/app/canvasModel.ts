import type { Viewport } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { useGraph } from '../graph/store'

export const CONNECTION_LINE: CSSProperties = {
  stroke: '#7c7c8c',
  strokeWidth: 2,
  strokeDasharray: '6 4',
  opacity: 0.85
}
/** ⌘ on macOS, Ctrl+ elsewhere — for the shortcut the canvas menu names. */
export const MOD = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+'
export const plural = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`
/** "3 tiles", "3 tiles and 1 group" — what a copy holds. */
export const countText = (tiles: number, groups: number): string =>
  groups ? `${plural(tiles, 'tile')} and ${plural(groups, 'group')}` : plural(tiles, 'tile')
/** Each selection-bar action as its button says it's done (a tick, for a moment). */
export const ACT_DONE: Record<string, string> = {
  Group: 'Grouped',
  Ungroup: 'Ungrouped',
  Tidy: 'Tidied',
  Cascade: 'Cascaded',
  Expand: 'Expanded',
  Collapse: 'Collapsed',
  Duplicate: 'Duplicated',
  Copy: 'Copied'
}
/** Each workflow's last canvas view (pan + zoom), for the session: the canvas unmounts while
 *  Results is shown, and coming back lands where it was left rather than re-fitted. */
export const lastViewports = new Map<string, Viewport>()
export const viewportKey = (): string => {
  const s = useGraph.getState()
  return `${s.activeFolderId ?? ''}:${s.activeWorkflowId ?? ''}`
}
