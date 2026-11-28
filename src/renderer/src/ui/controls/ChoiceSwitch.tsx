/**
 * Pick one of several options: the pill switch (ToggleSwitch) while there are few, a searchable
 * dropdown — the one-gene picker's look (PagerTrigger), with its ‹ › stepping — once there are more than
 * `PILL_CAP`, so a condition with many levels (compounds, cell lines, a custom axis) doesn't run
 * the pills across the tile. In a tile's switch row (`fit`), also whenever the pills don't fit on
 * one line beside their label: a few long options ("NK192, NK250, NK266") would otherwise wrap the
 * pills onto a second row.
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { IconSearch } from '../genes/GeneSelectMenu'
import { GENE_LIST_STYLES } from '../genes/geneListStyles'
import { PagerTrigger } from './PagerTrigger'
import { placeMenu } from './placeMenu'
import { PALETTES } from '../app/theme'
import { ToggleSwitch, type ToggleOption } from './ToggleSwitch'
import { useAppView } from '../app/useAppView'
import { useUiTheme } from '../app/useUiTheme'
import { VirtualList } from '../table/VirtualRows'

/** The most options shown as pills; beyond it, the dropdown. */
export const PILL_CAP = 10

export function ChoiceSwitch<V extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  cap = PILL_CAP,
  counter = false,
  pager = true,
  fit = false
}: {
  value: V
  options: readonly ToggleOption<V>[]
  onChange: (value: V) => void
  /** accessible name; also what the search field says it searches */
  label: string
  size?: 'sm' | 'md'
  /** the most options shown as pills (Infinity: always pills) */
  cap?: number
  /** the dropdown shows the "n/m" position readout (a condition's levels, as the gene pager) */
  counter?: boolean
  /** the dropdown's ‹ › stepping: for options of one kind (a condition's levels, compounds), where
   *  "next" means something; false for a plot's own settings (log₂FC, Q-value, F…), which are
   *  different things with no order to step through */
  pager?: boolean
  /** in a tile's switch row: the dropdown, too, whenever the pills don't fit on one line */
  fit?: boolean
}): ReactNode {
  if (fit && options.length <= cap)
    return (
      <FitChoice
        value={value}
        options={options}
        onChange={onChange}
        label={label}
        size={size}
        counter={counter}
        pager={pager}
      />
    )
  if (options.length <= cap)
    return (
      <ToggleSwitch size={size} label={label} value={value} options={options} onChange={onChange} />
    )
  return (
    <ChoicePicker
      value={value}
      options={options}
      onChange={onChange}
      label={label}
      size={size}
      counter={counter}
      pager={pager}
    />
  )
}

/** The pills while they fit on one line, else the dropdown.
 *
 *  - The pills' width: an invisible copy at its natural one-line width (`max-content`, in a
 *    zero-size clipped box so it can't widen what scrolls around it).
 *  - The room: from where this switch's line starts — the outermost wrapping row it sits in — to the
 *    tile's visible right edge (the nearest box that scrolls or clips sideways), less that row's
 *    right padding and what the row's item holds beside this (label, gaps, padding). So it's the
 *    room the switch has on a line of its own, whichever of the two is showing — it can't flip
 *    back and forth.
 *  - Never mid-slide (the Workflow ⇄ Results slide, useAppView `paging`): the slide is only a
 *    transition, so the switch is measured on the page at rest, once it settles — not on a page
 *    still off to the side, whose reading would stick, as nothing resizes when it lands. */
function FitChoice<V extends string>(props: {
  value: V
  options: readonly ToggleOption<V>[]
  onChange: (value: V) => void
  label: string
  size: 'sm' | 'md'
  counter: boolean
  pager: boolean
}): ReactNode {
  const { value, options, onChange, label, size } = props
  const slotRef = useRef<HTMLSpanElement>(null)
  const pillsRef = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  // the page sliding in or out: hold the last reading until it settles
  const paging = useAppView((s) => s.paging)
  useLayoutEffect(() => {
    const slot = slotRef.current
    const pills = pillsRef.current
    if (paging || !slot || !pills) return
    // the row this switch wraps in, and its child holding the switch
    let item: HTMLElement = slot
    let line = slot.parentElement
    while (line && getComputedStyle(line).flexWrap !== 'wrap') {
      item = line
      line = line.parentElement
    }
    // a strip wrapping inside another (a SwitchBar in a tile's switch row): the outer one, whose
    // line starts at the row's edge — the room this switch has on a line of its own
    while (line?.parentElement && getComputedStyle(line.parentElement).flexWrap === 'wrap') {
      item = line
      line = line.parentElement
    }
    // the box that bounds what the tile shows — or, nearer, a moved one (a transform: the results
    // page sliding in): measured against a box outside it, the switch would read as off to the
    // side, and as nothing resizes when the slide ends, it would stay the dropdown
    let port = line?.parentElement ?? null
    while (port) {
      const cs = getComputedStyle(port)
      if (/auto|scroll|hidden|clip/.test(cs.overflowX) || cs.transform !== 'none') break
      port = port.parentElement
    }
    if (!line || !port) return
    const check = (): void => {
      const lcs = getComputedStyle(line)
      const pcs = getComputedStyle(port)
      const portBox = port.getBoundingClientRect()
      const right =
        portBox.left + port.clientLeft + port.clientWidth - (parseFloat(pcs.paddingRight) || 0)
      const start = line.getBoundingClientRect().left + (parseFloat(lcs.paddingLeft) || 0)
      const room = right - (parseFloat(lcs.paddingRight) || 0) - start
      const beside = item.offsetWidth - slot.offsetWidth
      setFits(pills.offsetWidth <= room - beside)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(port)
    ro.observe(pills)
    return () => ro.disconnect()
  }, [paging])
  return (
    <span ref={slotRef} style={fitStyles.slot}>
      <span style={fitStyles.clip} aria-hidden>
        <span ref={pillsRef} style={fitStyles.measure}>
          <ToggleSwitch
            size={size}
            label={label}
            value={value}
            options={options}
            onChange={() => {}}
          />
        </span>
      </span>
      {fits ? (
        <ToggleSwitch
          size={size}
          label={label}
          value={value}
          options={options}
          onChange={onChange}
        />
      ) : (
        <ChoicePicker {...props} />
      )}
    </span>
  )
}
const fitStyles: Record<string, CSSProperties> = {
  slot: { position: 'relative', display: 'inline-flex', minWidth: 0 },
  clip: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    visibility: 'hidden',
    pointerEvents: 'none'
  },
  // its natural one-line width: max-content, so the track's maxWidth / wrap can't squeeze it
  measure: { position: 'absolute', left: 0, top: 0, width: 'max-content', display: 'flex' }
}

