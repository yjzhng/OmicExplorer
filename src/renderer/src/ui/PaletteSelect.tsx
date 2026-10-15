/**
 * The palette picker, used wherever a colour palette is chosen: a dropdown whose trigger and
 * options each read as the palette's name followed by a 20-step strip of it, its options grouped
 * by kind (uniform / sequential / diverging / spectrum) under collapsible headers in a scrolling
 * menu, with a reverse toggle in line to its right. Optionally an "Automatic" first option — a
 * plot following the global default — shown with the palette it inherits.
 *
 * Self-contained like Select (see usePopover); on the canvas the caller passes `zoom` / `closeKey`.
 */
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  CATEGORICAL_SCHEMES,
  hasCustomSpectrum,
  PALETTE_GROUPS,
  paletteAt,
  paletteKind,
  type CategoricalId,
  type PaletteId,
  type PaletteRef
} from './palettes'
import { PALETTES, UI } from './theme'
import { OnOffSwitch } from './ToggleSwitch'
import { POPOVER_PROPS, usePopover } from './usePopover'
import { useUiTheme } from './useUiTheme'

const STRIP_STEPS = 20

/** A palette's strip: `STRIP_STEPS` swatches, low → high (reversed if the ref is). */
export function PaletteStrip({
  palette,
  z = 1,
  width = 4,
  height = 10
}: {
  palette: PaletteRef
  z?: number
  width?: number
  height?: number
}): ReactNode {
  return (
    <span
      style={{ display: 'inline-flex', flex: '0 0 auto', borderRadius: 2 * z, overflow: 'hidden' }}
    >
      {Array.from({ length: STRIP_STEPS }, (_, i) => (
        <span
          key={i}
          style={{
            width: width * z,
            height: height * z,
            background: paletteAt(palette, i / (STRIP_STEPS - 1))
          }}
        />
      ))}
    </span>
  )
}

/** Name, then strip — the look of the trigger and of every option. */
function PaletteLabel({ name, palette, z }: { name: string; palette: PaletteRef; z: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 * z, minWidth: 0 }}>
      <span
        style={{
          minWidth: 62 * z,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {name}
      </span>
      <PaletteStrip palette={palette} z={z} />
    </span>
  )
}

