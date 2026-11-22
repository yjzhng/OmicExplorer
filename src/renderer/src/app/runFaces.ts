/** The nav bar's Run button: what it does next and its face for each — shared by RunButton
 *  (NavBar.tsx) and the User guide, which draws the same button. */
import type { CSSProperties } from 'react'

import { UI } from '../ui/theme'
import { styles } from './styles'

/** What the Run button does next (see RunButton). */
export type RunState = 'run' | 'rerun' | 'retry' | 'stop'
type RunFace = { icon: string; title: string; bg: string; fg: string }
export const RUN_FACES: Record<RunState, RunFace> = {
  run: { icon: '▶', title: 'Run all steps', bg: UI.accent, fg: UI.accentText },
  rerun: { icon: '↻', title: 'Re-run all steps', bg: UI.accent, fg: UI.accentText },
  retry: { icon: '↻', title: 'Retry failed steps', bg: '#e15759', fg: '#fff' },
  stop: { icon: '■', title: 'Stop', bg: '#e2b93b', fg: '#1a1a1a' }
}
/** The Run button's look in a state — also drawn by the User guide. */
export function runButtonStyle(state: RunState): CSSProperties {
  const f = RUN_FACES[state]
  return { ...styles.navBtn, background: f.bg, color: f.fg, borderColor: f.bg, fontSize: 13 }
}
