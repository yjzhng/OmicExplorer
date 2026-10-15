/**
 * The app's switches, one family:
 *
 * - `ToggleSwitch` — pick one of several options: a track holding the options, with an accent
 *   highlight that SLIDES to the picked one. Every segmented control uses it (the condition
 *   switchers, the in-plot switch bars, settings choices, …).
 * - `OnOffSwitch` — the two-position case drawn as a knob: off / on. Same motion, same timing.
 *
 * One file so the family moves alike: both animate over `MOTION`.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { StatusIcon } from './StatusNote'
import { cssVars, PALETTES, UI } from './theme'
import { useUiTheme } from './useUiTheme'

/** The switches' shared motion: how long a highlight or knob takes to move, and its easing. */
const MOTION_MS = 160
const MOTION = `${MOTION_MS}ms ease`
/** A disabled option's tooltip: its widest. */
const TIP_MAX_W = 260

/**
 * Move first, then commit. A pick can set off heavy work (a condition switch rebuilds every plot
 * of the analysis), and a slide only advances while the main thread is free — committed at once,
 * the work would swallow the whole slide and the highlight would just jump. So the switch shows
 * the pick straight away, and hands it to `commit` once the slide is done. If the owner doesn't
 * take it (its value stays), the switch falls back to that value.
 */
function useMoveThenCommit<T>(value: T, commit: (v: T) => void): [T, (v: T) => void] {
  const [pending, setPending] = useState<{ v: T } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // The pick still waiting to be committed, so going away mid-slide commits it rather than losing it.
  const waiting = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      waiting.current?.()
    },
    []
  )
  const pick = (v: T): void => {
    setPending({ v })
    window.clearTimeout(timer.current)
    waiting.current = () => {
      waiting.current = null
      commit(v)
    }
    timer.current = window.setTimeout(() => {
      waiting.current?.()
      setPending(null)
    }, MOTION_MS)
  }
  return [pending ? pending.v : value, pick]
}

export interface ToggleOption<V extends string> {
  value: V
  label: ReactNode
  /** greyed and unpickable (it can still be the current value, e.g. an automatic state) */
  disabled?: boolean
  /** hover text — e.g. why the option is disabled */
  title?: string
}

/** Sizes, smallest first: `sm` sits in a plot tile's switch bar; `md` is the default (condition
 *  switchers, dialogs, settings); `lg` matches the main nav's chips. */
type Size = 'sm' | 'md' | 'lg'
/** `pill` is fully rounded; `rounded` is a rounded rectangle (the main nav's chip shape). */
type Shape = 'pill' | 'rounded'
/** `accent`: the picked option on a solid accent highlight. `subtle`: on a faint shade, the others
 *  grey — for a switch that sits among quiet chrome (the nav's layout switch). */
type Tone = 'accent' | 'subtle'

