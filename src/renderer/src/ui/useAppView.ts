/** App-level view mode: the pipeline Canvas vs. the full-screen Results dashboard. */
import { create } from 'zustand'
import { MOTION_MS, NOTICE_MS } from './theme'

export type AppView = 'canvas' | 'results'

interface AppViewState {
  view: AppView
  /** Active Results tab (analysis-group id), kept here so it survives Results unmounting when
   *  you switch to the canvas — returning lands on the same tab instead of resetting to the first. */
  resultsTab: string | null
  /** The tile to cue on the canvas: the Results tab you just came back from (its plot tile's id).
   *  `key` restarts the cue on each return; cleared once it has played (endCue), so a tile
   *  mounting later doesn't play it again. */
  tileCue: { id: string; key: number } | null
  /** The Results tab chip to cue: the tab just jumped to from the canvas. Same shape as tileCue. */
  tabCue: { id: string; key: number } | null
  setView: (view: AppView) => void
  setResultsTab: (id: string) => void
  /** From the canvas straight to one tab (a plot tile's jump, Results → with a plot tile
   *  selected), cueing its chip so it's found in a long tab row. */
  openResultsTab: (id: string) => void
  /** Results' "← Workflow": back to the canvas, cueing the tile of the tab you were on. */
  backToWorkflow: () => void
  /** A cue has played out (its animationend): clear it, unless a newer one has replaced it. */
  endCue: (which: 'tileCue' | 'tabCue', key: number) => void
}

/** A cue clears when its animation ends (endCue), not on a timer: the timer starts at the click,
 *  the animation only once the page it's on has mounted — on a large dashboard that's later, and
 *  a timer cut the fade out short. This is only the fallback for a cue that never got to play
 *  (its page left, its tile gone), well after any that did. */
const CUE_FALLBACK_MS = MOTION_MS.page + NOTICE_MS.cue + 5000

let cueTimer: ReturnType<typeof setTimeout> | undefined
let tabCueTimer: ReturnType<typeof setTimeout> | undefined

export const useAppView = create<AppViewState>((set, get) => ({
  view: 'canvas',
  resultsTab: null,
  tileCue: null,
  tabCue: null,
  setView: (view) => set({ view }),
  setResultsTab: (id) => set({ resultsTab: id }),
  openResultsTab: (id) => {
    clearTimeout(tabCueTimer)
    set({ view: 'results', resultsTab: id, tabCue: { id, key: (get().tabCue?.key ?? 0) + 1 } })
    // (the cue waits out the slide across, then plays)
    tabCueTimer = setTimeout(() => set({ tabCue: null }), CUE_FALLBACK_MS)
  },
  backToWorkflow: () => {
    const { resultsTab, tileCue } = get()
    clearTimeout(cueTimer)
    set({
      view: 'canvas',
      tileCue: resultsTab ? { id: resultsTab, key: (tileCue?.key ?? 0) + 1 } : null
    })
    // (the cue waits out the slide back, then plays)
    if (resultsTab) cueTimer = setTimeout(() => set({ tileCue: null }), CUE_FALLBACK_MS)
  },
  endCue: (which, key) => {
    if (get()[which]?.key === key) set({ [which]: null })
  }
}))
