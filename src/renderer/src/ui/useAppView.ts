/** App-level view mode: the pipeline Canvas vs. the full-screen Results dashboard. */
import { create } from 'zustand'

export type AppView = 'canvas' | 'results'

interface AppViewState {
  view: AppView
  /** Active Results tab (analysis-group id), kept here so it survives Results unmounting when
   *  you switch to the canvas — returning lands on the same tab instead of resetting to the first. */
  resultsTab: string | null
  setView: (view: AppView) => void
  setResultsTab: (id: string) => void
}

export const useAppView = create<AppViewState>((set) => ({
  view: 'canvas',
  resultsTab: null,
  setView: (view) => set({ view }),
  setResultsTab: (id) => set({ resultsTab: id })
}))