export function ToggleSwitch<V extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  shape = 'pill',
  fill,
  tone = 'accent',
  disabled
}: {
  value: V
  options: readonly ToggleOption<V>[]
  onChange: (value: V) => void
  /** accessible name of the group */
  label: string
  size?: Size
  shape?: Shape
  /** stretch across the container, options sharing the width equally */
  fill?: boolean
  /** how strongly the picked option stands out (see Tone) */
  tone?: Tone
  /** the whole switch inert (e.g. while its data loads) */
  disabled?: boolean
}): ReactNode {
  const trackRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [shown, pick] = useMoveThenCommit(value, onChange)
  const activeIndex = options.findIndex((o) => o.value === shown)
  // Where the highlight sits: the picked option's box inside the track. Measured, not computed,
  // so labels of any width (and a wrapped second row) are handled.
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number }>()
  // No glide on the first placement — the highlight should appear on the current option, not
  // slide in from the track's corner. Moves after that animate.
  const [placed, setPlaced] = useState(false)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const measure = (): void => {
      const el = optionRefs.current[activeIndex]
      // Hidden (display:none) or nothing picked: no highlight until it can be measured.
      if (!el || el.offsetWidth === 0) return setBox(undefined)
      const next = {
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight
      }
      // Same place: keep the old object, so an unrelated resize doesn't re-render.
      setBox((prev) =>
        prev &&
        prev.left === next.left &&
        prev.top === next.top &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      )
    }
    measure()
    // Labels can change width (a font loading, a relabel) and the track can wrap or be revealed,
    // so re-measure whenever the track resizes.
    const ro = new ResizeObserver(measure)
    ro.observe(track)
    return () => ro.disconnect()
  }, [activeIndex, options, size])

  useLayoutEffect(() => {
    if (!box || placed) return
    // Turn the glide on only after the first placement has painted.
    const raf = requestAnimationFrame(() => setPlaced(true))
    return () => cancelAnimationFrame(raf)
  }, [box, placed])

  // Hover tooltip for a disabled option's reason: centred under it, kept inside the window.
  const mode = useUiTheme((s) => s.mode)
  const [tip, setTip] = useState<{ text: string; left: number; top: number } | null>(null)
  const showTip = (text: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect()
    const half = TIP_MAX_W / 2 + 8
    const centre = Math.min(Math.max(r.left + r.width / 2, half), window.innerWidth - half)
    setTip({ text, left: centre, top: r.bottom + 6 })
  }

  const radius = shape === 'pill' ? 999 : 6
  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={label}
      style={{
        ...styles.track,
        borderRadius: radius,
        ...(fill ? styles.trackFill : null),
        ...(disabled ? styles.trackDisabled : null)
      }}
    >
      {box && (
        <span
          aria-hidden
          style={{
            ...styles.highlight,
            ...(tone === 'subtle' ? styles.highlightSubtle : null),
            ...box,
            borderRadius: shape === 'pill' ? 999 : 4,
            transition: placed ? `left ${MOTION}, top ${MOTION}, width ${MOTION}` : 'none'
          }}
        />
      )}
      {options.map((o, i) => {
        const on = i === activeIndex
        const off = disabled || o.disabled
        return (
          <button
            key={o.value}
            ref={(el) => {
              optionRefs.current[i] = el
            }}
            role="tab"
            aria-selected={on}
            // aria-disabled, not `disabled`: a disabled button gets no mouse events, so why it's
            // off could never show on hover. Clicks on it are ignored instead.
            aria-disabled={off || undefined}
            // A disabled option's reason shows in the switch's own tooltip (the native one doesn't
            // reliably appear here); an enabled option keeps the plain title.
            title={off ? undefined : o.title}
            onMouseEnter={off && o.title ? (e) => showTip(o.title!, e.currentTarget) : undefined}
            onMouseLeave={() => setTip(null)}
            onClick={() => {
              if (!on && !off) pick(o.value)
            }}
            style={{
              ...styles.option,
              ...SIZES[size],
              ...(fill ? styles.optionFill : null),
              color:
                tone === 'subtle' ? (on ? UI.text : UI.textMuted) : on ? UI.accentText : UI.text,
              // A disabled option that is the current value (an automatic state, e.g. the import
              // wizard's Custom preset) stays readable on the highlight; only unpicked ones dim.
              ...(o.disabled && !on ? styles.optionDisabled : null),
              cursor: off ? 'not-allowed' : on ? 'default' : 'pointer'
            }}
          >
            {o.label}
          </button>
        )
      })}
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ ...cssVars(PALETTES[mode]), ...styles.tip, left: tip.left, top: tip.top }}
          >
            {/* Styled as a warning (StatusNote's ⚠ amber): it says why the option can't be picked. */}
            <StatusIcon kind="warn" />
            <span>{tip.text}</span>
          </div>,
          document.body
        )}
    </div>
  )
}

