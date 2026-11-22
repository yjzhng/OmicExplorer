/**
 * The app's one opacity control: a track from clear (a checkerboard) to the thing's own colour,
 * a round handle to drag (or click anywhere on the track, or arrow keys: 1%, Shift 10%), and the
 * value as a % box beside it to type in — `compact` (a narrow column of a group table), a smaller
 * box. Stored 0–1, shown 0–100%. While dragging the handle and the box
 * follow the pointer; the value is written once, on release — a plot isn't redrawn for every
 * pixel of a drag.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { NumberInput } from './NumberInput'
import { UI } from './theme'

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function OpacitySlider({
  value,
  onChange,
  color,
  label,
  disabled,
  compact = false
}: {
  /** 0–1 */
  value: number
  onChange: (v: number) => void
  /** the colour the track fades to (the thing whose opacity this is); unset = neutral black —
   *  for a thing of many colours (an automatic palette), where any one of them would mislead */
  color?: string
  /** what it's the opacity of, for the tooltip and screen readers */
  label: string
  disabled?: boolean
  /** for a narrow cell: a smaller % box */
  compact?: boolean
}): ReactNode {
  const track = useRef<HTMLDivElement>(null)
  // the value under the pointer while dragging (written on release)
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? clamp01(value)
  const ink = color && color !== 'transparent' ? color : NEUTRAL
  const at = (clientX: number): number => {
    const r = track.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return shown
    return Math.round(clamp01((clientX - r.left) / r.width) * 100) / 100
  }
  const set = (v: number): void => onChange(Math.round(clamp01(v) * 100) / 100)
  return (
    <div style={{ ...styles.wrap, ...(disabled ? styles.off : null) }}>
      <div
        ref={track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} opacity`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        title={`${label} opacity`}
        style={{
          ...styles.track,
          // clear → the colour, over a checkerboard that shows through where it's see-through
          backgroundImage: `linear-gradient(to right, transparent, ${ink}), repeating-conic-gradient(#c8c8c8 0 25%, #ffffff 0 50%)`,
          backgroundSize: '100% 100%, 10px 10px'
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(at(e.clientX))
        }}
        onPointerMove={(e) => {
          if (drag != null) setDrag(at(e.clientX))
        }}
        onPointerUp={(e) => {
          if (drag == null) return
          const v = at(e.clientX)
          setDrag(null)
          set(v)
        }}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={(e) => {
          if (disabled) return
          const step = e.shiftKey ? 0.1 : 0.01
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(shown + step)
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(shown - step)
          else if (e.key === 'Home') set(0)
          else if (e.key === 'End') set(1)
          else return
          e.preventDefault()
        }}
      >
        {/* the handle: the colour at this opacity (over a checkerboard), ringed white so it reads
            on any track */}
        <span style={{ ...styles.thumb, left: `calc(${shown * 100}% - ${shown * THUMB}px)` }}>
          <span style={{ ...styles.thumbFill, background: ink, opacity: shown }} />
        </span>
      </div>
      <div style={compact ? styles.boxCompact : styles.box}>
        <NumberInput
          value={Math.round(shown * 100)}
          step={5}
          min={0}
          max={100}
          disabled={disabled}
          title={`${label} opacity (%)`}
          style={compact ? styles.inputCompact : undefined}
          onChange={(v) => set(Math.min(100, Math.max(0, v)) / 100)}
        />
        <span style={styles.pct}>%</span>
      </div>
    </div>
  )
}

const THUMB = 18
/** the track's colour for a thing with no one colour (over the checkerboard, so either theme) */
const NEUTRAL = '#000000'

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0 },
  off: { opacity: 0.45, pointerEvents: 'none' },
  track: {
    position: 'relative',
    flex: '1 1 auto',
    minWidth: 36,
    height: 18,
    borderRadius: 9,
    border: `1px solid ${UI.border}`,
    boxSizing: 'border-box',
    cursor: 'pointer',
    touchAction: 'none',
    outlineOffset: 2
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    width: THUMB,
    height: THUMB,
    marginTop: -THUMB / 2,
    borderRadius: '50%',
    border: '3px solid #ffffff',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.35)',
    boxSizing: 'border-box',
    overflow: 'hidden',
    pointerEvents: 'none',
    backgroundImage: 'repeating-conic-gradient(#c8c8c8 0 25%, #ffffff 0 50%)',
    backgroundSize: '6px 6px'
  },
  thumbFill: { position: 'absolute', inset: 0, borderRadius: '50%' },
  box: { display: 'flex', alignItems: 'center', gap: 2, width: 58, flex: '0 0 58px' },
  boxCompact: { display: 'flex', alignItems: 'center', gap: 1, width: 42, flex: '0 0 42px' },
  inputCompact: { padding: '2px 3px', fontSize: 11 },
  pct: { color: UI.textMuted, fontSize: 11 }
}
