/**
 * Which dense plots may draw through WebGL right now. Chromium keeps only ~16 WebGL contexts per
 * page and drops the oldest past that (the plot goes blank), each WebGL plot takes a few, and
 * dashboard tabs stay mounted when hidden — so WebGL is rationed: the plots on screen first, then
 * the most recently shown, up to MAX_LIVE. The rest draw as SVG, exactly as before WebGL.
 *
 * A plot that loses its slot while hidden is swapped back to SVG when the UI is idle (never in the
 * middle of a tab switch); one on screen that wins a slot is swapped at once. A plot whose context
 * is dropped anyway (`lost`) is SVG from then on — a wrong budget costs speed, never a blank plot.
 *
 * A 3-D scene has no SVG to fall back to, so it never waits for a slot: each one mounted takes a
 * context off the top, and the dense plots share what's left (its view unmounts it while it's off
 * screen — see ResponseSurfaceView — so a hidden tab's scenes hold none).
 */

/** Plots allowed WebGL at once with no 3-D scene mounted (each holds 2–4 contexts of Chromium's
 *  ~16). */
export const MAX_LIVE = 3
/** The contexts a dense plot is counted as (its most), and so the budget they share. */
const DENSE_CONTEXTS = 4
const CONTEXTS = MAX_LIVE * DENSE_CONTEXTS

interface Entry {
  /** wants WebGL: dense enough (see toGlTraces) */
  dense: boolean
  /** on screen (not in a hidden tab) */
  shown: boolean
  /** when it was last shown, for recency */
  seen: number
  /** its context was dropped: SVG for good */
  lost: boolean
  /** 3-D scenes it holds (one context each, whatever the budget) */
  scenes: number
  /** currently allowed */
  allowed: boolean
  notify: (allowed: boolean) => void
}

const entries = new Map<number, Entry>()
let nextId = 0
let clock = 0
let idleTimer: ReturnType<typeof setTimeout> | undefined

/** The plots that should hold WebGL: shown ones first — those already holding it before newcomers,
 *  so a plot never re-renders just because another appeared beside it — then by recency. */
function winners(): Set<number> {
  const want = [...entries].filter(([, e]) => e.dense && !e.lost)
  want.sort(
    ([, a], [, b]) =>
      Number(b.shown) - Number(a.shown) ||
      (a.shown ? Number(b.allowed) - Number(a.allowed) : 0) ||
      b.seen - a.seen
  )
  let scenes = 0
  for (const e of entries.values()) scenes += e.scenes
  const slots = Math.max(0, Math.floor((CONTEXTS - scenes) / DENSE_CONTEXTS))
  return new Set(want.slice(0, slots).map(([id]) => id))
}

/** Apply the budget: grants (and demotions of plots on screen) at once; demotions of hidden plots
 *  deferred to idle, so a tab switch never pays for re-rendering the tab it left. */
function settle(): void {
  const win = winners()
  let deferred = false
  for (const [id, e] of entries) {
    const allow = win.has(id)
    if (allow === e.allowed) continue
    if (!allow && !e.shown && !e.lost) {
      deferred = true
      continue
    }
    e.allowed = allow
    e.notify(allow)
  }
  if (deferred && idleTimer === undefined) {
    idleTimer = setTimeout(() => {
      idleTimer = undefined
      const w = winners()
      for (const [id, e] of entries)
        if (e.allowed && !w.has(id)) {
          e.allowed = false
          e.notify(false)
        }
    }, 1500)
  }
}

export interface GlSlot {
  /** whether this plot may use WebGL now */
  readonly allowed: () => boolean
  update: (state: { dense?: boolean; shown?: boolean; scenes?: number }) => void
  /** its WebGL context was dropped — fall back to SVG */
  lost: () => void
  release: () => void
}

/** Register a plot. `notify` is told whenever its permission changes after this call. */
export function glSlot(
  initial: { dense: boolean; shown: boolean; scenes?: number },
  notify: (allowed: boolean) => void
): GlSlot {
  const id = nextId++
  const e: Entry = {
    ...initial,
    scenes: initial.scenes ?? 0,
    seen: initial.shown ? ++clock : 0,
    lost: false,
    allowed: false,
    notify
  }
  entries.set(id, e)
  // Decide this plot's own permission synchronously (so its first render is already right), then
  // let the others adjust.
  e.allowed = winners().has(id)
  settle()
  return {
    allowed: () => e.allowed,
    update: (s) => {
      const shownNow = s.shown ?? e.shown
      const changed =
        (s.dense ?? e.dense) !== e.dense ||
        shownNow !== e.shown ||
        (s.scenes ?? e.scenes) !== e.scenes
      if (shownNow && !e.shown) e.seen = ++clock
      e.dense = s.dense ?? e.dense
      e.scenes = s.scenes ?? e.scenes
      e.shown = shownNow
      if (changed) settle()
    },
    lost: () => {
      if (e.lost) return
      e.lost = true
      settle()
    },
    release: () => {
      entries.delete(id)
      settle()
    }
  }
}

/** Test hook: forget every plot. */
export function resetGlBudget(): void {
  entries.clear()
  clearTimeout(idleTimer)
  idleTimer = undefined
}
