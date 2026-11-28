/** A plot's settings window holds every edit back until its Apply (Close drops them), except a
 *  setting on quick access — its switch is on the tile, so it lands as it's made. The plot's own
 *  settings are held by the window itself; this carries the rest: edits to another step (a
 *  Compare's statistic, offered in a plot's settings — Apply then re-runs it), staged as actions,
 *  each key holding one (a later stage for the same key replaces it); and which settings are on
 *  quick access, as the panels' quick-access switches report them. Outside such a window there's
 *  no provider, and the panels apply edits as usual. */
import { createContext } from 'react'

export interface ApplyStage {
  /** hold `action` until Apply (null withdraws it) */
  stage: (key: string, action: (() => void) | null) => void
  /** a setting's quick-access state, as its switch shows it (on: it applies live) */
  quick: (field: string, on: boolean) => void
}

export const ApplyStageContext = createContext<ApplyStage | null>(null)
