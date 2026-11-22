/**
 * The tutorial's state: the offer (a new user's first new project), the tour (stop by stop, on the
 * tutorial project — see demo.ts), and the note it ends on, pointing at where to replay it.
 *
 * The tour takes over the window: it sets the user's project aside in memory (unsaved work and
 * all — nothing to save first), opens the tutorial project in Flowchart, and on any ending puts the
 * project back exactly as it was, with the layout and page as they were.
 */
import { create } from 'zustand'

import { useAppSettings } from '../useAppSettings'
import { useSelection } from '../useSelection'
import { openDemoProject, restoreProject, setProjectAside, type SetAside } from './demo'
import { markTutorialOffered } from './firstRun'
import { STOPS } from './stops'

export type TutorialPhase = 'idle' | 'offer' | 'starting' | 'tour' | 'leaving' | 'end'

/** What to go back to when the tour ends. */
interface Return {
  aside: SetAside
  uiStyle: 'flow' | 'form'
}

interface TutorialState {
  phase: TutorialPhase
  /** the stop on show, while touring */
  stop: number
  ret: Return | null
  /** the last tour reached its end (Finish), rather than being left or skipped */
  finished: boolean
  /** make the offer (a new user's first project on screen) */
  offer: () => void
  /** start the tour (from the offer or the User Guide) */
  start: () => Promise<void>
  /** decline the offer */
  skip: () => void
  /** to stop `i` (Back / Next); past the last one finishes */
  go: (i: number) => void
  /** leave the tour now (Exit, Esc — or past the last stop, `finished`) */
  exit: (finished?: boolean) => Promise<void>
  /** dismiss the closing note */
  closeNote: () => void
}

export const useTutorial = create<TutorialState>((set, get) => ({
  phase: 'idle',
  stop: 0,
  ret: null,
  finished: false,
  offer: () => {
    if (get().phase === 'idle') set({ phase: 'offer' })
  },
  start: async () => {
    const { phase } = get()
    if (phase === 'starting' || phase === 'tour' || phase === 'leaving') return
    markTutorialOffered()
    const settings = useAppSettings.getState()
    const ret: Return = { aside: setProjectAside(), uiStyle: settings.uiStyle }
    set({ phase: 'starting', ret })
    // The tour points at the flowchart's controls.
    if (settings.uiStyle !== 'flow') settings.update({ uiStyle: 'flow' })
    try {
      await openDemoProject()
    } catch {
      await restoreProject(ret.aside)
      if (ret.uiStyle !== 'flow') settings.update({ uiStyle: ret.uiStyle })
      set({ phase: 'idle', ret: null })
      return
    }
    set({ phase: 'tour', stop: 0 })
    STOPS[0].enter?.()
  },
  skip: () => {
    markTutorialOffered()
    set({ phase: 'end', finished: false })
  },
  go: (i) => {
    if (get().phase !== 'tour') return
    if (i >= STOPS.length) return void get().exit(true)
    const to = Math.max(0, i)
    set({ stop: to })
    STOPS[to].enter?.()
  },
  exit: async (finished = false) => {
    const { phase, ret } = get()
    if (phase !== 'tour' && phase !== 'starting') return
    set({ phase: 'leaving' })
    useSelection.getState().clearPins()
    if (ret) {
      await restoreProject(ret.aside)
      if (ret.uiStyle !== useAppSettings.getState().uiStyle)
        useAppSettings.getState().update({ uiStyle: ret.uiStyle })
    }
    set({ phase: 'end', ret: null, stop: 0, finished })
  },
  closeNote: () => {
    if (get().phase === 'end') set({ phase: 'idle' })
  }
}))
