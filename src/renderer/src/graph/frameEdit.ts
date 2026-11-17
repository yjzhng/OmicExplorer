/** Editing a canvas group's members (the pencil on its frame): while one is edited, a click on a
 *  tile — or on another group's frame, for that group whole — outside it marks it to add, a click on
 *  one inside marks it to take out — a second click unmarks it. Nothing changes until the ✓ (one undo step); Esc drops the marks. Transient — not
 *  saved with the workflow. */
import { create } from 'zustand'

import { frameHolds } from './frames'
import { useGraph } from './store'

export interface FrameEdit {
  /** the frame being edited */
  id: string
  add: string[]
  remove: string[]
}

interface FrameEditState {
  edit: FrameEdit | null
  start: (id: string) => void
  /** Mark / unmark a tile or a group: to take out when it's inside the frame, to add when it isn't
   *  (never a group holding the frame). */
  toggle: (item: string) => void
  /** Apply the marks to the frame and stop editing. */
  finish: () => void
  cancel: () => void
}

const flip = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

export const useFrameEdit = create<FrameEditState>((set, get) => ({
  edit: null,
  start: (id) => set({ edit: { id, add: [], remove: [] } }),
  toggle: (item) => {
    const { edit } = get()
    if (!edit) return
    const { frames } = useGraph.getState()
    if (item === edit.id || frameHolds(frames, item, edit.id)) return
    set({
      edit: frameHolds(frames, edit.id, item)
        ? { ...edit, remove: flip(edit.remove, item) }
        : { ...edit, add: flip(edit.add, item) }
    })
  },
  finish: () => {
    const { edit } = get()
    if (edit) useGraph.getState().editFrame(edit.id, edit.add, edit.remove)
    set({ edit: null })
  },
  cancel: () => set({ edit: null })
}))

/** How a tile or group reads while a group is edited: marked to add or to take out, or neither. */
export function useFrameEditMark(tile: string): 'add' | 'remove' | null {
  return useFrameEdit((s) =>
    !s.edit
      ? null
      : s.edit.add.includes(tile)
        ? 'add'
        : s.edit.remove.includes(tile)
          ? 'remove'
          : null
  )
}
