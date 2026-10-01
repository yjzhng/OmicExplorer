/**
 * Open / close / place for a trigger-anchored popover portalled to <body> (the app's Select menu,
 * its colour grid). Closes on a click away, a resize, or a scroll outside the popover itself; a
 * changed `closeKey` closes it too (the canvas passes its transform: a fixed overlay can't follow a
 * pan or zoom).
 *
 * No canvas context needed, so popovers work outside the workflow canvas (the nav's gene selector).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'

/** Marks an open popover, so an enclosing one (the gene selector) can tell a click in it from a
 *  click away — the popover is portalled outside whatever opened it. Spread `POPOVER_PROPS` on it. */
export const POPOVER_ATTR = 'data-oe-popover'
export const POPOVER_PROPS = { [POPOVER_ATTR]: '' } as Record<string, string>

export function usePopover(closeKey?: string): {
  open: boolean
  setOpen: (v: boolean) => void
  toggle: () => void
  /** the trigger's box at the moment it opened */
  rect: { left: number; bottom: number; width: number } | null
  btnRef: RefObject<HTMLButtonElement | null>
  menuRef: RefObject<HTMLDivElement | null>
} {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ left: number; bottom: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The functional updater bails when it's already closed, so this doesn't cascade — reacting to
  // the external key is exactly what this effect is for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpen((wasOpen) => (wasOpen ? false : wasOpen))
  }, [closeKey])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    // Capture-phase scroll closes on an ANCESTOR scroll, but not when the popover itself scrolls.
    const onScroll = (e: Event): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])
  const toggle = (): void => {
    if (open) return setOpen(false)
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setRect({ left: r.left, bottom: r.bottom, width: r.width })
    setOpen(true)
  }
  return { open, setOpen, toggle, rect, btnRef, menuRef }
}
