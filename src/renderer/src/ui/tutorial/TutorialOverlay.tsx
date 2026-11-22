/**
 * The tutorial on screen: the offer card, the tour's spotlight (the window dimmed but for the
 * control the stop is about, a callout beside it, Exit always at hand), and the note every ending
 * leaves, pointing at the User Guide where the tour can be played again.
 *
 * Drawn inside the app root (not a portal), so the theme's CSS variables reach it.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { useGraph } from '../../graph/store'
import { CATEGORICAL, EASE, LOOP_MS, motion, MOTION_MS, NOTICE_MS, UI } from '../theme'
import { canvasNav } from './canvasNav'
import { tutorialOffered } from './firstRun'
import { STOPS, type TourStop } from './stops'
import { useTutorial } from './useTutorial'

const Z = 5000
const PAD = 6
const DIM = 'rgba(0, 0, 0, 0.6)'
const CALLOUT_W = 300
/** The closing note's width (the offer card's). */
const NOTE_W = 320
/** Frames an outcome stop's subject may be missing before it's opened again. */
const REOPEN_FRAMES = 20
/** From the canvas appearing to the offer. */
const OFFER_DELAY_MS = 900

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const boxOf = (el: Element | null): Box | null => {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}
const sameBox = (a: Box | null, b: Box | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5)

export function TutorialOverlay(): ReactNode {
  const phase = useTutorial((s) => s.phase)
  const offer = useTutorial((s) => s.offer)
  // Offered to a new user the first time a project's canvas is on screen — a quiet card they can
  // take or leave while they carry on (see Offer).
  const onCanvas = useGraph((s) => s.projectOpen)
  useEffect(() => {
    if (!onCanvas || phase !== 'idle' || tutorialOffered()) return
    // a moment after the canvas appears, so the card arrives on a settled page
    const t = window.setTimeout(() => {
      if (useTutorial.getState().phase === 'idle' && !tutorialOffered()) offer()
    }, OFFER_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [onCanvas, phase, offer])

  return (
    <>
      <style>{KEYFRAMES}</style>
      {phase === 'offer' && <Offer />}
      {(phase === 'starting' || phase === 'leaving') && <div style={styles.dimAll} />}
      {phase === 'tour' && <Tour />}
      {phase === 'end' && <EndNote />}
    </>
  )
}

/** The offer: a quiet card at the bottom right, over nothing — the user carries on working
 *  until they take it or wave it away. */
function Offer(): ReactNode {
  const start = useTutorial((s) => s.start)
  const skip = useTutorial((s) => s.skip)
  return (
    <div className="oe-menu-in" style={styles.offer} role="complementary" aria-label="Quick tour">
      <span style={styles.bulb} aria-hidden>
        <IconBulb />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.offerTitle}>Want a quick tour?</div>
        <div style={styles.offerText}>
          A couple of minutes on example data: running steps and exploring the plots. Your project
          stays as it is.
        </div>
        <div style={styles.offerBtns}>
          <button style={styles.btn} onClick={skip}>
            Not now
          </button>
          <button style={styles.btnPrimary} onClick={() => void start()}>
            Show me
          </button>
        </div>
      </div>
    </div>
  )
}

/** A light bulb, drawn like the app's other icons (24 grid, round 1.8 strokes). */
function IconBulb(): ReactNode {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
    </svg>
  )
}

/** Put away what a stop left open — a menu, a dialog, placing a new step, an edit in progress —
 *  before Next / Back / Exit move on: the folder chip and ＋ New step toggled back, the focused
 *  field committed, then a click away and an Esc (synthetic: the tour's own key handler ignores
 *  it), which close the app's menus and dialogs. */
function tidy(): void {
  document.querySelector<HTMLElement>('#oe-folder-chip[data-open="true"]')?.click()
  const newStep = document.querySelector<HTMLElement>('[data-tour="new-step"]')
  if (newStep?.textContent?.trim() === 'Cancel') newStep.click()
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** A field being typed in: the tour's keys leave it alone. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    t.tagName === 'INPUT' ||
    t.tagName === 'TEXTAREA' ||
    t.tagName === 'SELECT')

/** One box round two. */
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
/** Round the pointer mid-drag: room for the picker that a drop there opens (it hangs right and
 *  down from the drop point). */
const dropBox = (p: { x: number; y: number }): Box => ({ x: p.x - 40, y: p.y - 70, w: 280, h: 230 })