export function PaletteSelect({
  value,
  onChange,
  auto,
  zoom = 1,
  closeKey,
  disabled
}: {
  /** the palette picked; undefined = Automatic (when `auto` is given) */
  value: PaletteRef | undefined
  onChange: (v: PaletteRef | undefined) => void
  /** offer "Automatic", following this palette (e.g. the global FC default) */
  auto?: { palette: PaletteRef; label?: string }
  zoom?: number
  closeKey?: string
  disabled?: boolean
}): ReactNode {
  const z = zoom
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const { open, setOpen, toggle, rect, btnRef, menuRef } = usePopover(closeKey)
  // What's drawn: the pick, or (Automatic) the palette followed.
  const shown: PaletteRef | undefined = value ?? auto?.palette
  const reverse = !!shown?.reverse
  // Collapsed kinds: every kind but the one holding the current palette starts collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () =>
      new Set(
        PALETTE_GROUPS.filter((g) => !shown || g.kind !== paletteKind(shown.id)).map((g) => g.kind)
      )
  )
  const pick = (id: PaletteId): void => {
    onChange({ id, ...(reverse ? { reverse: true } : null) })
    setOpen(false)
  }
  const autoName = auto ? `auto · ${auto.label ?? auto.palette.id}` : ''
  // Kept inside the window: below the button, capped to the room left there (it scrolls), or
  // above it when there's little room below and more above.
  const gap = 4 * z
  const roomBelow = rect ? window.innerHeight - rect.bottom - gap - 8 : 0
  const roomAbove = rect ? rect.top - gap - 8 : 0
  const upward = roomBelow < 200 && roomAbove > roomBelow
  const place = rect
    ? upward
      ? { bottom: window.innerHeight - rect.top + gap, maxHeight: Math.min(340 * z, roomAbove) }
      : { top: rect.bottom + gap, maxHeight: Math.min(340 * z, roomBelow) }
    : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <button
          ref={btnRef}
          onClick={toggle}
          disabled={disabled}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            background: UI.panelAlt,
            border: `1px solid ${UI.border}`,
            borderRadius: 4,
            padding: '4px 7px',
            fontSize: 12,
            boxSizing: 'border-box',
            textAlign: 'left',
            cursor: 'pointer',
            color: UI.text,
            ...(disabled ? { opacity: 0.5, cursor: 'default' } : null)
          }}
          aria-label={`Palette: ${value ? value.id : autoName}`}
        >
          <span style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', minWidth: 0 }}>
            {shown ? (
              <PaletteLabel name={value ? value.id : autoName} palette={shown} z={1} />
            ) : (
              '— palette —'
            )}
          </span>
          <Chevron size={11} deg={open ? -90 : 90} />
        </button>
        {open &&
          rect &&
          createPortal(
            <div
              ref={menuRef}
              {...POPOVER_PROPS}
              style={{
                position: 'fixed',
                left: rect.left,
                ...place,
                minWidth: rect.width,
                zIndex: 4100,
                background: p.panelAlt,
                border: `1px solid ${p.border}`,
                borderRadius: 6 * z,
                boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
                padding: 4 * z,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column'
              }}
            >
              {auto && (
                <Item
                  selected={!value}
                  z={z}
                  colors={{ text: p.text, hover: p.panel, accent: p.accent }}
                  onClick={() => {
                    onChange(undefined)
                    setOpen(false)
                  }}
                  label={autoName}
                >
                  <PaletteLabel name={autoName} palette={auto.palette} z={z} />
                </Item>
              )}
              {PALETTE_GROUPS.filter((g) => g.kind !== 'custom' || hasCustomSpectrum()).map((g) => {
                const isOpen = !collapsed.has(g.kind)
                return (
                  <div key={g.kind} style={{ display: 'flex', flexDirection: 'column' }}>
                    <button
                      onClick={() =>
                        setCollapsed((s) => {
                          const n = new Set(s)
                          if (n.has(g.kind)) n.delete(g.kind)
                          else n.add(g.kind)
                          return n
                        })
                      }
                      aria-expanded={isOpen}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6 * z,
                        border: 'none',
                        background: 'transparent',
                        color: p.textMuted,
                        fontSize: 10 * z,
                        fontWeight: 600,
                        letterSpacing: 0.5,
                        textTransform: 'uppercase',
                        padding: `${6 * z}px ${8 * z}px ${3 * z}px`,
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                    >
                      <Chevron size={9 * z} deg={isOpen ? 90 : 0} />
                      {g.label}
                    </button>
                    {isOpen &&
                      g.ids.map((id) => (
                        <Item
                          key={id}
                          selected={value?.id === id}
                          z={z}
                          colors={{ text: p.text, hover: p.panel, accent: p.accent }}
                          onClick={() => pick(id)}
                          label={id}
                        >
                          <PaletteLabel name={id} palette={{ id, reverse }} z={z} />
                        </Item>
                      ))}
                  </div>
                )
              })}
            </div>,
            document.body
          )}
      </div>
      {/* In line, right of the dropdown: run the palette the other way. On Automatic, flipping it
          picks the followed palette, reversed from it. */}
      <OnOffSwitch
        on={reverse}
        label="Reverse"
        title="Reverse the palette"
        disabled={disabled || !shown}
        onChange={(v) => shown && onChange({ id: shown.id, ...(v ? { reverse: true } : null) })}
      />
      <span style={{ color: UI.textMuted, fontSize: 11, flex: '0 0 auto' }}>reverse</span>
    </div>
  )
}

function Item({
  selected,
  z,
  colors,
  onClick,
  label,
  children
}: {
  selected: boolean
  z: number
  colors: { text: string; hover: string; accent: string }
  onClick: () => void
  label: string
  children: ReactNode
}): ReactNode {
  const [hover, setHover] = useState(false)
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6 * z,
        width: '100%',
        border: 'none',
        borderRadius: 4 * z,
        padding: `${4 * z}px ${8 * z}px ${4 * z}px ${14 * z}px`,
        fontSize: 12 * z,
        fontWeight: selected ? 600 : 400,
        color: selected ? colors.accent : colors.text,
        background: selected ? `${colors.accent}22` : hover ? colors.hover : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ flex: `0 0 ${12 * z}px`, color: colors.accent }}>{selected ? '✓' : ''}</span>
      {children}
    </button>
  )
}

/** Open-chevron (SVG): 0 = points right (collapsed), 90 = down. */
function Chevron({ size, deg }: { size: number; deg: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ flex: '0 0 auto', transform: `rotate(${deg}deg)`, transition: 'transform 0.12s' }}
    >
      <polyline
        points="3.5,1.5 7,5 3.5,8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A categorical palette as a select option shows it: its name, then a swatch per colour. */
export function CategoricalLabel({ id, name }: { id: CategoricalId; name?: string }): ReactNode {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ minWidth: 62 }}>{name ?? id}</span>
      <span style={{ display: 'inline-flex', borderRadius: 2, overflow: 'hidden' }}>
        {CATEGORICAL_SCHEMES[id].slice(0, 10).map((c) => (
          <span key={c} style={{ width: 8, height: 10, background: c }} />
        ))}
      </span>
    </span>
  )
}
