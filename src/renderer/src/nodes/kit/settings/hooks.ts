import { createContext, useEffect, useState, type ReactNode } from 'react'
import { type ConditionKey } from '../../../engine'
import { locationOf } from '../../../graph/state/shared'
import { useGraph } from '../../../graph/store'

/** The preset conditions, as a fallback where the data's own condition list isn't known yet.
 *  Anywhere the real list is reachable (a tile's upstream result), use that instead — it carries
 *  the custom conditions too. */
export const CONDS: ConditionKey[] = ['cell', 'cmpd', 'dose', 'time']
/** Whether menus draw at screen scale rather than the canvas zoom: true inside a config panel, which
 *  is always at screen scale (beside its tile it's drawn above the canvas, out of its zoom —
 *  GraphNode; in the form workflow it's off the canvas), so a menu matches the panel it opens from. A select on a
 *  tile itself (outside a panel) still follows the canvas zoom. */
export const ScreenScale = createContext(false)

/** The sections the settings window itself supplies to a plot's settings (graph/dialogs/NodeConfigPanel):
 *  the legend switch (General's last row), and the shared Axes and lines section — built with the plot's own
 *  whole-plot rows (an axis scale, a reference line) in it. PlotSections places them in the one
 *  order every plot follows. */
export interface PlotWindowSlots {
  legend?: ReactNode
  axes?: (plotRows?: ReactNode) => ReactNode
}
export const PlotWindow = createContext<PlotWindowSlots>({})
// ── per-kind panels ─────────────────────────────────────────────────────────────
/** An input file's text, read from the data folder — null while it's being read, or when no file
 *  is named or it can't be read. Re-read when the name (or the data folder) changes. */
export function useInputText(name: string | null | undefined): string | null {
  const dir = useGraph((s) => s.dataDir)
  const [got, setGot] = useState<{ key: string; text: string } | null>(null)
  const key = `${dir ?? ''}|${name ?? ''}`
  useEffect(() => {
    if (!dir || !name) return
    let live = true
    const wf = locationOf(useGraph.getState())?.scope
    window.api
      .readDataFile(dir, name, wf)
      .then((text) => {
        if (live && text != null) setGot({ key, text })
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [dir, name, key])
  return got && got.key === key ? got.text : null
}