/** The two-position switch: a small track whose knob slides right when on. */
export function OnOffSwitch({
  on,
  onChange,
  label,
  title,
  disabled,
  color,
  size = 'md'
}: {
  on: boolean
  onChange: (on: boolean) => void
  /** what it switches — the accessible name, and the default hover text ("<label> on / off") */
  label: string
  /** hover text, when the default doesn't say enough (why it's disabled, what on means) */
  title?: string
  /** greyed and inert, with a not-allowed cursor; `title` is the place to say why */
  disabled?: boolean
  /** the track's colour when on (default the accent) — e.g. a condition's own colour */
  color?: string
  /** `lg`: a bigger switch, for a list where the switch is the main control */
  size?: 'md' | 'lg'
}): ReactNode {
  const [shown, pick] = useMoveThenCommit(on, onChange)
  const lg = size === 'lg'
  return (
    <button
      role="switch"
      aria-checked={shown}
      aria-label={label}
      disabled={disabled}
      title={title ?? `${label} ${shown ? 'on' : 'off'}`}
      onClick={() => pick(!shown)}
      style={{
        ...styles.knobTrack,
        ...(lg ? styles.knobTrackLg : null),
        background: shown ? (color ?? UI.accent) : UI.border,
        ...(disabled ? styles.knobDisabled : null)
      }}
    >
      {/* Slides rather than jumps: a transform animates, a flip of justify-content can't. */}
      <span
        style={{
          ...styles.knob,
          ...(lg ? styles.knobLg : null),
          transform: shown ? `translateX(${lg ? KNOB_TRAVEL_LG : KNOB_TRAVEL}px)` : 'none'
        }}
      />
    </button>
  )
}

/** How far the knob slides: the track's inside (28 − 2 × 2 padding) less the knob's 11px. */
const KNOB_TRAVEL = 13
/** The `lg` switch's: (36 − 2 × 2) − 16. */
const KNOB_TRAVEL_LG = 16

/** Option text and padding per size. `lg` is the main nav's: 2px track inset + 3px padding +
 *  13px text comes to the same height as the folder / workflow chip beside it. */
const SIZES: Record<Size, CSSProperties> = {
  sm: { padding: '2px 11px', fontSize: 11 },
  md: { padding: '3px 12px', fontSize: 12 },
  lg: { padding: '3px 12px', fontSize: 13, lineHeight: 1.2 }
}

const styles: Record<string, CSSProperties> = {
  track: {
    position: 'relative',
    display: 'inline-flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: 2,
    border: `1px solid ${UI.border}`,
    padding: 2,
    background: UI.panel,
    flex: '0 0 auto',
    maxWidth: '100%',
    transition: `opacity ${MOTION}`
  },
  trackFill: { display: 'flex', flex: 1 },
  trackDisabled: { opacity: 0.5 },
  // Behind the options; sized and placed on the picked one.
  highlight: { position: 'absolute', background: UI.accent, pointerEvents: 'none' },
  highlightSubtle: { background: `color-mix(in srgb, ${UI.text} 12%, transparent)` },
  option: {
    position: 'relative', // above the highlight
    border: 'none',
    background: 'transparent',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    transition: `color ${MOTION}`
  },
  optionFill: { flex: 1 },
  optionDisabled: { opacity: 0.35 },
  tip: {
    position: 'fixed',
    zIndex: 10000,
    transform: 'translateX(-50%)',
    maxWidth: TIP_MAX_W,
    padding: '5px 8px',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    border: `1px solid ${UI.warn}`,
    background: UI.panelRaised,
    color: UI.warn,
    fontSize: 11,
    lineHeight: 1.35,
    fontWeight: 500,
    whiteSpace: 'normal',
    pointerEvents: 'none',
    boxShadow: '0 4px 14px rgba(0,0,0,0.3)'
  },
  knobTrack: {
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    width: 28,
    height: 15,
    borderRadius: 8,
    padding: 2,
    border: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box',
    transition: `background ${MOTION}`
  },
  knob: {
    width: 11,
    height: 11,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
    transition: `transform ${MOTION}`
  },
  knobTrackLg: { width: 36, height: 20, borderRadius: 10 },
  knobLg: { width: 16, height: 16 },
  knobDisabled: { opacity: 0.4, cursor: 'not-allowed' }
}
