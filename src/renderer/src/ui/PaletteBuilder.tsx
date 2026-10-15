/**
 * Settings → Customisation → Custom palettes: build the user's own spectrum and categorical palette. Each
 * colour is picked with the app's colour picker. The spectrum takes 2–5 colours, evenly spaced,
 * with a handle per neighbouring pair on its preview strip — drag it to move where that pair
 * blends half-way (double-click: back to the middle). The categorical palette takes up to 20
 * colours. Once defined, each is offered as "custom" in every palette selector.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { ColorPicker } from './ColorPicker'
import { IconCheck, IconClose, IconEdit, IconTrash } from './icons'
import {
  CATEGORICAL_SCHEMES,
  CUSTOM_CATEGORICAL_MAX,
  CUSTOM_SPECTRUM_MAX,
  customSpectrumAt,
  type CustomSpectrum
} from './palettes'
import { UI } from './theme'

/** Steps the spectrum's preview strip is drawn in, and its height (px) — a stop's square too. */
const STRIP = 120
const STRIP_H = 20
/** A dragged midpoint stays this far inside its stretch. */
const MID_MIN = 0.05
const MID_MAX = 0.95

const NEW_SPECTRUM: CustomSpectrum = { colors: ['#2166ac', '#f0f0f0', '#b2182b'], mids: [0.5, 0.5] }

/** A builder's buttons. Viewing an applied palette: Edit and Delete. Editing: Apply (saves the
 *  draft — unchanged, it just stops editing) and Cancel (back to viewing, the draft dropped).
 *  Only Apply or Delete writes the setting — and redraws the plots, when the palette changed. */
function Footer({
  editing,
  onEdit,
  onApply,
  onCancel,
  onDelete,
  style
}: {
  editing: boolean
  onEdit: () => void
  onApply: () => void
  onCancel: () => void
  onDelete: () => void
  /** placement in the builder's row (it sits at the right end, in line) */
  style?: CSSProperties
}): ReactNode {
  return (
    <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', ...style }}>
      {editing ? (
        <>
          <button
            style={{ ...styles.iconBtn, ...styles.iconApply }}
            onClick={onApply}
            title="Apply"
            aria-label="Apply"
          >
            <IconCheck />
          </button>
          <button style={styles.iconBtn} onClick={onCancel} title="Cancel" aria-label="Cancel">
            <IconClose />
          </button>
        </>
      ) : (
        <>
          <button style={styles.iconBtn} onClick={onEdit} title="Edit" aria-label="Edit">
            <IconEdit />
          </button>
          <button
            style={{ ...styles.iconBtn, color: UI.err }}
            onClick={onDelete}
            title="Delete"
            aria-label="Delete"
          >
            <IconTrash />
          </button>
        </>
      )}
    </div>
  )
}

/** The custom spectrum's builder: preview strip with its midpoint handles, a colour per stop. The
 *  edits are a draft in here until Apply (the caller keys it on the applied value, so an Apply or
 *  a Delete starts it afresh). */