/** Part of the tour's layer that stops presses reaching the app (and its click-away listeners). */
function Block({ style, onClick }: { style: CSSProperties; onClick?: () => void }): ReactNode {
  const stop = (e: { stopPropagation: () => void }): void => e.stopPropagation()
  return (
    <div
      style={{ ...styles.block, ...style }}
      // a scroll over the dimming still pans the canvas (when it's on screen)
      onWheel={(e) => canvasNav()?.panBy(e.deltaX, e.deltaY)}
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    />
  )
}

/** Where a stop's target is now: its first match — or, for an `all` stop, one box round every
 *  match. */
const selectorOf = (stop: TourStop): string =>
  typeof stop.target === 'function' ? stop.target() : stop.target

function targetBox(stop: TourStop): Box | null {
  const sel = selectorOf(stop)
  if (!stop.all) return boxOf(document.querySelector(sel))
  const boxes = [...document.querySelectorAll(sel)].map(boxOf).filter((b): b is Box => !!b)
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y
  }
}

/** The tour: the current stop's spotlight and callout, kept on its target as the page moves. On a
 *  click stop the lit control works, and using it moves the tour on to what it did. */
function Tour(): ReactNode {
  const i = useTutorial((s) => s.stop)
  const go = useTutorial((s) => s.go)
  const exit = useTutorial((s) => s.exit)
  const stop = STOPS[i]
  const [hole, setHole] = useState<Box | null>(null)
  const [rings, setRings] = useState<Box[]>([])
  const holeRef = useRef<Box | null>(null)
  // Next / Back / Exit put away what the stop left open first; a click stop's own move on doesn't
  // (what it opened is the next stop's subject).
  const move = (to: number): void => {
    tidy()
    go(to)
  }
  const leave = (): void => {
    tidy()
    void exit()
  }
  const next = (): void => move(i + 1)

  // Every frame: where the target is now (pages slide, panels open, plots draw late), and whether
  // a click stop's action has happened.
  useEffect(() => {
    let raf = 0
    let moved = false
    let gone = 0
    let armed = false
    let fitted = false
    const tick = (): void => {
      const b = targetBox(stop)
      if (!sameBox(b, holeRef.current)) {
        holeRef.current = b
        setHole(b)
      }
      // A tile out of sight (placed near an edge, grown off it): fit the canvas so it's in view —
      // the dimming keeps the canvas from being panned by hand. Once per stop, after it settles.
      if (b && !fitted) {
        const pane = boxOf(document.querySelector('.react-flow'))
        const inCanvas = !!document.querySelector(`.react-flow ${selectorOf(stop)}`)
        const outside =
          pane &&
          inCanvas &&
          (b.x < pane.x ||
            b.y < pane.y ||
            b.x + b.w > pane.x + pane.w ||
            b.y + b.h > pane.y + pane.h)
        if (outside) {
          fitted = true
          canvasNav()?.fit()
        }
      }
      // What the stop shows closed (a click away, Esc): open it again rather than leave the
      // callout pointing at nothing.
      gone = b ? 0 : gone + 1
      if (stop.reopen && gone === REOPEN_FRAMES) {
        gone = 0
        stop.enter?.()
      }
      const rs = (stop.also ?? []).map((s) => boxOf(document.querySelector(s))).filter(Boolean)
      setRings((prev) =>
        prev.length === rs.length && prev.every((p, k) => sameBox(p, rs[k])) ? prev : (rs as Box[])
      )
      // A click stop moves on when its action happens HERE: its condition turning true after
      // being false — one still true from before (Back to Run, after running) waits for Next.
      if (stop.done && !moved) {
        if (!stop.done()) armed = true
        else if (armed) {
          moved = true
          go(i + 1)
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [stop, i, go])

  // A drag from a `followDrag` stop's control: where the pointer is while it's held — the light
  // stretches to take it in, so the drop is never made in the dark.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!stop.followDrag) return
    let held = false
    const down = (e: PointerEvent): void => {
      const b = holeRef.current
      held =
        !!b &&
        e.clientX >= b.x - PAD &&
        e.clientX <= b.x + b.w + PAD &&
        e.clientY >= b.y - PAD &&
        e.clientY <= b.y + b.h + PAD
    }
    const move = (e: PointerEvent): void => {
      if (held) setDrag({ x: e.clientX, y: e.clientY })
    }
    const up = (): void => {
      held = false
      setDrag(null)
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', up, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', up, true)
      setDrag(null)
    }
  }, [stop])

  // Keys: Esc leaves, → / Enter next, ← back — not while typing in a field (renaming a step), and
  // not the tour's own Esc (tidy's).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.isTrusted || typing(e.target)) return
      const key =
        e.key === 'Escape'
          ? 'exit'
          : e.key === 'ArrowLeft'
            ? 'back'
            : e.key === 'ArrowRight' || e.key === 'Enter'
              ? 'next'
              : null
      if (!key) return
      e.preventDefault()
      e.stopPropagation()
      tidy()
      if (key === 'exit') void exit()
      else go(key === 'next' ? i + 1 : i - 1)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [exit, go, i])

  const lit = hole && drag ? union(hole, dropBox(drag)) : hole
  const h = lit && { x: lit.x - PAD, y: lit.y - PAD, w: lit.w + 2 * PAD, h: lit.h + 2 * PAD }
  // In reach: a click stop's control, an interactive stop's part; on any other stop, nothing.
  const usable = !!h && (!!stop.done || !!stop.interactive)
  return (
    <>
      {h ? (
        <div
          style={{
            ...styles.spot,
            left: h.x,
            top: h.y,
            width: h.w,
            height: h.h,
            // mid-drag it keeps up with the pointer, not glides after it
            ...(drag ? { transition: 'none' } : null)
          }}
        />
      ) : (
        <div style={{ ...styles.dimAll, pointerEvents: 'none' }} />
      )}
      {/* Out of reach: all but the lit part. A press there goes no further into the app (its
          menus close on a click away, and the one a stop shows must stay open) — a click there
          moves the tour on, like Next. */}
      {h ? (
        <>
          <Block style={{ left: 0, top: 0, right: 0, height: Math.max(0, h.y) }} onClick={next} />
          <Block style={{ left: 0, top: h.y + h.h, right: 0, bottom: 0 }} onClick={next} />
          <Block
            style={{ left: 0, top: h.y, width: Math.max(0, h.x), height: h.h }}
            onClick={next}
          />
          <Block style={{ left: h.x + h.w, top: h.y, right: 0, height: h.h }} onClick={next} />
          {/* A stop that shows and tells: its lit part moves on, like Next. */}
          {!usable && (
            <Block
              style={{ left: h.x, top: h.y, width: h.w, height: h.h, cursor: 'pointer' }}
              onClick={next}
            />
          )}
        </>
      ) : (
        <Block style={{ inset: 0 }} onClick={next} />
      )}
      {h && <div style={{ ...styles.ring, left: h.x, top: h.y, width: h.w, height: h.h }} />}
      {rings.map((r, k) => (
        <div
          key={k}
          style={{
            ...styles.ring,
            left: r.x - 4,
            top: r.y - 4,
            width: r.w + 8,
            height: r.h + 8
          }}
        />
      ))}
      <Callout stop={stop} i={i} hole={h} />
      {/* Every way on, together at the bottom right of the window: Exit, Back, Next. */}
      <div style={styles.controls}>
        <span style={styles.count}>
          {i + 1} / {STOPS.length}
        </span>
        <button style={styles.ghost} onClick={leave}>
          Exit
        </button>
        {i > 0 && (
          <button style={styles.ghost} onClick={() => move(i - 1)}>
            Back
          </button>
        )}
        <button style={styles.next} onClick={() => move(i + 1)}>
          {i === STOPS.length - 1 ? 'Finish' : 'Next'}
        </button>
      </div>
    </>
  )
}

