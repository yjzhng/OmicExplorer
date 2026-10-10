/** Changes a settings window holds back until its Apply — for edits that need a re-run (a
 *  Compare's statistic, offered in a plot's settings), so tweaking them doesn't discard the result
 *  under the open window, and Apply then re-runs it. Each key holds one pending action (a later
 *  stage for the same key replaces it); Close drops them all. Outside such a window there's no
 *  provider, and the panels apply edits as usual. */
import { createContext } from 'react'

export interface ApplyStage {
  /** hold `action` until Apply (null withdraws it) */
  stage: (key: string, action: (() => void) | null) => void
}

export const ApplyStageContext = createContext<ApplyStage | null>(null)