export function SpectrumBuilder({
  value,
  onChange
}: {
  value: CustomSpectrum | undefined
  onChange: (v: CustomSpectrum | undefined) => void
}): ReactNode {
  const stripRef = useRef<HTMLDivElement>(null)
  const [work, setWork] = useState<CustomSpectrum | undefined>(value)
  // viewing the applied palette, or editing a draft of it (a new one starts in editing)
  const [editing, setEditing] = useState(false)
  // the midpoint being dragged, if any
  const [dragging, setDragging] = useState<number | null>(null)
  // the stop under the pointer (its × shows), while editing
  const [hoverStop, setHoverStop] = useState<number | null>(null)
  // a stop being dragged to reorder: which (its index in `work`), where the pointer went down,
  // where it is now along the track (0–1), and whether it's moved far enough to be a drag (a
  // plain click opens its colour picker instead)
  const [stopDrag, setStopDrag] = useState<{
    from: number
    startX: number
    t: number
    moved: boolean
  } | null>(null)
  // swallow the click that ends a drag, so it doesn't open the colour picker
  const justDragged = useRef(false)
  if (!work)
    return (
      <button
        className="oe-palette-builder"
        style={styles.button}
        onClick={() => {
          setWork(NEW_SPECTRUM)
          setEditing(true)
        }}
      >
        Create a custom spectrum
      </button>
    )
  const n = work.colors.length
  const setColor = (i: number, c: string): void =>
    setWork({ ...work, colors: work.colors.map((x, k) => (k === i ? c : x)) })
  const remove = (i: number): void => {
    // Dropping a stop drops a midpoint beside it (the one after it; the last stop's, the one before).
    const colors = work.colors.filter((_, k) => k !== i)
    const mids = work.mids.filter((_, k) => k !== Math.min(i, work.mids.length - 1))
    setWork({ colors, mids })
  }
  const add = (): void =>
    setWork({ colors: [...work.colors, '#808080'], mids: [...work.mids, 0.5] })
  // A dragged midpoint: its position along the strip, held within its own stretch.
  const setMid = (k: number, m: number): void =>
    setWork({ ...work, mids: work.mids.map((x, j) => (j === k ? m : x)) })
  const tAt = (clientX: number): number => {
    const r = stripRef.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const midAt = (k: number, clientX: number): number =>
    Math.min(MID_MAX, Math.max(MID_MIN, tAt(clientX) * (n - 1) - k))
  // While a stop is dragged: the order shown, the dragged stop already in the slot it's over — the
  // strip previews it, and every other stop slides to its place in it (the left transition).
  const order = work.colors.map((_, i) => i)
  if (stopDrag?.moved) {
    const slot = Math.round(stopDrag.t * (n - 1))
    order.splice(stopDrag.from, 1)
    order.splice(slot, 0, stopDrag.from)
  }
  const slotOf = new Map(order.map((orig, slot) => [orig, slot]))
  const shown: CustomSpectrum = stopDrag?.moved
    ? { ...work, colors: order.map((i) => work.colors[i]) }
    : work
  // a stop at its slot: the ends held inside the track, the rest centred on their place
  const shift = (slot: number): string =>
    `translateX(${slot === 0 ? 0 : slot === n - 1 ? -100 : -50}%)`
  return (
    <div
      className="oe-palette-builder"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}
    >
      {/* lifted by the midpoint ticks' room, so the track (not the ticks above it) sits level with
          the row's label — as the categories' bar does */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: -9 }}>
        <div style={{ position: 'relative', paddingTop: 10, flex: '1 1 auto', minWidth: 0 }}>
          <div ref={stripRef} style={styles.strip}>
            {Array.from({ length: STRIP }, (_, i) => (
              <span
                key={i}
                style={{ flex: 1, background: customSpectrumAt(shown, i / (STRIP - 1)) }}
              />
            ))}
          </div>
          {editing &&
            work.mids.map((m, k) => (
              <span
                key={k}
                role="slider"
                aria-label={`Midpoint between colours ${k + 1} and ${k + 2}`}
                aria-valuenow={Math.round(m * 100)}
                title="Drag: where these two colours blend half-way (double-click: the middle)"
                style={{ ...styles.handle, left: `${((k + m) / (n - 1)) * 100}%` }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  setDragging(k)
                  setMid(k, midAt(k, e.clientX))
                }}
                onPointerMove={(e) => {
                  if (dragging === k) setMid(k, midAt(k, e.clientX))
                }}
                onPointerUp={() => setDragging(null)}
                onDoubleClick={() => setMid(k, 0.5)}
              >
                <span style={styles.handleArrow} />
                <span style={styles.handleLine} />
              </span>
            ))}
          {/* each colour on the track at its place — click to pick it, × (on hover) to remove */}
          {editing &&
            work.colors.map((c, i) => {
              const dragged = stopDrag?.moved && stopDrag.from === i
              const slot = slotOf.get(i) ?? i
              return (
                <span
                  key={`stop${i}`}
                  onMouseEnter={() => setHoverStop(i)}
                  onMouseLeave={() => setHoverStop((h) => (h === i ? null : h))}
                  onPointerDown={(e) => {
                    justDragged.current = false
                    setStopDrag({ from: i, startX: e.clientX, t: tAt(e.clientX), moved: false })
                  }}
                  onPointerMove={(e) => {
                    if (!stopDrag || stopDrag.from !== i) return
                    const moved = stopDrag.moved || Math.abs(e.clientX - stopDrag.startX) > 4
                    // captured once it's a drag, so it keeps following off the stop
                    if (moved && !stopDrag.moved) e.currentTarget.setPointerCapture(e.pointerId)
                    setStopDrag({ ...stopDrag, t: tAt(e.clientX), moved })
                    if (moved) setHoverStop(null)
                  }}
                  onPointerUp={() => {
                    if (stopDrag?.moved) {
                      setWork(shown)
                      justDragged.current = true
                    }
                    setStopDrag(null)
                  }}
                  onClickCapture={(e) => {
                    if (!justDragged.current) return
                    e.stopPropagation()
                    e.preventDefault()
                    justDragged.current = false
                  }}
                  style={{
                    ...styles.stop,
                    // the dragged stop follows the pointer; the others slide to their slot
                    left: `${(dragged ? stopDrag.t : slot / (n - 1)) * 100}%`,
                    transform: dragged ? 'translateX(-50%)' : shift(slot),
                    transition: dragged ? 'none' : 'left 140ms ease, transform 140ms ease',
                    cursor: dragged ? 'grabbing' : 'grab',
                    zIndex: dragged ? 3 : 2
                  }}
                >
                  <ColorPicker
                    value={c}
                    onPick={(v) => setColor(i, v)}
                    label={`Colour ${i + 1}`}
                    title={`Colour ${i + 1}`}
                    triggerStyle={{ ...styles.stopSwatch, background: c }}
                  >
                    <span />
                  </ColorPicker>
                  {hoverStop === i && n > 2 && (
                    <button
                      style={styles.catRemove}
                      onClick={() => {
                        remove(i)
                        setHoverStop(null)
                      }}
                      title={`Remove colour ${i + 1}`}
                    >
                      ×
                    </button>
                  )}
                </span>
              )
            })}
        </div>
        {editing && n < CUSTOM_SPECTRUM_MAX && (
          <button style={styles.stopAdd} onClick={add} title="Add a colour">
            +
          </button>
        )}
        <Footer
          editing={editing}
          onEdit={() => setEditing(true)}
          onApply={() => {
            onChange(work)
            setEditing(false)
          }}
          onCancel={() => {
            setWork(value)
            setEditing(false)
          }}
          onDelete={() => onChange(undefined)}
          style={{ marginTop: 9 }}
        />
      </div>
    </div>
  )
}