/** The stop's words, beside its control: below it if there's room, else above, else inside (a
 *  control as big as a plot). */
function Callout({ stop, i, hole }: { stop: TourStop; i: number; hole: Box | null }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(170)
  useEffect(() => {
    if (ref.current) setHeight(ref.current.offsetHeight)
  }, [stop])
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 14
  let left: number
  let top: number
  let arrow: 'up' | 'down' | null = null
  if (!hole) {
    left = (vw - CALLOUT_W) / 2
    top = (vh - height) / 2
  } else if (hole.y + hole.h + gap + height < vh - 8) {
    left = hole.x + hole.w / 2 - CALLOUT_W / 2
    top = hole.y + hole.h + gap
    arrow = 'up'
  } else if (hole.y - gap - height > 8) {
    left = hole.x + hole.w / 2 - CALLOUT_W / 2
    top = hole.y - gap - height
    arrow = 'down'
  } else {
    left = hole.x + hole.w - CALLOUT_W - 16
    top = hole.y + 48
  }
  left = Math.max(10, Math.min(left, vw - CALLOUT_W - 10))
  const arrowX = hole ? Math.max(16, Math.min(CALLOUT_W - 28, hole.x + hole.w / 2 - left - 6)) : 0
  return (
    <div ref={ref} style={{ ...styles.callout, left, top }} role="dialog" aria-label={stop.title}>
      {arrow && (
        <span
          style={{
            ...styles.arrow,
            left: arrowX,
            ...(arrow === 'up' ? { top: -6 } : { bottom: -6 })
          }}
        />
      )}
      <div style={styles.calloutTitle}>{stop.title}</div>
      <div style={styles.calloutText}>{stop.body}</div>
      {/* A click stop: what to do, in place of Next. */}
      {stop.clickHint && (
        <div style={styles.hint}>
          <span style={styles.hintDot} />
          {stop.clickHint}
        </div>
      )}
      <div style={styles.bar}>
        <span style={{ ...styles.barFill, width: `${((i + 1) / STOPS.length) * 100}%` }} />
      </div>
    </div>
  )
}

