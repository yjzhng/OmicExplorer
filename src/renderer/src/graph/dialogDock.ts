/**
 * Where a step's configuration window renders. By default (the canvas) it is a modal over the app,
 * portalled to `document.body`; the form workflow instead provides a pane of its own here, and the
 * window renders INTO it — docked, always open, no scrim — as the step's third column.
 *
 * A context rather than a prop so the config panels between the form view and the window
 * (NodeConfigPanel → LoadPanel / ComparePanel / ContrastPanel) needn't thread it through.
 */
import { createContext, useContext, useState, type CSSProperties } from 'react'
import { create } from 'zustand'

import type { LoadConfig, StepNode } from './types'
import { resolveLoadMode } from './types'

/** The element a docked window portals into; null ⇒ the window is a modal. */
export const DialogDock = createContext<HTMLElement | null>(null)

export const useDialogDock = (): HTMLElement | null => useContext(DialogDock)

/** Which steps' docked windows are open, by step id. Held here rather than in the panel because
 *  the panel unmounts whenever another step is selected, and coming back should find the window
 *  still open. Session-only: a window is a place you're working, not part of the project. */
const useDockedOpen = create<{
  open: Record<string, boolean>
  set: (id: string, on: boolean) => void
}>((set) => ({
  open: {},
  set: (id, on) => set((s) => ({ open: { ...s.open, [id]: on } }))
}))

/** Whether step `id`'s configuration window is open, and a setter. Docked, it survives switching
 *  to another step and back; as the canvas's modal it is local to the panel, as it always was. */
export function useConfigWindowOpen(id: string): [boolean, (on: boolean) => void] {
  const docked = useDialogDock() !== null
  const [local, setLocal] = useState(false)
  const dockedOpen = useDockedOpen((s) => !!s.open[id])
  const setDocked = useDockedOpen((s) => s.set)
  return docked ? [dockedOpen, (on) => setDocked(id, on)] : [local, setLocal]
}

/** Whether a step has a configuration window, and so a details column in the form workflow: an
 *  interactive import, a Compare, a Contrast. */
export function hasDetailsWindow(node: StepNode): boolean {
  const kind = node.data.kind
  if (kind === 'load') return resolveLoadMode(node.data.config as LoadConfig) === 'interactive'
  return kind === 'compare' || kind === 'contrast'
}

/** The window's outer box (the theme wrapper), docked: fills the pane's flex row. `minWidth: 0`
 *  matters — a flex item otherwise refuses to shrink below its content, and a wide table inside
 *  would push the card past the pane's right edge, where the pane clips it. */
export const DOCKED_WRAP: CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  minHeight: 0,
  display: 'flex'
}

/** A window's card, docked: it fills the pane instead of floating centred over a scrim, so
 *  position, size caps and shadow go. The frame stays — a bordered card like the step settings
 *  beside it (NodeConfigPanel's embedded panel), same 8px corners. Spread over the modal style. */
export const DOCKED_CARD: CSSProperties = {
  position: 'relative',
  top: 'auto',
  left: 'auto',
  transform: 'none',
  width: '100%',
  minWidth: 0,
  height: '100%',
  maxWidth: 'none',
  maxHeight: 'none',
  borderRadius: 8,
  boxShadow: 'none',
  zIndex: 'auto'
}
