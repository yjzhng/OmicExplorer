/** The gene menu's popup: the trigger's nudge, and the menu's placement, mount/unmount animation
 *  and click-away closing (see GeneSelectMenu). */
import { useEffect, useRef, useState, type RefObject } from 'react'

import { NOTICE_MS } from '../app/theme'
import { POPOVER_ATTR } from '../controls/usePopover'
import { MENU_W } from './geneMenuModel'

/** A nudge on the trigger when the selection changes while the menu is closed — a click on a plot
 *  or a table row selects genes, and without it that went unnoticed. `key` restarts the animation
 *  on every change. */
export function useSelectionNudge(pinnedIds: Set<string>, open: boolean): { key: number } | null {
  const [nudge, setNudge] = useState<{ key: number } | null>(null)
  const prevPins = useRef(pinnedIds)
  const nudgeTimer = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevPins.current
    prevPins.current = pinnedIds
    if (prev === pinnedIds || open) return
    setNudge((x) => ({ key: (x?.key ?? 0) + 1 }))
    if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
    nudgeTimer.current = window.setTimeout(() => setNudge(null), NOTICE_MS.cue)
  }, [pinnedIds, open])
  useEffect(
    () => () => {
      if (nudgeTimer.current) window.clearTimeout(nudgeTimer.current)
    },
    []
  )
  return nudge
}

export interface MenuPlacement {
  /** where the trigger sat when the menu opened (the menu hangs under its right end) */
  rect: { right: number; bottom: number } | null
  /** the menu's left edge, kept inside the window */
  menuLeft: number
  menuMounted: boolean
  setMenuMounted: (mounted: boolean) => void
  /** closed but still mounted, animating out */
  menuLeaving: boolean
  btnRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  /** Measure the trigger, for the menu about to open under it. */
  place: () => void
}

/** The menu's place under the trigger, its stay-mounted-while-leaving moment, and what closes it:
 *  a click away, a scroll that moves the trigger, a resize — none of them while a group is edited. */
export function useMenuPlacement(
  open: boolean,
  setOpen: (open: boolean) => void,
  editId: string | null
): MenuPlacement {
  const [rect, setRect] = useState<{ right: number; bottom: number } | null>(null)
  // The menu stays mounted a moment after closing, so it can animate out (see .oe-menu-in / -out);
  // `menuLeaving` is that moment, ended by its animation.
  const [menuMounted, setMenuMounted] = useState(false)
  if (open && !menuMounted) setMenuMounted(true)
  const menuLeaving = menuMounted && !open
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      // A click in a popover opened from the menu (a geneset's colour grid) is not a click away.
      const inPopover = (t as Element).closest?.(`[${POPOVER_ATTR}]`)
      // While a group is edited the menu stays open: clicks out there are picks in the plots,
      // building the group. Confirm (or the Editing badge) finishes.
      if (editId) return
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t) && !inPopover)
        setOpen(false)
    }
    // Only a scroll that moves the trigger detaches the menu from it. Any other scroll is left
    // alone — notably a data table bringing the hovered gene's row into view, which hovering a
    // gene here sets off (that used to close the menu mid-search).
    const onScroll = (e: Event): void => {
      if (editId) return
      const t = e.target
      const moved = t === document || (t instanceof Node && !!t.contains(btnRef.current))
      if (moved) setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
    // (setOpen is the menu's state setter: stable, so this still re-runs on open / editId only)
  }, [open, editId, setOpen])

  const place = (): void => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ right: r.right, bottom: r.bottom })
  }
  const menuLeft = rect
    ? Math.max(8, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8))
    : 0
  return { rect, menuLeft, menuMounted, setMenuMounted, menuLeaving, btnRef, menuRef, place }
}