/** However the tour ended: where to play it again — a card like the offer's, hanging under the
 *  User Guide button at the top right (where the tour is replayed), pointing up at it. A finished
 *  tour gets a party popper too. */
function EndNote(): ReactNode {
  const close = useTutorial((s) => s.closeNote)
  const finished = useTutorial((s) => s.finished)
  const [guide, setGuide] = useState<Box | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const b = boxOf(document.querySelector('[data-tour="guide"]'))
      setGuide((prev) => (sameBox(prev, b) ? prev : b))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const t = window.setTimeout(close, 15000)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [close])
  if (!guide) return null
  // Right-aligned under the button, its arrow at the button's middle.
  const left = Math.max(
    10,
    Math.min(guide.x + guide.w / 2 - NOTE_W + 30, window.innerWidth - NOTE_W - 10)
  )
  const top = guide.y + guide.h + 12
  const arrowX = guide.x + guide.w / 2 - left - 6
  return (
    <>
      <div
        style={{
          ...styles.guideRing,
          left: guide.x - 4,
          top: guide.y - 4,
          width: guide.w + 8,
          height: guide.h + 8
        }}
      />
      {finished && <Confetti x={left + 24} y={top + 22} />}
      <div
        className="oe-menu-in"
        style={{ ...styles.offer, ...styles.note, left, top }}
        role="status"
        aria-label="Revisit the tutorial"
      >
        <span style={{ ...styles.noteArrow, left: arrowX }} />
        <span style={styles.bulb} aria-hidden>
          {finished ? <span style={styles.popper}>🎉</span> : <IconBulb />}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.offerTitle}>
            {finished ? 'Tour complete!' : 'The tutorial, any time'}
          </div>
          <div style={styles.offerText}>
            {finished ? 'To see it again, open' : 'Open'} the User Guide here and choose{' '}
            <b>Revisit interactive tutorial</b>.
          </div>
          <div style={styles.offerBtns}>
            <button style={styles.btnPrimary} onClick={close}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

/** The finish's party popper: a burst of confetti from (x, y) — pieces thrown up and out, falling
 *  back and fading (Web Animations, so nothing stays in the page after). Skipped when the system
 *  asks for reduced motion. */