/** An option's text, for the button, the search and the list (labels are text in practice). */
const textOf = <V extends string>(o: ToggleOption<V>): string =>
  typeof o.label === 'string' || typeof o.label === 'number' ? String(o.label) : o.value

function ChoicePicker<V extends string>({
  value,
  options,
  onChange,
  label,
  size,
  counter,
  pager
}: {
  value: V
  options: readonly ToggleOption<V>[]
  onChange: (value: V) => void
  label: string
  size: 'sm' | 'md'
  counter: boolean
  pager: boolean
}): ReactNode {
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? options.filter((o) => textOf(o).toLowerCase().includes(needle)) : options
  }, [options, q])

  const idx = options.findIndex((o) => o.value === value)
  const current = idx >= 0 ? options[idx] : undefined
  const pickable = options.filter((o) => !o.disabled)
  const many = pickable.length > 1
  // Step to the next / previous pickable option, wrapping.
  const go = (d: number): void => {
    const n = options.length
    for (let k = 1; k <= n; k++) {
      const o = options[(((idx + d * k) % n) + n) % n]
      if (!o.disabled) return onChange(o.value)
    }
  }
  const toggle = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQ('')
    setOpen((o) => !o)
  }

  const place = rect ? placeMenu(rect, MENU_W, MENU_H) : null

  const L = GENE_LIST_STYLES
  const fontSize = size === 'sm' ? 11 : 12
  return (
    <>
      <PagerTrigger
        name={current ? textOf(current) : '—'}
        pos={counter ? { index: idx, total: options.length } : undefined}
        open={open}
        onToggle={toggle}
        btnRef={btnRef}
        onStep={go}
        canStep={many}
        arrows={pager}
        noun={label}
        title={`Pick a ${label} (${options.length})`}
        fontSize={fontSize}
      />
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...L.menu,
              ...place,
              width: MENU_W,
              zIndex: 5000,
              background: p.panel,
              border: `1px solid ${p.border}`
            }}
          >
            <div style={L.searchWrap}>
              <span style={{ ...L.searchIcon, color: p.textMuted }}>
                <IconSearch />
              </span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  // Enter takes the first pickable match.
                  const first = e.key === 'Enter' ? filtered.find((o) => !o.disabled) : undefined
                  if (first) {
                    onChange(first.value)
                    setOpen(false)
                  }
                }}
                placeholder={`Search ${options.length} ${label}…`}
                style={{
                  ...L.search,
                  paddingLeft: 26,
                  background: p.panelAlt,
                  color: p.text,
                  border: `1px solid ${p.border}`
                }}
              />
            </div>
            <div
              style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              {filtered.length === 0 ? (
                <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
              ) : (
                <VirtualList
                  count={filtered.length}
                  style={{ display: 'flex', flexDirection: 'column' }}
                  row={(i) => {
                    const o = filtered[i]
                    const on = o.value === value
                    return (
                      <div
                        key={o.value}
                        role="button"
                        aria-disabled={o.disabled || undefined}
                        title={o.title}
                        onClick={() => {
                          if (o.disabled) return
                          onChange(o.value)
                          setOpen(false)
                        }}
                        style={{
                          ...L.geneRow,
                          paddingLeft: 6,
                          color: p.text,
                          fontWeight: on ? 700 : undefined,
                          ...(on ? { background: `${p.accent}22` } : null),
                          ...(o.disabled ? { opacity: 0.4, cursor: 'default' } : null)
                        }}
                      >
                        <span style={styles.optText}>{o.label}</span>
                      </div>
                    )
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

/** The dropdown's width and tallest height. */
const MENU_W = 240
const MENU_H = 360

const styles: Record<string, CSSProperties> = {
  optText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
}
