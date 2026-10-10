/**
 * "Working…" — shown while the app's main thread is busy (rebuilding every plot after a run, a
 * condition switch, …), so a long pause reads as loading rather than a hang.
 *
 * A busy main thread can't show anything itself: no React render, no timer, no main-thread
 * animation runs until it's free again. But an opacity / transform animation the compositor runs
 * keeps going regardless. So the notice is a fade-in, delayed by SHOW_AFTER_MS, that the main
 * thread keeps restarting every TICK_MS while it's free — it never gets to show. Once the thread
 * stalls the restarts stop, the compositor finishes the fade and the notice appears (its spinner
 * turning on the compositor too).
 *
 * Heavy work often comes as a string of stalls with short breaks between (plots drawn one after
 * another). Hidden at each break, the notice would only ever get partway through its fade —
 * flickering, half-transparent. So once a stall has shown it, it stays fully shown until the
 * thread has been free for HOLD_MS straight, then fades out.
 *
 * One mount, app-wide (App); nothing else needs to report that it's busy.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cssVars, PALETTES, UI } from './theme'
import { useUiTheme } from './useUiTheme'

/** How long the thread must be stuck before the notice shows: past the hitches of ordinary use
 *  (a hover that redraws highlights across the plots), short of "has it frozen?". */
const SHOW_AFTER_MS = 1500
/** How often a free thread pushes the fade back. Well under SHOW_AFTER_MS, so it never shows. */
const TICK_MS = 100
/** How long the thread must stay free after a stall before the notice goes. */
const HOLD_MS = 500
const FADE_MS = 150

export function FreezeNotice(): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    let anim: Animation | null = null
    let last = performance.now()
    /** while shown: hide once the thread has been free until then */
    let shownUntil = 0
    let shown = false
    const play = (keyframes: Keyframe[], opts: KeyframeAnimationOptions): void => {
      anim?.cancel()
      anim = el.animate(keyframes, { fill: 'forwards', ...opts })
    }
    const arm = (): void => {
      const now = performance.now()
      const gap = now - last
      last = now
      // A hidden window's timers are throttled to ~1/s, which would read as a stall.
      if (document.hidden) {
        anim?.cancel()
        shown = false
        return
      }
      // That gap was a stall long enough to have shown the notice FULLY (its fade done): hold it
      // shown. One that only got it partway is over and hides straight away — holding it would show
      // the notice after the lag rather than during it.
      if (gap >= SHOW_AFTER_MS + FADE_MS) shownUntil = now + HOLD_MS
      if (now < shownUntil) {
        // Fully shown, steady — a stall during the hold leaves it as it is.
        if (!shown) play([{ opacity: 1 }, { opacity: 1 }], { duration: 1 })
        shown = true
        return
      }
      if (shown) {
        // Free for the whole hold: fade out, then (next tick on) arm as usual.
        shown = false
        play([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS })
        return
      }
      // Free: push the delayed fade-in back again.
      play([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, delay: SHOW_AFTER_MS })
    }
    arm()
    const timer = window.setInterval(arm, TICK_MS)
    document.addEventListener('visibilitychange', arm)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', arm)
      anim?.cancel()
    }
  }, [])
  // aria-hidden: it can only appear while nothing can be announced anyway. On the body, above
  // everything — the app's menus and dialogs portal there too — with the theme's colours, which
  // live on the app root and so don't reach it otherwise.
  return createPortal(
    // The whole window, dimmed a little, with the pill on it — one element, so one fade shows both.
    <div ref={ref} aria-hidden style={{ ...cssVars(PALETTES[mode]), ...styles.veil }}>
      <div style={styles.notice}>
        <span className="oe-spin" style={styles.ring} />
        Working…
      </div>
    </div>,
    document.body
  )
}

const styles: Record<string, CSSProperties> = {
  veil: {
    position: 'fixed',
    inset: 0,
    // the topmost layer: above menus (the gene selector's), popovers and dialogs
    zIndex: 2147483647,
    background: 'rgba(0,0,0,0.1)',
    // Never in the way: clicks made during a stall are the app's to handle once it's free.
    pointerEvents: 'none',
    opacity: 0,
    // its own layer, so the fade runs on the compositor
    willChange: 'opacity'
  },
  notice: {
    position: 'absolute',
    top: 58,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px 6px 10px',
    borderRadius: 999,
    background: UI.panelRaised,
    border: `1px solid ${UI.border}`,
    boxShadow: '0 6px 22px rgba(0,0,0,0.35)',
    color: UI.textMuted,
    fontSize: 12,
    fontWeight: 600
  },
  // A ring with one coloured side, turned by `oe-spin` (app.css) — an HTML box, not SVG, so the
  // compositor can turn it while the main thread is busy.
  ring: {
    width: 12,
    height: 12,
    boxSizing: 'border-box',
    borderRadius: '50%',
    border: `2px solid color-mix(in srgb, ${UI.textMuted} 30%, transparent)`,
    borderTopColor: UI.textMuted
  }
}