function Confetti({ x, y }: { x: number; y: number }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const anims: Animation[] = []
    for (let k = 0; k < CONFETTI_PIECES; k++) {
      const piece = document.createElement('span')
      const w = 5 + Math.random() * 5
      Object.assign(piece.style, {
        position: 'absolute',
        left: '0px',
        top: '0px',
        width: `${w}px`,
        height: `${w * (0.4 + Math.random() * 0.6)}px`,
        borderRadius: Math.random() < 0.3 ? '50%' : '1px',
        background: CATEGORICAL[k % CATEGORICAL.length]
      })
      host.appendChild(piece)
      // Up and out within a fan above the popper, then down past where it started.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9
      const speed = 90 + Math.random() * 130
      const dx = Math.cos(angle) * speed
      const dy = Math.sin(angle) * speed
      const spin = (Math.random() - 0.5) * 720
      const a = piece.animate(
        [
          { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(${dx * 0.8}px, ${dy * 0.8}px) rotate(${spin * 0.5}deg)`,
            opacity: 1,
            offset: 0.45
          },
          { transform: `translate(${dx}px, ${dy + 160}px) rotate(${spin}deg)`, opacity: 0 }
        ],
        {
          duration: CONFETTI_MS * (0.8 + Math.random() * 0.4),
          easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)',
          fill: 'forwards'
        }
      )
      anims.push(a)
    }
    return () => {
      anims.forEach((a) => a.cancel())
      host.replaceChildren()
    }
  }, [])
  return <div ref={ref} style={{ ...styles.confetti, left: x, top: y }} aria-hidden />
}
const CONFETTI_PIECES = 48
/** One burst's flight time (each piece within ±20% of it). */
const CONFETTI_MS = NOTICE_MS.cue

const KEYFRAMES = `@keyframes oe-tour-pulse { 0%, 100% { opacity: 0.95 } 50% { opacity: 0.35 } }
@keyframes oe-tour-pop { 0% { transform: scale(0.2) rotate(-30deg) } 60% { transform: scale(1.35) rotate(8deg) } 100% { transform: scale(1) rotate(0) } }`

const styles: Record<string, CSSProperties> = {
  dimAll: {
    position: 'fixed',
    inset: 0,
    zIndex: Z,
    background: DIM,
    display: 'grid',
    placeItems: 'center'
  },
  // The lit control: a clear box whose huge shadow dims the rest of the window.
  spot: {
    position: 'fixed',
    zIndex: Z,
    borderRadius: 8,
    boxShadow: `0 0 0 200vmax ${DIM}`,
    pointerEvents: 'none',
    transition: motion('left, top, width, height', 'open')
  },
  block: { position: 'fixed', zIndex: Z + 1, background: 'transparent', cursor: 'pointer' },
  confetti: { position: 'fixed', zIndex: Z + 4, width: 0, height: 0, pointerEvents: 'none' },
  // The closing note: the offer's card, moved under the User Guide button.
  note: { right: 'auto', bottom: 'auto', width: NOTE_W },
  // its arrow up to the button: the card's own colour and border, on its top edge
  noteArrow: {
    position: 'absolute',
    top: -7,
    width: 12,
    height: 12,
    background: UI.panel,
    borderLeft: `1px solid ${UI.border}`,
    borderTop: `1px solid ${UI.border}`,
    transform: 'rotate(45deg)'
  },
  // The User Guide button, ringed in the page's own accent (the page isn't dimmed here).
  guideRing: {
    position: 'fixed',
    zIndex: Z,
    borderRadius: 9,
    border: `2px solid ${UI.accent}`,
    pointerEvents: 'none',
    animation: `oe-tour-pulse ${LOOP_MS.drift}ms ease-in-out infinite`
  },
  popper: { display: 'inline-block', animation: `oe-tour-pop ${MOTION_MS.page}ms ${EASE.enter}` },
  ring: {
    position: 'fixed',
    zIndex: Z + 2,
    borderRadius: 9,
    border: '2px solid #fff',
    pointerEvents: 'none',
    animation: `oe-tour-pulse ${LOOP_MS.drift}ms ease-in-out infinite`
  },
  callout: {
    position: 'fixed',
    zIndex: Z + 3,
    width: CALLOUT_W,
    boxSizing: 'border-box',
    background: UI.accent,
    color: UI.accentText,
    borderRadius: 10,
    padding: '12px 14px 14px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
    fontSize: 12.5,
    lineHeight: 1.45
  },
  arrow: {
    position: 'absolute',
    width: 12,
    height: 12,
    background: UI.accent,
    transform: 'rotate(45deg)'
  },
  calloutTitle: { fontWeight: 700, fontSize: 14, marginBottom: 4 },
  calloutText: { opacity: 0.88 },
  controls: {
    position: 'fixed',
    zIndex: Z + 3,
    right: 16,
    bottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 6px 6px 16px',
    borderRadius: 10,
    background: UI.accent,
    color: UI.accentText,
    boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
  },
  count: { fontSize: 11.5, opacity: 0.6, fontVariantNumeric: 'tabular-nums', marginRight: 4 },
  ghost: {
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    opacity: 0.7,
    padding: '6px 4px',
    fontSize: 12.5,
    cursor: 'pointer'
  },
  next: {
    background: UI.accentText,
    color: UI.accent,
    border: 'none',
    borderRadius: 7,
    padding: '6px 16px',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer'
  },
  hint: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    fontSize: 11.5,
    fontWeight: 600,
    opacity: 0.9
  },
  hintDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'currentColor',
    animation: `oe-tour-pulse ${LOOP_MS.pulse}ms ease-in-out infinite`
  },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    borderRadius: '0 0 10px 10px',
    overflow: 'hidden',
    background: 'rgba(127,127,127,0.25)'
  },
  barFill: { display: 'block', height: '100%', background: UI.accentText, opacity: 0.7 },
  // Above the canvas's pan pad (bottom right), clear of the work.
  offer: {
    position: 'fixed',
    zIndex: Z,
    right: 16,
    bottom: 90,
    width: 320,
    boxSizing: 'border-box',
    display: 'flex',
    gap: 10,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '12px 14px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.14)'
  },
  bulb: { color: '#e2b93b', display: 'inline-flex', flex: '0 0 auto', marginTop: 1 },
  offerTitle: { fontSize: 13, fontWeight: 700, marginBottom: 3 },
  offerText: { fontSize: 12, color: UI.textMuted, lineHeight: 1.45 },
  offerBtns: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
