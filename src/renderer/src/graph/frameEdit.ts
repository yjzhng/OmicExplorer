/** Editing a canvas group's members (the pencil on its frame): while one is edited, what it holds
 *  shows as selected, and a click on a tile — or on another group's frame, for that group whole —
 *  selects or deselects it: in, or out. Under the hood a click outside marks it to add, one inside
 *  to take out, a second click unmarks it. Nothing changes until the ✓ (one undo step); Esc drops
 *  the marks. Transient — not saved with the workflow. */
import { create } from 'zustand'

import { editHolds, toggleMark, type FrameEdit } from './frames'
import { useGraph } from './store'

export type { FrameEdit }

interface FrameEditState {
  edit: FrameEdit | null
  start: (id: string) => void
  /** Mark / unmark a tile or a group: to take out when it's inside the frame, to add when it isn't
   *  (never a group holding the frame). A tile or group inside a group already marked goes with
   *  it, so a click on it does nothing. */
  toggle: (item: string) => void
  /** Apply the marks to the frame and stop editing. */
  finish: () => void
  cancel: () => void
}

export const useFrameEdit = create<FrameEditState>((set, get) => ({
  edit: null,
  start: (id) => set({ edit: { id, add: [], remove: [] } }),
  toggle: (item) => {
    const { edit } = get()
    if (!edit) return
    set({ edit: toggleMark(useGraph.getState().frames, edit, item) })
  },
  finish: () => {
    const { edit } = get()
    if (edit) useGraph.getState().editFrame(edit.id, edit.add, edit.remove)
    set({ edit: null })
  },
  cancel: () => set({ edit: null })
}))

/** editHolds for a tile or group, live. */
export function useFrameEditHolds(item: string): boolean | null {
  const edit = useFrameEdit((s) => s.edit)
  const frames = useGraph((s) => s.frames)
  return edit ? editHolds(frames, edit, item) : null
}