/** The custom categorical palette's builder: its colours as one strip of squares in a box — click
 *  one to pick its colour, drag it to reorder (the others slide aside to show where it lands), ×
 *  (on hover) to remove — ending in a "+" square that adds one (up to 20). A draft until Apply
 *  (keyed on the applied value by the caller, as the spectrum's). */
export function CategoryBuilder({
  value,
  onChange
}: {
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
}): ReactNode {
  const [work, setWork] = useState<string[] | undefined>(value)
  // viewing the applied palette, or editing a draft of it (a new one starts in editing)
  const [editing, setEditing] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  // drag-reorder: the square picked up (its index in `work`), and the slot it's over
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  if (!work?.length)
    return (
      <button
        className="oe-palette-builder"
        style={styles.button}
        onClick={() => {
          setWork([...CATEGORICAL_SCHEMES.tab10.slice(0, 5)])
          setEditing(true)
        }}
      >
        Create a custom category palette
      </button>
    )
  const n = work.length
  // A new colour: the next tab10 colour along, as a starting point.
  const next = CATEGORICAL_SCHEMES.tab10[n % CATEGORICAL_SCHEMES.tab10.length]
  // The order shown: while dragging, the dragged square already in the slot it's over — every
  // square sits at its place in this order, so the others slide (see the left transition).
  const order = work.map((_, i) => i)
  if (dragFrom != null && dropAt != null) {
    order.splice(dragFrom, 1)
    order.splice(dropAt, 0, dragFrom)
  }
  const slotOf = new Map(order.map((orig, slot) => [orig, slot]))
  const endDrag = (): void => {
    setDragFrom(null)
    setDropAt(null)
  }
  return (
    <div
      className="oe-palette-builder"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 360 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={styles.catRow}>
          <div
            ref={stripRef}
            style={styles.catStrip}
            onDragOver={(e) => {
              if (dragFrom == null) return
              e.preventDefault()
              const x = e.clientX - stripRef.current!.getBoundingClientRect().left
              const w = stripRef.current!.getBoundingClientRect().width / n
              const slot = Math.max(0, Math.min(n - 1, Math.floor(x / w)))
              if (slot !== dropAt) setDropAt(slot)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom != null && dropAt != null && dropAt !== dragFrom)
                setWork(order.map((i) => work[i]))
              endDrag()
            }}
          >
            {work.map((c, i) => (
              <span
                key={i}
                draggable={editing}
                onDragStart={(e) => {
                  setDragFrom(i)
                  setDropAt(i)
                  setHover(null)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragEnd={endDrag}
                onMouseEnter={() => editing && setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  // an equal share of the strip each: fewer colours, wider blocks
                  left: `${((slotOf.get(i) ?? i) / n) * 100}%`,
                  width: `${100 / n}%`,
                  transition: 'left 140ms ease, width 140ms ease',
                  cursor: editing ? 'grab' : 'default',
                  opacity: dragFrom === i ? 0.35 : 1,
                  zIndex: hover === i ? 1 : 0
                }}
              >
                {editing ? (
                  <ColorPicker
                    value={c}
                    onPick={(v) => setWork(work.map((x, k) => (k === i ? v : x)))}
                    label={`Category ${i + 1}`}
                    title={`Category ${i + 1} — click to change, drag to reorder`}
                    triggerStyle={{ ...styles.catSquare, background: c }}
                  >
                    <span />
                  </ColorPicker>
                ) : (
                  <span style={{ ...styles.catSquare, background: c, cursor: 'default' }} />
                )}
                {hover === i && n > 1 && dragFrom == null && (
                  <button
                    style={styles.catRemove}
                    onClick={() => {
                      setWork(work.filter((_, k) => k !== i))
                      setHover(null)
                    }}
                    title={`Remove category ${i + 1}`}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {editing && n < CUSTOM_CATEGORICAL_MAX && (
            <button
              style={{ ...styles.stopAdd, marginTop: 0 }}
              onClick={() => setWork([...work, next])}
              title="Add a colour"
            >
              +
            </button>
          )}
        </div>
        <Footer
          editing={editing}
          onEdit={() => setEditing(true)}
          onApply={() => {
            onChange(work)
            setEditing(false)
          }}
          onCancel={() => {
            setWork(value)
            setEditing(false)
          }}
          onDelete={() => onChange(undefined)}
          style={{ marginLeft: 'auto' }}
        />
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  strip: {
    display: 'flex',
    height: STRIP_H,
    borderRadius: 3,
    overflow: 'hidden',
    border: `1px solid ${UI.border}`
  },
  // A midpoint handle: a down-pointing marker above the strip, a hairline across it.
  handle: {
    position: 'absolute',
    top: 0,
    width: 12,
    height: 30,
    marginLeft: -6,
    cursor: 'ew-resize',
    touchAction: 'none'
  },
  // subtle: a small muted tick above the track, a faint hairline across it
  handleArrow: {
    position: 'absolute',
    left: 2,
    top: 3,
    width: 0,
    height: 0,
    borderLeft: '4px solid transparent',
    borderRight: '4px solid transparent',
    borderTop: `5px solid ${UI.textMuted}`
  },
  handleLine: {
    position: 'absolute',
    left: 5.5,
    top: 8,
    width: 1,
    height: 22,
    background: UI.text,
    opacity: 0.3
  },
  // the spectrum's "+": the size of a stop's white box (its colour + the 2px rim each side), level
  // with the stops
  stopAdd: {
    boxSizing: 'border-box',
    width: STRIP_H + 4,
    height: STRIP_H + 4,
    marginTop: 9,
    border: `1px dashed ${UI.textMuted}`,
    borderRadius: 3,
    background: 'transparent',
    color: UI.textMuted,
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer',
    flex: '0 0 auto'
  },
  // a colour stop sitting on the track (above the midpoint lines): its colour exactly the track's
  // height and level with it (the track's 1px border inside the 10px above), in a white box 2px
  // bigger all round
  stop: { position: 'absolute', top: 9, zIndex: 2 },
  stopSwatch: {
    boxSizing: 'content-box',
    width: STRIP_H,
    height: STRIP_H,
    borderRadius: 3,
    border: '2px solid #ffffff',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
    padding: 0,
    display: 'block',
    cursor: 'pointer'
  },
  // The categories: one bar as tall as the spectrum's track, filling the row (no box), then "+".
  catRow: { display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 auto', minWidth: 0 },
  catStrip: {
    position: 'relative',
    flex: '1 1 auto',
    minWidth: 0,
    height: STRIP_H,
    borderRadius: 3,
    border: `1px solid ${UI.border}`
  },
  catSquare: {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: 0,
    padding: 0,
    display: 'block',
    cursor: 'pointer'
  },
  catRemove: {
    position: 'absolute',
    top: -7,
    right: -5,
    width: 13,
    height: 13,
    borderRadius: '50%',
    border: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    color: UI.text,
    fontSize: 10,
    lineHeight: '10px',
    padding: 0,
    cursor: 'pointer',
    zIndex: 1
  },
  // the builder's buttons: small icon buttons (Edit / Delete, or Apply / Cancel)
  iconBtn: {
    width: 26,
    height: 24,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    color: UI.text,
    padding: 0,
    cursor: 'pointer'
  },
  iconApply: { background: UI.accent, borderColor: UI.accent, color: UI.accentText },
  button: {
    alignSelf: 'flex-start',
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '3px 10px',
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  }
}
