/** App-level view mode: the pipeline Canvas vs. the full-screen Results dashboard,
 *  plus the dashboard's edit mode (gates panel drag/resize, wired in a later stage). */
import { create } from 'zustand'

export type AppView = 'canvas' | 'results'

interface AppViewState {
  view: AppView
  editMode: boolean
  setView: (view: AppView) => void
  toggleEdit: () => void
}

export const useAppView = create<AppViewState>((set) => ({
  view: 'canvas',
  editMode: false,
  // Leaving Results also leaves edit mode, so returning starts clean.
  setView: (view) => set((s) => ({ view, editMode: view === 'results' ? s.editMode : false })),
  toggleEdit: () => set((s) => ({ editMode: !s.editMode }))
}))
